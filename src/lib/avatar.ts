import { mkdir, unlink, writeFile } from "fs/promises"
import path from "path"

const ALLOWED = ["image/jpeg", "image/png", "image/webp"]
const MAX_BYTES = 2 * 1024 * 1024
const AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars")

export function validateAvatarFile(file: File) {
  if (file.size === 0) return "Выберите фото"
  if (file.size > MAX_BYTES) return "Файл больше 2 МБ"
  if (!ALLOWED.includes(file.type)) return "Нужен JPG, PNG или WEBP"
  return null
}

export async function saveUserAvatar(userId: string, file: File) {
  const error = validateAvatarFile(file)
  if (error) return { error }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"
  await mkdir(AVATAR_DIR, { recursive: true })
  const filename = `${userId}.${ext}`
  await writeFile(path.join(AVATAR_DIR, filename), Buffer.from(await file.arrayBuffer()))

  for (const oldExt of ["png", "jpg", "webp"] as const) {
    if (oldExt === ext) continue
    await unlink(path.join(AVATAR_DIR, `${userId}.${oldExt}`)).catch(() => undefined)
  }

  return { avatarUrl: `/uploads/avatars/${filename}?v=${Date.now()}` }
}

export async function deleteUserAvatarFiles(userId: string) {
  for (const ext of ["png", "jpg", "webp"] as const) {
    await unlink(path.join(AVATAR_DIR, `${userId}.${ext}`)).catch(() => undefined)
  }
}
