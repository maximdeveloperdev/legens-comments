"use server"

import { prisma } from "@/lib/db"
import { getActiveSession } from "@/lib/session"
import { validateCommentSet, type CommentSetDraft } from "@/lib/comment-set"
import type { Prisma } from "@prisma/client"

export async function listCommentSets() {
  const user = await getActiveSession()
  if (!user) return { error: "Нужно войти в аккаунт" }
  const sets = await prisma.commentSet.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, draft: true } })
  return { sets: sets.map((set) => ({ id: set.id, name: set.name, draft: validateCommentSet(set.draft) })) }
}

export async function saveCommentSet(input: { name: string; draft: CommentSetDraft }) {
  const user = await getActiveSession()
  if (!user) return { error: "Нужно войти в аккаунт" }
  try {
    const name = String(input?.name ?? "").trim()
    if (!name || name.length > 120) return { error: "Название набора: от 1 до 120 символов" }
    const draft = validateCommentSet(input.draft)
    if (!draft.comments.length) return { error: "Добавьте комментарии в набор" }
    const set = await prisma.commentSet.upsert({
      where: { userId_name: { userId: user.id, name } },
      create: { userId: user.id, name, draft: draft as unknown as Prisma.InputJsonValue },
      update: { draft: draft as unknown as Prisma.InputJsonValue }, select: { id: true },
    })
    return { id: set.id }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось сохранить набор" }
  }
}

export async function deleteCommentSet(id: string) {
  const user = await getActiveSession()
  if (!user) return { error: "Нужно войти в аккаунт" }
  await prisma.commentSet.deleteMany({ where: { id, userId: user.id } })
  return { deleted: true }
}
