"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { writeTrackerLog } from "@/lib/action-log"
import { createSession, getActiveSession } from "@/lib/session"
import { saveUserAvatar } from "@/lib/avatar"
import { createTotpQr, createTotpSecret, verifyTotpCode } from "@/lib/totp"

export type ProfileActionResult = {
  error?: string
  qrDataUrl?: string
  secret?: string
  avatarUrl?: string
}

async function requireUser() {
  const session = await getActiveSession()
  if (!session) return null
  const user = await prisma.user.findUnique({ where: { id: session.id } })
  if (!user?.active) return null
  return { session, user }
}

export async function updateProfileName(formData: FormData): Promise<ProfileActionResult> {
  const auth = await requireUser()
  if (!auth) return { error: "Нет доступа" }

  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { error: "Введите имя" }

  const updated = await prisma.user.update({
    where: { id: auth.user.id },
    data: { name },
  })

  await createSession({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
  })

  revalidatePath("/profile", "layout")
  await writeTrackerLog({
    userName: updated.name,
    action: "Изменил имя",
    detail: updated.name,
  })
  return {}
}

export async function uploadAvatar(formData: FormData): Promise<ProfileActionResult> {
  const auth = await requireUser()
  if (!auth) return { error: "Нет доступа" }

  const file = formData.get("avatar")
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Выберите фото" }
  }

  const saved = await saveUserAvatar(auth.user.id, file)
  if (saved.error || !saved.avatarUrl) {
    return { error: saved.error ?? "Не удалось сохранить фото" }
  }

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { avatarUrl: saved.avatarUrl },
  })

  revalidatePath("/profile", "layout")
  revalidatePath("/users")
  await writeTrackerLog({
    userName: auth.session.name,
    action: "Обновил фото",
    detail: auth.user.email,
  })
  return { avatarUrl: saved.avatarUrl }
}

export async function startTwoFactor(): Promise<ProfileActionResult> {
  const auth = await requireUser()
  if (!auth) return { error: "Нет доступа" }
  if (auth.user.twoFactorEnabled) return { error: "2FA уже включена" }

  const secret = createTotpSecret()
  await prisma.user.update({
    where: { id: auth.user.id },
    data: { twoFactorSecret: secret, twoFactorEnabled: false },
  })

  const { qrDataUrl } = await createTotpQr(auth.user.email, secret)
  revalidatePath("/profile")
  return { qrDataUrl, secret }
}

export async function confirmTwoFactor(formData: FormData): Promise<ProfileActionResult> {
  const auth = await requireUser()
  if (!auth) return { error: "Нет доступа" }
  if (!auth.user.twoFactorSecret) return { error: "Сначала сгенерируйте QR" }

  const code = String(formData.get("code") ?? "")
  if (!verifyTotpCode(auth.user.email, auth.user.twoFactorSecret, code)) {
    return { error: "Неверный код" }
  }

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { twoFactorEnabled: true },
  })

  revalidatePath("/profile")
  revalidatePath("/users")
  await writeTrackerLog({
    userName: auth.session.name,
    action: "Включил 2FA",
    detail: auth.user.email,
  })
  return {}
}

export async function cancelTwoFactorSetup(): Promise<ProfileActionResult> {
  const auth = await requireUser()
  if (!auth) return { error: "Нет доступа" }
  if (auth.user.twoFactorEnabled) return { error: "2FA уже включена" }

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { twoFactorSecret: null },
  })

  revalidatePath("/profile")
  return {}
}

export async function disableTwoFactor(formData: FormData): Promise<ProfileActionResult> {
  const auth = await requireUser()
  if (!auth) return { error: "Нет доступа" }
  if (!auth.user.twoFactorEnabled || !auth.user.twoFactorSecret) {
    return { error: "2FA не включена" }
  }

  const code = String(formData.get("code") ?? "")
  if (!verifyTotpCode(auth.user.email, auth.user.twoFactorSecret, code)) {
    return { error: "Неверный код" }
  }

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  })

  revalidatePath("/profile")
  revalidatePath("/users")
  await writeTrackerLog({
    userName: auth.session.name,
    action: "Выключил 2FA",
    detail: auth.user.email,
  })
  return {}
}
