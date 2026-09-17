import { FarmJobStatus, type FarmJob } from "@prisma/client"
import { writeActionLog } from "@/lib/action-log"
import { prisma } from "@/lib/db"
import { runFacebookComment } from "@/lib/facebook-page-switch"

const STALE_MS = 8 * 60_000
const DEFAULT_MAX_PARALLEL = 10
const HARD_MAX_PARALLEL = 50

let processing = false

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

  try {
    const result = await runFacebookComment(
      {
        profileId: job.profileId,
        url: job.url,
        message: job.message,
        fanName: job.fanName || undefined,
        likeOnly,
        likeWithComment,
        subscribePage,
      },
      (line) => {
        void writeActionLog({
          userName: "очередь",
          action: "Очередь",
          detail: `${job.fanName || job.profileId}: ${line.text}`,
          level: line.level,
          profileId: job.profileId,
          source: "adspower",
        })
      },
    )
    await prisma.farmJob.updateMany({
      where: { id: job.id, status: FarmJobStatus.RUNNING },
      data: {
        status: result.ok ? FarmJobStatus.DONE : FarmJobStatus.ERROR,
        finishedAt: new Date(),
        error: result.ok ? null : result.message,
      },
    })
  } catch (error) {
    await prisma.farmJob.updateMany({
      where: { id: job.id, status: FarmJobStatus.RUNNING },
      data: {
        status: FarmJobStatus.ERROR,
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : "Ошибка очереди",
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

export async function listFarmQueue() {
  const maxParallel = getFarmQueueMaxParallel()
  const [pending, running, done, error, tasks] = await Promise.all([
    prisma.farmJob.count({ where: { status: FarmJobStatus.PENDING } }),
    prisma.farmJob.count({ where: { status: FarmJobStatus.RUNNING } }),
    prisma.farmJob.count({ where: { status: FarmJobStatus.DONE } }),
    prisma.farmJob.count({ where: { status: FarmJobStatus.ERROR } }),
    prisma.farmTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        jobs: { orderBy: { createdAt: "asc" } },
      },
    }),
  ])

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
      return {
        id: task.id,
        createdAt: task.createdAt.toISOString(),
        createdBy: task.createdBy,
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
          error: job.error,
          taskId: job.taskId,
        })),
      }
    }),
  }
}
