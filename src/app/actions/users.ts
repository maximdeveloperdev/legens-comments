"use server"

import bcrypt from "bcryptjs"
import { revalidatePath } from "next/cache"
import { UserRole } from "@prisma/client"
import { prisma } from "@/lib/db"
import { writeTrackerLog } from "@/lib/action-log"
import { deleteUserAvatarFiles, saveUserAvatar, validateAvatarFile } from "@/lib/avatar"
import { requireAdminSession } from "@/lib/session"

export type UserActionResult = {
  error?: string
}

function parseRole(value: FormDataEntryValue | null): UserRole | null {
  if (value === UserRole.ADMIN || value === UserRole.USER) {
    return value
  }
  return null
}

function parseBool(value: FormDataEntryValue | null) {
  return value === "true" || value === "on" || value === "1"
}

function getAvatarFile(formData: FormData) {
  const file = formData.get("avatar")
  if (!(file instanceof File) || file.size === 0) return null
  return file
}

async function applyAvatar(userId: string, file: File | null) {
  if (!file) return {}
  const error = validateAvatarFile(file)
  if (error) return { error }
  const saved = await saveUserAvatar(userId, file)
  if (saved.error || !saved.avatarUrl) {
    return { error: saved.error ?? "Не удалось сохранить фото" }
  }
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: saved.avatarUrl },
  })
  return {}
}

export async function createUser(formData: FormData): Promise<UserActionResult> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нет доступа" }
  }

  const name = String(formData.get("name") ?? "").trim()
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
  const password = String(formData.get("password") ?? "")
  const role = parseRole(formData.get("role"))
  const active = parseBool(formData.get("active"))

  if (!name || !email || !password || !role) {
    return { error: "Заполните имя, почту, пароль и роль" }
  }

  if (password.length < 6) {
    return { error: "Пароль должен быть не короче 6 символов" }
  }

  const avatar = getAvatarFile(formData)
  if (avatar) {
    const avatarError = validateAvatarFile(avatar)
    if (avatarError) return { error: avatarError }
  }

  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) {
    return { error: "Пользователь с такой почтой уже есть" }
  }

  const created = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      active,
    },
  })

  const avatarResult = await applyAvatar(created.id, avatar)
  if (avatarResult.error) return avatarResult

  await writeTrackerLog({
    userName: session.name,
    action: "Создал пользователя",
    detail: `${name} · ${email} · ${role === UserRole.ADMIN ? "Админ" : "Юзер"}`,
  })

  revalidatePath("/users")
  return {}
}

export async function updateUser(formData: FormData): Promise<UserActionResult> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нет доступа" }
  }

  const id = String(formData.get("id") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
  const password = String(formData.get("password") ?? "")
  const role = parseRole(formData.get("role"))
  const twoFactorEnabled = parseBool(formData.get("twoFactorEnabled"))
  const active = parseBool(formData.get("active"))

  if (!id || !name || !email || !role) {
    return { error: "Заполните имя, почту и роль" }
  }

  if (password && password.length < 6) {
    return { error: "Пароль должен быть не короче 6 символов" }
  }

  const current = await prisma.user.findUnique({ where: { id } })
  if (!current) {
    return { error: "Пользователь не найден" }
  }

  const emailTaken = await prisma.user.findFirst({
    where: { email, NOT: { id } },
  })
  if (emailTaken) {
    return { error: "Пользователь с такой почтой уже есть" }
  }

  if (current.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
    const adminCount = await prisma.user.count({ where: { role: UserRole.ADMIN } })
    if (adminCount <= 1) {
      return { error: "Нельзя убрать роль у последнего админа" }
    }
  }

  if (session.id === id && !active) {
    return { error: "Нельзя отключить свой аккаунт" }
  }

  if (twoFactorEnabled && !current.twoFactorEnabled) {
    return { error: "2FA включает сам пользователь в профиле" }
  }

  const avatar = getAvatarFile(formData)
  if (avatar) {
    const avatarError = validateAvatarFile(avatar)
    if (avatarError) return { error: avatarError }
  }

  await prisma.user.update({
    where: { id },
    data: {
      name,
      email,
      role,
      twoFactorEnabled,
      ...(twoFactorEnabled ? {} : { twoFactorSecret: null }),
      active,
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    },
  })

  const avatarResult = await applyAvatar(id, avatar)
  if (avatarResult.error) return avatarResult

  await writeTrackerLog({
    userName: session.name,
    action: "Изменил пользователя",
    detail: `${name} · ${email}${password ? " · новый пароль" : ""}`,
  })

  revalidatePath("/users")
  if (session.id === id) {
    revalidatePath("/profile", "layout")
  }
  return {}
}

export async function deleteUser(formData: FormData): Promise<UserActionResult> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нет доступа" }
  }

  const id = String(formData.get("id") ?? "")
  if (!id) {
    return { error: "Пользователь не найден" }
  }

  if (session.id === id) {
    return { error: "Нельзя удалить свой аккаунт" }
  }

  const current = await prisma.user.findUnique({ where: { id } })
  if (!current) {
    return { error: "Пользователь не найден" }
  }

  if (current.role === UserRole.ADMIN) {
    const adminCount = await prisma.user.count({ where: { role: UserRole.ADMIN } })
    if (adminCount <= 1) {
      return { error: "Нельзя удалить последнего админа" }
    }
  }

  await prisma.user.delete({ where: { id } })
  await deleteUserAvatarFiles(id)
  await writeTrackerLog({
    userName: session.name,
    action: "Удалил пользователя",
    detail: `${current.name} · ${current.email}`,
  })
  revalidatePath("/users")
  return {}
}

export async function bulkUpdateUsers(formData: FormData): Promise<UserActionResult> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нет доступа" }
  }

  const ids = formData
    .getAll("ids")
    .map((value) => String(value))
    .filter(Boolean)
  const disableTwoFactor = parseBool(formData.get("disableTwoFactor"))
  const disableActive = parseBool(formData.get("disableActive"))

  if (!ids.length) {
    return { error: "Никого не выбрали" }
  }

  if (!disableTwoFactor && !disableActive) {
    return { error: "Выберите действие" }
  }

  const data: {
    twoFactorEnabled?: boolean
    twoFactorSecret?: null
    active?: boolean
  } = {}
  if (disableTwoFactor) {
    data.twoFactorEnabled = false
    data.twoFactorSecret = null
  }
  if (disableActive) {
    data.active = false
  }

  const targetIds = disableActive
    ? ids.filter((id) => id !== session.id)
    : ids

  if (!targetIds.length) {
    return { error: "Нельзя отключить свой аккаунт" }
  }

  await prisma.user.updateMany({
    where: { id: { in: targetIds } },
    data,
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Массовое действие",
    detail: [
      `${targetIds.length} польз.`,
      disableTwoFactor ? "выкл. 2FA" : "",
      disableActive ? "отключил" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  })

  revalidatePath("/users")

  if (disableActive && targetIds.length !== ids.length) {
    return { error: "Свой аккаунт пропущен, остальные обновлены" }
  }

  return {}
}
