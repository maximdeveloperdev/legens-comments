import { FarmJobStatus, Prisma, type FarmJob } from "@prisma/client"
import { writeActionLog } from "@/lib/action-log"
import { listAdsPowerProfiles } from "@/lib/adspower"
import { prisma } from "@/lib/db"
import { rewriteFarmJobsForAntiSpam } from "@/lib/farm-comment-auto-rewrite"
import { formatFarmJobError } from "@/lib/farm-job-error"
import type { FarmQueueAccess } from "@/lib/farm-queue-access"
import { farmTaskAccessWhere } from "@/lib/farm-queue-access"
import { runFacebookComment } from "@/lib/facebook-page-switch"
import { readFacebookPostForAi } from "@/lib/facebook-post"
import { getOpenAiConfig } from "@/lib/openai-account"
import { generateCommentsWithGpt } from "@/lib/openai-comment"

const STALE_MS = 8 * 60_000
const DEFAULT_MAX_PARALLEL = 10
const HARD_MAX_PARALLEL = 50
const ADSPOWER_META_TTL_MS = 60_000

let processing = false
let adsPowerProfileMetaCache:
  | {
      expiresAt: number
      profiles: Awaited<ReturnType<typeof listAdsPowerProfiles>>["profiles"]
    }
  | null = null

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function kickFarmQueue() {
  void processFarmQueue()
}

export function getFarmQueueMaxParallel() {
  const parsed = Number(process.env.FARM_QUEUE_MAX_PARALLEL || DEFAULT_MAX_PARALLEL)
  if (!Number.isInteger(parsed)) return DEFAULT_MAX_PARALLEL
  return Math.min(Math.max(parsed, 1), HARD_MAX_PARALLEL)
}

export async function farmQueueIsBusy() {
  if (processing) return true
  const running = await prisma.farmJob.count({
    where: { status: FarmJobStatus.RUNNING },
  })
  return running > 0
}

async function listCachedAdsPowerProfiles() {
  if (adsPowerProfileMetaCache && adsPowerProfileMetaCache.expiresAt > Date.now()) {
    return adsPowerProfileMetaCache.profiles
  }

  const result = await listAdsPowerProfiles().catch(() => ({ ok: false, message: "", profiles: [] }))
  adsPowerProfileMetaCache = {
    expiresAt: Date.now() + ADSPOWER_META_TTL_MS,
    profiles: result.profiles,
  }
  return result.profiles
}

function isLimitError(value: string) {
  return /insufficient_quota|quota|billing|limit|credits|credit balance|exceeded/i.test(value)
}

async function checkOpenAiBeforeQueueGeneration() {
  const { apiKey } = getOpenAiConfig()
  if (!apiKey) return "Добавь OPENAI_API_KEY в .env"

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    })
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string }
    } | null
    const message = payload?.error?.message || payload?.error?.code || ""
    if (response.status === 429 || isLimitError(message)) return "no limit"
    if (!response.ok) return message || `OpenAI ${response.status}`
  } catch (error) {
    return error instanceof Error ? error.message : "OpenAI не ответил"
  }

  return ""
}

async function resolveJobMessage(job: FarmJob, log: (line: { level: "info" | "ok" | "error"; text: string }) => void) {
  if (!job.aiComment) return job.message

  log({ level: "info", text: "ChatGPT: проверяем лимит" })
  const preflightError = await checkOpenAiBeforeQueueGeneration()
  if (preflightError) {
    throw new Error(preflightError)
  }

  log({ level: "info", text: "ChatGPT: открываем пост и готовим комментарий" })
  const post = await readFacebookPostForAi({
    url: job.url,
    profileId: job.profileId,
    ignoreQueueBusy: true,
  })
  const generated = await generateCommentsWithGpt({
    posts: [post],
    authors: [{ name: job.fanName || job.profileId }],
    count: 1,
  })
  const message = generated.comments[0]?.trim()
  if (!message) {
    throw new Error("ChatGPT не вернул комментарий")
  }
  await prisma.farmJob.update({
    where: { id: job.id },
    data: { message },
  })
  log({
    level: "ok",
    text: `ChatGPT: комментарий готов · ${generated.postKind}`,
  })
  return message
}

async function claimNextJob(maxParallel: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`LOCK TABLE "FarmJob" IN SHARE ROW EXCLUSIVE MODE`
    const running = await tx.farmJob.findMany({
      where: { status: FarmJobStatus.RUNNING },
      select: { profileId: true },
    })
    if (running.length >= maxParallel) return null
    const busyProfileIds = [...new Set(running.map((job) => job.profileId).filter(Boolean))]
    const next = await tx.farmJob.findFirst({
      where: {
        status: FarmJobStatus.PENDING,
        ...(busyProfileIds.length > 0 ? { profileId: { notIn: busyProfileIds } } : {}),
      },
      orderBy: { createdAt: "asc" },
    })
    if (!next) return null
    return tx.farmJob.update({
      where: { id: next.id },
      data: { status: FarmJobStatus.RUNNING, startedAt: new Date(), error: null },
    })
  })
}

async function runFarmJob(job: FarmJob) {
  const likeOnly = job.action === "likeonly"
  const likeWithComment = job.action === "like" || job.action === "subscribe"
  const subscribePage = job.action === "subscribe"
  const log = (line: { level: "info" | "ok" | "error"; text: string }) => {
    void writeActionLog({
      userName: "очередь",
      action: "Очередь",
      detail: `${job.fanName || job.profileId}: ${line.text}`,
      level: line.level,
      profileId: job.profileId,
      source: "adspower",
    })
  }

  try {
    let message = likeOnly ? "" : await resolveJobMessage(job, log)
    if (!likeOnly) {
      const antiSpam = await rewriteFarmJobsForAntiSpam({
        jobs: [
          {
            id: job.id,
            profileId: job.profileId,
            fanName: job.fanName,
            url: job.url,
            message,
          },
        ],
        excludeJobIds: [job.id],
        onRewrite: ({ attempt, reason }) => {
          log({ level: "info", text: `Антиспам: перефразируем комментарий через ChatGPT (${attempt}/3). ${reason}` })
        },
      })
      if (!antiSpam.ok) {
        throw new Error(antiSpam.message || "Антиспам: не удалось перефразировать повтор комментария")
      }
      const safeJob = antiSpam.jobs[0]
      if (safeJob?.message && safeJob.message !== message) {
        message = safeJob.message
        await prisma.farmJob.update({
          where: { id: job.id },
          data: { message, aiComment: false },
        })
        log({ level: "ok", text: "Антиспам: комментарий перефразирован и сохранён" })
      }
    }
    const result = await runFacebookComment(
      {
        profileId: job.profileId,
        url: job.url,
        message,
        photoPath: job.photoPath || undefined,
        fanName: job.fanName || undefined,
        likeOnly,
        likeWithComment,
        subscribePage,
      },
      log,
    )
    await prisma.farmJob.updateMany({
      where: { id: job.id, status: FarmJobStatus.RUNNING },
      data: {
        status: result.ok ? FarmJobStatus.DONE : FarmJobStatus.ERROR,
        finishedAt: new Date(),
        error: result.ok ? null : formatFarmJobError(result.message),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка очереди"
    const formattedMessage = formatFarmJobError(message) ?? "Ошибка очереди"
    log({ level: "error", text: formattedMessage })
    await prisma.farmJob.updateMany({
      where: { id: job.id, status: FarmJobStatus.RUNNING },
      data: {
        status: FarmJobStatus.ERROR,
        finishedAt: new Date(),
        error: formattedMessage,
      },
    })
  } finally {
    await pause(5000)
  }
}

async function processFarmQueue() {
  if (processing) return
  processing = true
  const maxParallel = getFarmQueueMaxParallel()
  const active = new Set<Promise<void>>()
  try {
    await prisma.farmJob.updateMany({
      where: {
        status: FarmJobStatus.RUNNING,
        startedAt: { lt: new Date(Date.now() - STALE_MS) },
      },
      data: { status: FarmJobStatus.PENDING, error: null },
    })

    while (true) {
      while (active.size < maxParallel) {
        const job = await claimNextJob(maxParallel)
        if (!job) break
        const task = runFarmJob(job)
        const tracked = task.finally(() => {
          active.delete(tracked)
        })
        active.add(tracked)
      }

      if (active.size === 0) {
        const running = await prisma.farmJob.count({
          where: { status: FarmJobStatus.RUNNING },
        })
        if (running > 0) break
        const pending = await prisma.farmJob.count({
          where: { status: FarmJobStatus.PENDING },
        })
        if (pending === 0) break
        await pause(1000)
        continue
      }

      await Promise.race(active)
    }
  } finally {
    await Promise.allSettled(active)
    processing = false
  }

  const leftover = await prisma.farmJob.count({
    where: { status: FarmJobStatus.PENDING },
  })
  const running = await prisma.farmJob.count({
    where: { status: FarmJobStatus.RUNNING },
  })
  if (leftover > 0 && running === 0) kickFarmQueue()
}

export async function listFarmQueue(options: { createdBy?: string; access?: FarmQueueAccess } = {}) {
  const maxParallel = getFarmQueueMaxParallel()
  const taskWhere: Prisma.FarmTaskWhereInput | undefined = options.access
    ? farmTaskAccessWhere(options.access)
    : options.createdBy
      ? { createdBy: options.createdBy }
      : undefined
  const jobOwnerWhere: Prisma.FarmJobWhereInput = taskWhere ? { task: taskWhere } : {}
  const [pending, running, done, error, tasks, adsPowerProfiles] = await Promise.all([
    prisma.farmJob.count({ where: { ...jobOwnerWhere, status: FarmJobStatus.PENDING } }),
    prisma.farmJob.count({ where: { ...jobOwnerWhere, status: FarmJobStatus.RUNNING } }),
    prisma.farmJob.count({ where: { ...jobOwnerWhere, status: FarmJobStatus.DONE } }),
    prisma.farmJob.count({ where: { ...jobOwnerWhere, status: FarmJobStatus.ERROR } }),
    prisma.farmTask.findMany({
      where: taskWhere,
      orderBy: { createdAt: "desc" },
      include: {
        jobs: { orderBy: { createdAt: "asc" } },
        createdByUser: {
          include: {
            ledTeams: { select: { name: true } },
            buyerTeams: {
              include: {
                team: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    listCachedAdsPowerProfiles(),
  ])
  const profileMeta = new Map(adsPowerProfiles.map((profile) => [profile.id, profile]))

  return {
    stats: { pending, running, done, error, maxParallel },
    tasks: tasks.map((task) => {
      const counts = { pending: 0, running: 0, done: 0, error: 0 }
      for (const job of task.jobs) {
        if (job.status === FarmJobStatus.PENDING) counts.pending += 1
        else if (job.status === FarmJobStatus.RUNNING) counts.running += 1
        else if (job.status === FarmJobStatus.DONE) counts.done += 1
        else counts.error += 1
      }
      const finishedTimes = task.jobs
        .map((job) => job.finishedAt?.getTime() ?? 0)
        .filter((time) => time > 0)
      const finishedAt =
        task.jobs.length > 0 && finishedTimes.length === task.jobs.length
          ? new Date(Math.max(...finishedTimes))
          : null
      const durationMs = finishedAt
        ? Math.max(0, finishedAt.getTime() - task.createdAt.getTime())
        : null
      const primaryProfile = task.jobs.find((job) => profileMeta.has(job.profileId))
      const lastLoginAt = primaryProfile
        ? (profileMeta.get(primaryProfile.profileId)?.lastOpenAt ?? 0) * 1000
        : 0
      const teamName =
        task.createdByUser?.buyerTeams[0]?.team.name ||
        task.createdByUser?.ledTeams[0]?.name ||
        ""
      return {
        id: task.id,
        createdAt: task.createdAt.toISOString(),
        finishedAt: finishedAt?.toISOString() ?? null,
        durationMs,
        createdBy: task.createdBy,
        teamName,
        lastLoginAt: lastLoginAt > 0 ? new Date(lastLoginAt).toISOString() : null,
        action: task.action,
        total: task.total,
        counts,
        jobs: task.jobs.map((job) => ({
          id: job.id,
          createdAt: job.createdAt.toISOString(),
          startedAt: job.startedAt?.toISOString() ?? null,
          finishedAt: job.finishedAt?.toISOString() ?? null,
          status: job.status,
          action: job.action,
          fanName: job.fanName,
          profileId: job.profileId,
          url: job.url,
          message: job.message,
          aiComment: job.aiComment,
          photoPath: job.photoPath,
          error: formatFarmJobError(job.error),
          taskId: job.taskId,
        })),
      }
    }),
  }
}
