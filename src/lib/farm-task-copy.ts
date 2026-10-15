import { validateCommentSet, type CommentSetDraft, type TargetGender } from "@/lib/comment-set"

export type CopySourceJob = {
  id: string; action: string; profileId: string; fanName: string; url: string; message: string
  aiComment: boolean; photoPath: string; replyToJobId?: string | null
}
export type CopyFan = { id: string; profileId: string; name: string; gender: TargetGender; geo: string }
export type CopyDraft = CommentSetDraft & { sources: Record<string, string> }

export function copyDraftFromJobs(jobs: CopySourceJob[]): CopyDraft {
  const textJobs = jobs.filter((job) => !["likeonly", "comment_like"].includes(job.action))
  return {
    gender: "ANY", geos: [], postLikes: jobs.filter((job) => job.action === "likeonly").length,
    sources: Object.fromEntries(textJobs.map((job) => [job.id, job.id])),
    comments: textJobs.map((job) => ({
      id: job.id, parentId: job.replyToJobId || null, text: job.message,
      aiComment: job.aiComment, gender: "ANY", geos: [],
      likes: jobs.filter((like) => like.action === "comment_like" && like.replyToJobId === job.id).length,
    })),
  }
}

export function buildFarmTaskCopy(source: CopySourceJob[], input: CopyDraft, fans: CopyFan[], urls: Map<string, string>) {
  const draft = validateCommentSet(input)
  const byId = new Map(source.map((job) => [job.id, job]))
  const fallbackUrl = urls.values().next().value as string | undefined
  if (!fallbackUrl) throw new Error("Вставьте ссылку на пост")
  if (!input.sources || typeof input.sources !== "object" || Array.isArray(input.sources)) throw new Error("Некорректная копия задачи")
  const seenSources = new Set<string>()
  for (const unit of draft.comments) {
    const sourceId = input.sources[unit.id]
    if (sourceId && (!byId.has(sourceId) || ["likeonly", "comment_like"].includes(byId.get(sourceId)!.action) || seenSources.has(sourceId))) {
      throw new Error("Комментарий не принадлежит исходной задаче")
    }
    if (sourceId) seenSources.add(sourceId)
  }
  const mappedIds = new Map(draft.comments.map((unit) => [unit.id, crypto.randomUUID()]))
  const targets: Array<{ url: string; gender: TargetGender; geos: string[]; preferred?: CopySourceJob }> = []
  function pick(url: string, gender: TargetGender, geos: string[], preferred?: CopySourceJob) {
    targets.push({ url, gender, geos, preferred })
    return { profileId: "", fanName: "" }
  }
  type Row = CopySourceJob & { replyToJobId: string | null }
  const rows: Row[] = []
  const unitUrls = new Map<string, string>()
  const pending = [...draft.comments]
  // Resolve URLs through the parent so replies and their likes always stay on the same post.
  while (pending.length) {
    const index = pending.findIndex((unit) => !unit.parentId || unitUrls.has(unit.parentId))
    const [unit] = pending.splice(index, 1)
    const original = byId.get(input.sources[unit.id])
    unitUrls.set(unit.id, unit.parentId ? unitUrls.get(unit.parentId)! : urls.get(original?.url ?? "") ?? fallbackUrl)
  }
  for (const unit of draft.comments) {
    const original = byId.get(input.sources[unit.id])
    const url = unitUrls.get(unit.id)!
    const gender = unit.gender === "ANY" ? draft.gender : unit.gender
    const geos = unit.geos.length ? unit.geos : draft.geos
    const id = mappedIds.get(unit.id)!
    rows.push({ id, action: original?.action ?? "comment", ...pick(url, gender, geos, original), url,
      message: unit.text, aiComment: unit.aiComment && !unit.text, photoPath: original?.photoPath ?? "",
      replyToJobId: unit.parentId ? mappedIds.get(unit.parentId)! : null })
    const oldLikes = source.filter((job) => job.action === "comment_like" && job.replyToJobId === original?.id)
    for (let i = 0; i < unit.likes; i++) {
      rows.push({ id: crypto.randomUUID(), action: "comment_like", ...pick(url, gender, geos, oldLikes[i]), url,
        message: "", aiComment: false, photoPath: "", replyToJobId: id })
    }
  }
  const oldPostLikes = source.filter((job) => job.action === "likeonly")
  for (let i = 0; i < draft.postLikes; i++) {
    const old = oldPostLikes[i]
    const url = urls.get(old?.url ?? "") ?? fallbackUrl
    rows.push({ id: crypto.randomUUID(), action: "likeonly", ...pick(url, draft.gender, draft.geos, old), url,
      message: "", aiComment: false, photoPath: "", replyToJobId: null })
  }
  if (!rows.length) throw new Error("Добавьте комментарии или лайки")
  // Allocate all actors together: a broad filter must not consume the only fan
  // eligible for another comment's narrower filter.
  const choices = targets.map((target) => {
    const unique = new Map<string, CopyFan>()
    for (const fan of fans) {
      if ((target.gender !== "ANY" && fan.gender !== target.gender) || (target.geos.length && !target.geos.includes(fan.geo))) continue
      unique.set(JSON.stringify([target.url, fan.profileId, fan.name]), fan)
    }
    return [...unique].map(([key, fan]) => ({ key, fan }))
  })
  const owners = new Map<string, number>()
  const selected = new Map<number, CopyFan>()
  // Reserve matching original actors first; reassignment below can still move
  // them if a narrower target has no other option.
  for (const [index, target] of targets.entries()) {
    const preferred = choices[index].find(({ key, fan }) => !owners.has(key)
      && fan.profileId === target.preferred?.profileId && fan.name === target.preferred?.fanName)
    if (preferred) { owners.set(preferred.key, index); selected.set(index, preferred.fan) }
  }
  function assign(index: number, visited: Set<string>): boolean {
    for (const candidate of choices[index]) {
      if (visited.has(candidate.key) || owners.has(candidate.key)) continue
      owners.set(candidate.key, index); selected.set(index, candidate.fan)
      return true
    }
    for (const candidate of choices[index]) {
      if (visited.has(candidate.key)) continue
      visited.add(candidate.key)
      const previous = owners.get(candidate.key)
      if (previous !== undefined && assign(previous, visited)) {
        owners.set(candidate.key, index); selected.set(index, candidate.fan)
        return true
      }
    }
    return false
  }
  const order = targets.map((_, index) => index).sort((a, b) => choices[a].length - choices[b].length)
  for (const index of order) {
    if (!selected.has(index) && !assign(index, new Set())) {
      throw new Error("Недостаточно доступных фанок для выбранных лайков, гео и пола. Уменьшите количество действий или расширьте фильтры.")
    }
  }
  return rows.map((row, index) => ({ ...row, profileId: selected.get(index)!.profileId, fanName: selected.get(index)!.name }))
}
