"use server"

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { FarmJobStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { writeTrackerLog } from "@/lib/action-log"
import { stopAdsPowerBrowser } from "@/lib/adspower"
import { rewriteFarmJobsForAntiSpam } from "@/lib/farm-comment-auto-rewrite"
import { kickFarmQueue } from "@/lib/farm-queue"
import { farmTaskAccessWhere, getFarmQueueAccess } from "@/lib/farm-queue-access"
import { prisma } from "@/lib/db"
import { getActiveSession, requireAdminSession } from "@/lib/session"

export type EnqueueFarmResult = {
  error?: string
  taskId?: string
  total?: number
  rewritten?: number
}

type EnqueueFarmInput = {
  action: "comment" | "like" | "likeonly" | "subscribe"
  jobs: Array<{
    profileId: string
    fanName?: string
    url: string
    message: string
    aiComment?: boolean
    photoKey?: string
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

async function createFarmTask(
  input: EnqueueFarmInput,
  photoPaths: Map<string, string> = new Map(),
): Promise<EnqueueFarmResult> {
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
      photoPath:
        action !== "likeonly"
          ? photoPaths.get(job.photoKey || "") || photoPaths.get("__global__") || ""
          : "",
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
  let finalJobs = jobs
  let rewritten = 0
  if (action !== "likeonly") {
    const antiSpam = await rewriteFarmJobsForAntiSpam({ jobs }).catch((error) => ({
      ok: false,
      jobs,
      rewritten: 0,
      message: error instanceof Error ? error.message : "Антиспам: не удалось перефразировать комментарии",
    }))
    if (!antiSpam.ok) {
      return { error: antiSpam.message || "Антиспам: проверь комментарии" }
    }
    finalJobs = antiSpam.jobs
    rewritten = antiSpam.rewritten
  }

  const task = await prisma.farmTask.create({
    data: {
      createdBy: session.name,
      createdByUserId: session.id,
      action,
      total: finalJobs.length,
      jobs: {
        create: finalJobs.map((job) => ({
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
    detail: `${kind} · ${finalJobs.length} шт. в очередь${rewritten > 0 ? ` · AI перефразировал ${rewritten}` : ""}`,
  })

  after(() => {
    kickFarmQueue()
  })

  return { taskId: task.id, total: finalJobs.length, rewritten }
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
  const photoPaths = new Map<string, string>()
  if (saved.photoPath) photoPaths.set("__global__", saved.photoPath)

  const photoKeys = [
    ...new Set(input.jobs.map((job) => job.photoKey).filter((key): key is string => Boolean(key))),
  ]
  for (const key of photoKeys) {
    const file = formData.get(`photo:${key}`)
    const savedForJob = await saveCommentPhoto(file instanceof File ? file : null)
    if (savedForJob.error) {
      return { error: savedForJob.error }
    }
    if (savedForJob.photoPath) photoPaths.set(key, savedForJob.photoPath)
  }

  return createFarmTask(input, photoPaths)
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

export async function duplicateFarmTask(input: {
  taskId: string
  urls: string[]
  comments?: Array<{ jobId?: string; message?: string }>
}): Promise<EnqueueFarmResult> {
  const session = await getActiveSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  const taskId = input.taskId.trim()
  const newUrls = [...new Set(input.urls.map(normalizeFacebookUrl).filter(Boolean))]
  if (!taskId) return { error: "Задача не найдена" }
  if (newUrls.length === 0) return { error: "Вставьте новую ссылку на пост" }
  if (newUrls.some((url) => !isFacebookUrl(url))) {
    return { error: "Можно копировать только на ссылки Facebook" }
  }

  const messageByJobId = new Map(
    (input.comments || [])
      .map((item) => [String(item.jobId || "").trim(), String(item.message ?? "")] as const)
      .filter(([jobId]) => Boolean(jobId)),
  )

  const access = await getFarmQueueAccess(session)
  const accessWhere = farmTaskAccessWhere(access)
  const task = await prisma.farmTask.findFirst({
    where: accessWhere ? { AND: [{ id: taskId }, accessWhere] } : { id: taskId },
    include: {
      jobs: { orderBy: { createdAt: "asc" } },
    },
  })
  if (!task) return { error: "Задача не найдена или нет доступа" }
  if (task.jobs.length === 0) return { error: "В задаче нет комментариев для копирования" }

  const originalUrls = [...new Set(task.jobs.map((job) => job.url).filter(Boolean))]
  if (newUrls.length > 1 && newUrls.length !== originalUrls.length) {
    return {
      error: `В старой задаче ${originalUrls.length} постов. Вставьте 1 ссылку или ${originalUrls.length} ссылок строками.`,
    }
  }

  const urlByOriginal = new Map<string, string>()
  for (const [index, originalUrl] of originalUrls.entries()) {
    urlByOriginal.set(originalUrl, newUrls.length === 1 ? newUrls[0] : newUrls[index])
  }

  const nextJobs = task.jobs.map((job) => {
    const message = messageByJobId.has(job.id)
      ? (messageByJobId.get(job.id) || "").trim()
      : job.message
    return {
      job,
      message,
    }
  })
  if (nextJobs.some(({ message }) => message.length > 8000)) {
    return { error: "Сообщение слишком длинное" }
  }
  if (task.action !== "likeonly" && nextJobs.some(({ job, message }) => !message && !job.aiComment)) {
    return { error: "Заполните комментарии или оставьте AI-комментарий для генерации" }
  }

  const antiSpam = await rewriteFarmJobsForAntiSpam({
    jobs: nextJobs.map(({ job, message }) => ({
      id: job.id,
      profileId: job.profileId,
      fanName: job.fanName,
      url: urlByOriginal.get(job.url) ?? newUrls[0],
      message,
      aiComment: job.aiComment && !message,
    })),
  }).catch((error) => ({
    ok: false,
    jobs: [],
    rewritten: 0,
    message: error instanceof Error ? error.message : "Антиспам: не удалось перефразировать комментарии",
  }))
  if (!antiSpam.ok) {
    return { error: antiSpam.message || "Антиспам: проверь комментарии" }
  }
  const rewrittenMessages = new Map(antiSpam.jobs.map((job) => [job.id || "", job.message]))

  const duplicated = await prisma.farmTask.create({
    data: {
      createdBy: session.name,
      createdByUserId: session.id,
      action: task.action,
      total: task.jobs.length,
      jobs: {
        create: nextJobs.map(({ job, message }) => ({
          action: job.action,
          profileId: job.profileId,
          fanName: job.fanName,
          url: urlByOriginal.get(job.url) ?? newUrls[0],
          message: rewrittenMessages.get(job.id) ?? message,
          aiComment: job.aiComment && !(rewrittenMessages.get(job.id) ?? message),
          photoPath: job.photoPath,
        })),
      },
    },
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Скопировал задачу",
    detail: `${task.action} · ${task.jobs.length} шт. · ${originalUrls.length} → ${newUrls.length} пост.${antiSpam.rewritten > 0 ? ` · AI перефразировал ${antiSpam.rewritten}` : ""}`,
  })

  revalidatePath("/stats")
  revalidatePath("/queue")
  revalidatePath("/constructor")

  after(() => {
    kickFarmQueue()
  })

  return { taskId: duplicated.id, total: task.jobs.length, rewritten: antiSpam.rewritten }
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
