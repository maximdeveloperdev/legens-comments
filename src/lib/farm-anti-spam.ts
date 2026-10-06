import { createHash } from "node:crypto"
import { FarmJobStatus } from "@prisma/client"
import { prisma } from "@/lib/db"

export const FARM_COMMENT_COOLDOWN_MINUTES = 15

const FARM_COMMENT_COOLDOWN_MS = FARM_COMMENT_COOLDOWN_MINUTES * 60_000
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g

type FarmAntiSpamJob = {
  id?: string
  profileId: string
  fanName?: string
  url: string
  message: string
  aiComment?: boolean
}

type FarmAntiSpamCandidate = FarmAntiSpamJob & {
  hash: string
  index: number
}

type FarmAntiSpamResult = {
  ok: boolean
  message?: string
}

export function normalizeFarmCommentForAntiSpam(value: string) {
  return value
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function hashFarmCommentForAntiSpam(value: string) {
  const normalized = normalizeFarmCommentForAntiSpam(value)
  if (!normalized) return ""
  return createHash("sha256").update(normalized).digest("hex")
}

function fanLabel(job: Pick<FarmAntiSpamJob, "fanName" | "profileId">) {
  return job.fanName?.trim() || job.profileId
}

function normalizeFanName(value: string | null | undefined) {
  return normalizeFarmCommentForAntiSpam(value || "")
}

function fanScopeKey(job: Pick<FarmAntiSpamJob, "profileId" | "fanName">) {
  return `${job.profileId}:${normalizeFanName(job.fanName) || "__profile__"}`
}

function sameFanPage(left: Pick<FarmAntiSpamJob, "profileId" | "fanName">, right: Pick<FarmAntiSpamJob, "profileId" | "fanName">) {
  if (left.profileId !== right.profileId) return false
  const leftName = normalizeFanName(left.fanName)
  const rightName = normalizeFanName(right.fanName)
  return !leftName || !rightName || leftName === rightName
}

function postLabel(value: string) {
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname}`
  } catch {
    return value
  }
}

function conflictMessage(
  fan: string,
  url: string,
  reason: "batch" | "queue" | "history",
) {
  const suffix =
    reason === "batch"
      ? "уже выбран с таким же комментарием в этой задаче"
      : reason === "queue"
        ? "уже имеет такой же комментарий в очереди"
        : `уже отправлял такой же комментарий меньше ${FARM_COMMENT_COOLDOWN_MINUTES} минут назад`

  return `Антиспам: ${fan} ${suffix}. Пост: ${postLabel(url)}. Измени текст или запусти позже.`
}

export async function validateFarmCommentAntiSpam(input: {
  jobs: FarmAntiSpamJob[]
  now?: Date
  excludeJobIds?: string[]
}): Promise<FarmAntiSpamResult> {
  const candidates: FarmAntiSpamCandidate[] = input.jobs
    .map((job, index) => ({
      ...job,
      profileId: job.profileId.trim(),
      fanName: job.fanName?.trim() || "",
      url: job.url.trim(),
      message: job.message.trim(),
      hash: job.aiComment ? "" : hashFarmCommentForAntiSpam(job.message),
      index,
    }))
    .filter((job) => job.profileId && job.url && job.hash)

  if (candidates.length === 0) return { ok: true }

  const byProfileAndText = new Map<string, FarmAntiSpamCandidate[]>()
  for (const job of candidates) {
    const key = `${fanScopeKey(job)}:${job.hash}`
    byProfileAndText.set(key, [...(byProfileAndText.get(key) || []), job])
  }

  for (const group of byProfileAndText.values()) {
    if (group.length < 2) continue
    const first = group[0]
    return {
      ok: false,
      message: conflictMessage(fanLabel(first), group[1]?.url || first.url, "batch"),
    }
  }

  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - FARM_COMMENT_COOLDOWN_MS)
  const excludeJobIds = [...new Set(input.excludeJobIds || [])].filter(Boolean)
  const profileIds = [...new Set(candidates.map((job) => job.profileId))]
  const existingWhere = {
    profileId: { in: profileIds },
    action: { not: "likeonly" },
    OR: [
      { status: { in: [FarmJobStatus.PENDING, FarmJobStatus.RUNNING] } },
      { status: FarmJobStatus.DONE, finishedAt: { gte: cutoff } },
    ],
    ...(excludeJobIds.length > 0 ? { id: { notIn: excludeJobIds } } : {}),
  }

  const existingJobs = await prisma.farmJob.findMany({
    where: existingWhere,
    select: {
      id: true,
      profileId: true,
      fanName: true,
      url: true,
      message: true,
      status: true,
      finishedAt: true,
    },
  })

  const existingByProfileAndText = new Map<string, (typeof existingJobs)[number][]>()
  for (const job of existingJobs) {
    const hash = hashFarmCommentForAntiSpam(job.message)
    if (!hash) continue
    const key = `${job.profileId}:${hash}`
    existingByProfileAndText.set(key, [...(existingByProfileAndText.get(key) || []), job])
  }

  for (const candidate of candidates) {
    const conflicts = existingByProfileAndText.get(`${candidate.profileId}:${candidate.hash}`) || []
    const conflict = conflicts.find((job) => sameFanPage(candidate, job))
    if (!conflict) continue
    const inQueue = conflict.status === FarmJobStatus.PENDING || conflict.status === FarmJobStatus.RUNNING
    return {
      ok: false,
      message: conflictMessage(
        fanLabel(candidate),
        conflict.url || candidate.url,
        inQueue ? "queue" : "history",
      ),
    }
  }

  return { ok: true }
}
