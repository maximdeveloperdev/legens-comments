"use server"

import { revalidatePath } from "next/cache"
import { startAdsPowerBrowser, stopAdsPowerBrowser } from "@/lib/adspower"
import { writeActionLog, writeTrackerLog } from "@/lib/action-log"
import { runFacebookComment } from "@/lib/facebook-page-switch"
import { requireAdminSession } from "@/lib/session"

export type AdsPowerActionResult = {
  error?: string
  message?: string
}

function normalizeFacebookUrl(value: string) {
  const raw = value.trim()
  if (!raw) return ""
  if (/^\d+$/.test(raw)) return `https://www.facebook.com/${raw}`
  if (raw.startsWith("/")) return `https://www.facebook.com${raw}`
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`
  return raw
}

function isFacebookUrl(value: string) {
  try {
    const url = new URL(normalizeFacebookUrl(value))
    return (
      /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.watch$/.test(url.hostname) ||
      /story_fbid|permalink\.php|\/posts\/|photo\.php/i.test(url.href)
    )
  } catch {
    return false
  }
}

export async function startAdsPowerProfile(userId: string): Promise<AdsPowerActionResult> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  const result = await startAdsPowerBrowser(userId)
  await writeActionLog({
    userName: session.name,
    action: "Старт профиля",
    detail: result.ok ? `Открыт ${userId} без окна` : result.message,
    level: result.ok ? "ok" : "error",
    profileId: userId,
    source: "adspower",
  })
  await writeTrackerLog({
    userName: session.name,
    action: "Старт профиля",
    detail: result.ok ? `Открыл профиль ${userId}` : result.message,
    level: result.ok ? "ok" : "error",
    profileId: userId,
  })
  if (!result.ok) {
    return { error: result.message }
  }

  revalidatePath("/constructor")
  revalidatePath("/settings/adspower")
  return {}
}

export async function stopAdsPowerProfile(userId: string): Promise<AdsPowerActionResult> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  const result = await stopAdsPowerBrowser(userId)
  await writeActionLog({
    userName: session.name,
    action: "Стоп профиля",
    detail: result.ok ? `Закрыт ${userId}` : result.message,
    level: result.ok ? "ok" : "error",
    profileId: userId,
    source: "adspower",
  })
  await writeTrackerLog({
    userName: session.name,
    action: "Стоп профиля",
    detail: result.ok ? `Остановил профиль ${userId}` : result.message,
    level: result.ok ? "ok" : "error",
    profileId: userId,
  })
  if (!result.ok) {
    return { error: result.message }
  }

  revalidatePath("/constructor")
  revalidatePath("/settings/adspower")
  return {}
}

export async function runFacebookCommentTask(input: {
  profileId: string
  url: string
  message: string
  fanName?: string
  likeWithComment?: boolean
  subscribePage?: boolean
}): Promise<AdsPowerActionResult> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  const profileId = input.profileId.trim()
  const url = normalizeFacebookUrl(input.url)
  const message = input.message.trim()

  if (!profileId) {
    return { error: "Выберите профиль" }
  }
  if (!isFacebookUrl(url)) {
    return { error: "Вставьте ссылку на Facebook" }
  }
  if (!message) {
    return { error: "Введите сообщение" }
  }
  if (message.length > 8000) {
    return { error: "Сообщение слишком длинное" }
  }

  const result = await runFacebookComment(
    {
      profileId,
      url,
      message,
      fanName: input.fanName?.trim() || undefined,
      likeWithComment: input.likeWithComment,
      subscribePage: input.subscribePage,
    },
    (line) => {
      void writeActionLog({
        userName: session.name,
        action: "Комментарий",
        detail: line.text,
        level: line.level,
        profileId,
        source: "adspower",
      })
    },
  )
  await writeActionLog({
    userName: session.name,
    action: "Комментарий",
    detail: result.ok ? `${profileId} · ${url}` : result.message,
    level: result.ok ? "ok" : "error",
    profileId,
    source: "adspower",
  })
  const kind = input.subscribePage
    ? "Комментарий + лайк + подписка"
    : input.likeWithComment
      ? "Комментарий + лайк"
      : "Комментарий"
  await writeTrackerLog({
    userName: session.name,
    action: "Создал задачу",
    detail: result.ok ? `${kind} · ${profileId} · ${url}` : `${kind} · ${result.message}`,
    level: result.ok ? "ok" : "error",
    profileId,
  })
  revalidatePath("/constructor")
  revalidatePath("/settings/adspower")
  if (!result.ok) {
    return { error: result.message }
  }
  return { message: result.message }
}
