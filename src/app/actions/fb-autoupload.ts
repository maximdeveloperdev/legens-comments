"use server"

import { revalidatePath } from "next/cache"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db"
import { writeTrackerLog } from "@/lib/action-log"
import { requireAdminSession } from "@/lib/session"

export type FbAutouploadActionResult = {
  error?: string
  id?: number
  deleted?: number
}

const autouploadPaths = [
  "/fb-autoupload",
  "/fb-autoupload/bindings",
  "/fb-autoupload/binding-groups",
  "/fb-autoupload/uploads",
]

function revalidateAutoupload() {
  for (const path of autouploadPaths) {
    revalidatePath(path)
  }
}

function parseId(value: FormDataEntryValue | null) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function parseIdList(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return []

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)
  } catch {
    return []
  }
}

function parseMaybeJson(value: string): Prisma.InputJsonValue | string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value

  try {
    return JSON.parse(trimmed) as Prisma.InputJsonValue
  } catch {
    return value
  }
}

function formDataToConfig(formData: FormData): Prisma.InputJsonObject {
  const config: Record<string, Prisma.InputJsonValue> = {}

  for (const [key, value] of formData.entries()) {
    if (key === "name") continue
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const parsed = parseMaybeJson(trimmed) as Prisma.InputJsonValue
    const current = config[key]

    if (current === undefined) {
      config[key] = parsed
      continue
    }

    config[key] = Array.isArray(current)
      ? [...current, parsed]
      : [current, parsed]
  }

  return config as Prisma.InputJsonObject
}

export async function createFbAutouploadBindingGroup(
  formData: FormData,
): Promise<FbAutouploadActionResult> {
  const session = await requireAdminSession()
  if (!session) return { error: "Нет доступа" }

  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { error: "Введите название группы" }

  const created = await prisma.fbAutouploadBindingGroup.create({
    data: { name },
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Создал группу связок",
    detail: `${created.id} · ${created.name}`,
  })

  revalidateAutoupload()
  return { id: created.id }
}

export async function updateFbAutouploadBindingGroup(
  formData: FormData,
): Promise<FbAutouploadActionResult> {
  const session = await requireAdminSession()
  if (!session) return { error: "Нет доступа" }

  const id = parseId(formData.get("id"))
  const name = String(formData.get("name") ?? "").trim()

  if (!id) return { error: "Группа не найдена" }
  if (!name) return { error: "Введите название группы" }

  const updated = await prisma.fbAutouploadBindingGroup.update({
    where: { id },
    data: { name },
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Изменил группу связок",
    detail: `${updated.id} · ${updated.name}`,
  })

  revalidateAutoupload()
  return { id: updated.id }
}

export async function deleteFbAutouploadBindingGroup(
  formData: FormData,
): Promise<FbAutouploadActionResult> {
  const session = await requireAdminSession()
  if (!session) return { error: "Нет доступа" }

  const id = parseId(formData.get("id"))
  if (!id) return { error: "Группа не найдена" }

  await prisma.fbAutouploadBindingGroup.delete({ where: { id } })

  await writeTrackerLog({
    userName: session.name,
    action: "Удалил группу связок",
    detail: String(id),
  })

  revalidateAutoupload()
  return { deleted: 1 }
}

export async function deleteFbAutouploadBindingGroups(
  formData: FormData,
): Promise<FbAutouploadActionResult> {
  const session = await requireAdminSession()
  if (!session) return { error: "Нет доступа" }

  const ids = parseIdList(formData.get("ids"))
  if (!ids.length) return { error: "Выберите группы" }

  const result = await prisma.fbAutouploadBindingGroup.deleteMany({
    where: { id: { in: ids } },
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Удалил группы связок",
    detail: ids.join(", "),
  })

  revalidateAutoupload()
  return { deleted: result.count }
}

export async function createFbAutouploadBinding(
  formData: FormData,
): Promise<FbAutouploadActionResult> {
  const session = await requireAdminSession()
  if (!session) return { error: "Нет доступа" }

  const explicitName = String(formData.get("name") ?? "").trim()
  const created = await prisma.fbAutouploadBinding.create({
    data: {
      name: explicitName || `Связка ${new Date().toLocaleString("ru-RU")}`,
      createdBy: session.id,
      config: formDataToConfig(formData),
    },
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Создал связку автозалива",
    detail: `${created.id} · ${created.name}`,
  })

  revalidateAutoupload()
  return { id: created.id }
}
