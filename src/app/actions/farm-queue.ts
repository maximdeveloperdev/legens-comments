"use server"

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { FarmJobStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { writeTrackerLog } from "@/lib/action-log"
import { stopAdsPowerBrowser } from "@/lib/adspower"
import { kickFarmQueue } from "@/lib/farm-queue"
import { prisma } from "@/lib/db"
import { getActiveSession, requireAdminSession } from "@/lib/session"

export type EnqueueFarmResult = {
  error?: string
  taskId?: string
  total?: number
}

type EnqueueFarmInput = {
  action: "comment" | "like" | "likeonly" | "subscribe"
  jobs: Array<{
    profileId: string
    fanName?: string
    url: string
    message: string
    aiComment?: boolean
  }>
}

const MAX_COMMENT_PHOTO_SIZE = 10 * 1024 * 1024
const COMMENT_PHOTO_DIR = path.join(process.cwd(), "public", "uploads", "farm-comments")

function commentPhotoExt(file: File) {
  const mimeExt: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  }
  if (mimeExt[file.type]) return mimeExt[file.type]
  const ext = path.extname(file.name || "").replace(/^\./, "").toLowerCase()
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return ext === "jpeg" ? "jpg" : ext
  return "jpg"
}

async function saveCommentPhoto(file: File | null) {
  if (!file || file.size === 0) return { photoPath: "" }
  if (!file.type.startsWith("image/")) {
    return { error: "Можно прикрепить только фото" }
  }
  if (file.size > MAX_COMMENT_PHOTO_SIZE) {
    return { error: "Фото должно быть до 10 МБ" }
  }

  await mkdir(COMMENT_PHOTO_DIR, { recursive: true })
  const fileName = `${Date.now()}-${randomUUID()}.${commentPhotoExt(file)}`
  const diskPath = path.join(COMMENT_PHOTO_DIR, fileName)
  await writeFile(diskPath, Buffer.from(await file.arrayBuffer()))
  return { photoPath: `/uploads/farm-comments/${fileName}` }
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

async function createFarmTask(input: EnqueueFarmInput, photoPath = ""): Promise<EnqueueFarmResult> {
  const session = await getActiveSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  const action = input.action
  if (action !== "comment" && action !== "like" && action !== "likeonly" && action !== "subscribe") {
    return { error: "Неизвестное действие" }
  }

  const jobs = input.jobs
    .map((job) => ({
      profileId: job.profileId.trim(),
      fanName: (job.fanName || "").trim(),
      url: normalizeFacebookUrl(job.url),
      message: job.message.trim(),
      aiComment: action !== "likeonly" && job.aiComment === true,
      photoPath: action !== "likeonly" ? photoPath : "",
    }))
    .filter((job) => job.profileId && isFacebookUrl(job.url) && (action === "likeonly" || job.aiComment || job.message))

  if (jobs.length === 0) {
    return { error: "Нет заданий для очереди" }
  }
  if (jobs.length > 2000) {
    return { error: "Слишком много заданий за раз (макс. 2000)" }
  }
  if (jobs.some((job) => job.message.length > 8000)) {
    return { error: "Сообщение слишком длинное" }
  }

  const task = await prisma.farmTask.create({
    data: {
      createdBy: session.name,
      action,
      total: jobs.length,
      jobs: {
        create: jobs.map((job) => ({
          action,
          profileId: job.profileId,
          fanName: job.fanName,
          url: job.url,
          message: job.message,
          aiComment: job.aiComment,
          photoPath: job.photoPath,
        })),
      },
    },
  })

  const kind =
    action === "subscribe"
      ? "Комментарий + лайк + подписка"
      : action === "like"
        ? "Комментарий + лайк"
        : action === "likeonly"
          ? "Лайк"
          : "Комментарий"

  await writeTrackerLog({
    userName: session.name,
    action: "Создал задачу",
    detail: `${kind} · ${jobs.length} шт. в очередь`,
  })

  after(() => {
    kickFarmQueue()
  })

  return { taskId: task.id, total: jobs.length }
}

export async function enqueueFarmTask(input: EnqueueFarmInput): Promise<EnqueueFarmResult> {
  return createFarmTask(input)
}

export async function enqueueFarmTaskForm(formData: FormData): Promise<EnqueueFarmResult> {
  const raw = formData.get("payload")
  if (typeof raw !== "string") {
    return { error: "Нет данных задачи" }
  }

  let input: EnqueueFarmInput
  try {
    input = JSON.parse(raw) as EnqueueFarmInput
  } catch {
    return { error: "Не удалось прочитать данные задачи" }
  }

  const photo = formData.get("photo")
  const saved = await saveCommentPhoto(photo instanceof File ? photo : null)
  if (saved.error) {
    return { error: saved.error }
  }

  return createFarmTask(input, saved.photoPath)
}

export async function stopFarmTask(taskId?: string): Promise<{ error?: string; stopped?: number }> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  const recent = { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }
  const jobWhere = taskId
    ? { taskId }
    : {
        OR: [
          { status: { in: [FarmJobStatus.PENDING, FarmJobStatus.RUNNING] } },
          { status: FarmJobStatus.ERROR, createdAt: recent },
        ],
      }

  const jobs = await prisma.farmJob.findMany({
    where: jobWhere,
    select: { profileId: true },
  })
  if (taskId && jobs.length === 0) {
    return { error: "Задача не найдена" }
  }

  const profileIds = [...new Set(jobs.map((job) => job.profileId).filter(Boolean))]
  for (const profileId of profileIds) {
    await stopAdsPowerBrowser(profileId)
  }

  const cancelled = await prisma.farmJob.updateMany({
    where: taskId
      ? { taskId, status: { in: [FarmJobStatus.PENDING, FarmJobStatus.RUNNING] } }
      : { status: { in: [FarmJobStatus.PENDING, FarmJobStatus.RUNNING] } },
    data: {
      status: FarmJobStatus.ERROR,
      error: "Остановлено",
      finishedAt: new Date(),
    },
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Стоп задачи",
    detail: taskId
      ? `Остановил задачу · профилей ${profileIds.length}`
      : `Остановил очередь · профилей ${profileIds.length}`,
  })

  return { stopped: cancelled.count }
}

export async function startFarmTask(taskId?: string): Promise<{ error?: string; started?: number }> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  if (!taskId) {
    const pending = await prisma.farmJob.count({
      where: { status: FarmJobStatus.PENDING },
    })
    if (pending === 0) {
      return { error: "Нечего запускать" }
    }
    await writeTrackerLog({
      userName: session.name,
      action: "Старт задачи",
      detail: `Запустил очередь · ${pending} шт.`,
    })
    after(() => {
      kickFarmQueue()
    })
    return { started: pending }
  }
  const where = {
    taskId,
    status: { in: [FarmJobStatus.ERROR, FarmJobStatus.RUNNING] },
  }
  const jobs = await prisma.farmJob.findMany({
    where,
    select: { profileId: true },
  })
  const profileIds = [...new Set(jobs.map((job) => job.profileId).filter(Boolean))]
  for (const profileId of profileIds) {
    await stopAdsPowerBrowser(profileId)
  }

  const reset = await prisma.farmJob.updateMany({
    where,
    data: {
      status: FarmJobStatus.PENDING,
      error: null,
      startedAt: null,
      finishedAt: null,
    },
  })

  if (reset.count === 0) {
    const pending = await prisma.farmJob.count({
      where: taskId
        ? { taskId, status: FarmJobStatus.PENDING }
        : { status: FarmJobStatus.PENDING },
    })
    if (pending === 0) {
      return { error: "Нечего запускать" }
    }
  }

  await writeTrackerLog({
    userName: session.name,
    action: "Старт задачи",
    detail: taskId
      ? `Запустил задачу · ${reset.count} шт.`
      : `Запустил очередь · ${reset.count} шт.`,
  })

  after(() => {
    kickFarmQueue()
  })

  return { started: reset.count }
}

export async function deleteFarmTasks(taskIds: string[]): Promise<{ error?: string; deleted?: number }> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) {
    return { error: "Выберите задачи" }
  }

  const tasks = await prisma.farmTask.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      jobs: { select: { profileId: true } },
    },
  })
  if (tasks.length === 0) {
    return { error: "Задачи не найдены" }
  }

  const profileIds = [
    ...new Set(tasks.flatMap((task) => task.jobs.map((job) => job.profileId)).filter(Boolean)),
  ]
  for (const profileId of profileIds) {
    await stopAdsPowerBrowser(profileId)
  }

  const deleted = await prisma.farmTask.deleteMany({
    where: { id: { in: tasks.map((task) => task.id) } },
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Удалил задачи",
    detail: `Удалил ${deleted.count} шт. · профилей ${profileIds.length}`,
  })

  revalidatePath("/stats")
  revalidatePath("/queue")
  revalidatePath("/constructor")

  return { deleted: deleted.count }
}
