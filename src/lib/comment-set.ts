export type TargetGender = "ANY" | "MALE" | "FEMALE"

export type CommentSetUnit = {
  id: string
  parentId: string | null
  text: string
  likes: number
  gender: TargetGender
  geos: string[]
  aiComment: boolean
}

export type CommentSetDraft = {
  gender: TargetGender
  geos: string[]
  postLikes: number
  comments: CommentSetUnit[]
}

export function validateCommentSet(value: unknown): CommentSetDraft {
  if (!value || typeof value !== "object") throw new Error("Некорректный набор комментариев")
  const draft = value as CommentSetDraft
  const gender = (value: unknown): value is TargetGender => ["ANY", "MALE", "FEMALE"].includes(String(value))
  const geos = (value: unknown) => Array.isArray(value) && value.length <= 300 && value.every((code) => typeof code === "string" && /^[A-Z]{2}$/.test(code))
  const count = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2000
  if (!gender(draft.gender) || !geos(draft.geos) || !count(draft.postLikes) || !Array.isArray(draft.comments) || draft.comments.length > 2000) {
    throw new Error("Проверьте пол, гео и количество лайков")
  }
  const ids = new Set<string>()
  for (const unit of draft.comments) {
    if (!unit || typeof unit.id !== "string" || !unit.id || unit.id.length > 160 || ids.has(unit.id)
      || (unit.parentId !== null && typeof unit.parentId !== "string")
      || typeof unit.text !== "string" || unit.text.length > 8000 || (!unit.text.trim() && !unit.aiComment)
      || typeof unit.aiComment !== "boolean" || !count(unit.likes) || !gender(unit.gender) || !geos(unit.geos)) {
      throw new Error("Заполните тексты комментариев и проверьте настройки")
    }
    ids.add(unit.id)
  }
  const byId = new Map(draft.comments.map((unit) => [unit.id, unit]))
  for (const unit of draft.comments) {
    const visited = new Set([unit.id])
    let parent = unit.parentId
    while (parent) {
      if (!byId.has(parent) || visited.has(parent)) throw new Error("Некорректная связь ответов с комментариями")
      visited.add(parent)
      parent = byId.get(parent)!.parentId
    }
  }
  if (draft.postLikes + draft.comments.reduce((sum, unit) => sum + 1 + unit.likes, 0) > 2000) {
    throw new Error("В задаче может быть не больше 2000 действий")
  }
  // Keep only supported fields; templates never carry profile IDs or attachments.
  return {
    gender: draft.gender, geos: [...new Set(draft.geos)], postLikes: draft.postLikes,
    comments: draft.comments.map((unit) => ({
      id: unit.id, parentId: unit.parentId, text: unit.text.trim(), likes: unit.likes,
      gender: unit.gender, geos: [...new Set(unit.geos)], aiComment: unit.aiComment,
    })),
  }
}
