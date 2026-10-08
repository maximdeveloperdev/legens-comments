import {
  findFarmCommentAntiSpamConflicts,
  normalizeFarmCommentForAntiSpam,
  type FarmAntiSpamJob,
} from "@/lib/farm-anti-spam"
import { rewriteFarmCommentWithGpt } from "@/lib/openai-comment-rewrite"

const DEFAULT_MAX_REWRITE_ATTEMPTS = 3

function sameFanScope(left: Pick<FarmAntiSpamJob, "profileId" | "fanName">, right: Pick<FarmAntiSpamJob, "profileId" | "fanName">) {
  const leftFan = normalizeFarmCommentForAntiSpam(left.fanName || "")
  const rightFan = normalizeFarmCommentForAntiSpam(right.fanName || "")
  return left.profileId === right.profileId && (!leftFan || !rightFan || leftFan === rightFan)
}

function avoidCommentsForJob(jobs: FarmAntiSpamJob[], job: FarmAntiSpamJob, extra: string[] = []) {
  return [
    ...jobs
      .filter((item) => item !== job && sameFanScope(item, job))
      .map((item) => item.message)
      .filter(Boolean),
    ...extra,
  ]
}

export async function rewriteFarmJobsForAntiSpam<T extends FarmAntiSpamJob>(input: {
  jobs: T[]
  excludeJobIds?: string[]
  maxAttempts?: number
  onRewrite?: (line: { index: number; oldMessage: string; newMessage: string; attempt: number; reason: string }) => void | Promise<void>
}): Promise<{ ok: boolean; jobs: T[]; rewritten: number; message?: string }> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_REWRITE_ATTEMPTS
  let jobs = input.jobs.map((job) => ({ ...job }))
  let rewritten = 0
  let lastMessage = ""

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const conflicts = await findFarmCommentAntiSpamConflicts({
      jobs,
      excludeJobIds: input.excludeJobIds,
    })
    if (conflicts.length === 0) return { ok: true, jobs, rewritten }

    lastMessage = conflicts[0].message
    const touched = new Set<number>()
    let changed = false

    for (const conflict of conflicts) {
      if (touched.has(conflict.index)) continue
      touched.add(conflict.index)
      const job = jobs[conflict.index]
      if (!job || !job.message.trim()) continue

      const oldMessage = job.message
      const newMessage = await rewriteFarmCommentWithGpt({
        comment: oldMessage,
        fanName: job.fanName,
        url: job.url,
        avoidComments: avoidCommentsForJob(jobs, job, conflict.conflictingMessage ? [conflict.conflictingMessage] : []),
      })

      jobs = jobs.map((item, index) => (index === conflict.index ? { ...item, message: newMessage, aiComment: false } : item))
      rewritten += 1
      changed = true
      await input.onRewrite?.({
        index: conflict.index,
        oldMessage,
        newMessage,
        attempt,
        reason: conflict.message,
      })
    }

    if (!changed) break
  }

  const conflicts = await findFarmCommentAntiSpamConflicts({
    jobs,
    excludeJobIds: input.excludeJobIds,
  })
  return {
    ok: conflicts.length === 0,
    jobs,
    rewritten,
    message: conflicts[0]?.message || lastMessage || "Антиспам: не удалось перефразировать комментарий",
  }
}
