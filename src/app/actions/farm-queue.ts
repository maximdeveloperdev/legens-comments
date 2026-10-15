"use server"

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { FarmJobStatus, Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { commentMediaError, commentMediaExtension, hasCommentMediaSignature, MAX_COMMENT_MEDIA_TOTAL_SIZE } from "@/lib/comment-media"
import { writeTrackerLog } from "@/lib/action-log"
import { stopAdsPowerBrowser } from "@/lib/adspower"
import { getFarmProfileAccessError } from "@/lib/adspower-profile-access"
import { rewriteFarmJobsForAntiSpam } from "@/lib/farm-comment-auto-rewrite"
import { buildFarmTaskCopy, type CopyDraft, type CopySourceJob } from "@/lib/farm-task-copy"
import { getFarmCopyCatalog } from "@/lib/farm-copy-catalog"
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
  name?: string
  action: "comment" | "like" | "likeonly" | "subscribe" | "mixed" | "comment_like"
  jobs: Array<{
    action?: "comment" | "like" | "likeonly" | "subscribe" | "comment_like"
    clientKey?: string
    replyToKey?: string
    profileId: string
    fanName?: string
    url: string
    message: string
    aiComment?: boolean
    photoKey?: string
  }>
}

const COMMENT_PHOTO_DIR = path.join(process.cwd(), "public", "uploads", "farm-comments")
const FARM_ACTIONS = new Set(["comment", "like", "likeonly", "subscribe", "comment_like"])
const MESSAGELESS_ACTIONS = new Set(["likeonly", "comment_like"])

type FarmJobCreateRow = {
  id: string
  action: string
  profileId: string
  fanName: string
  url: string
  message: string
  aiComment: boolean
  photoPath: string
  replyToJobId?: string | null
}

async function createFarmJobsInReplyOrder(
  tx: Prisma.TransactionClient,
  taskId: string,
  rows: FarmJobCreateRow[],
) {
  const created = new Set<string>()
  let pending = [...rows]

  while (pending.length > 0) {
    const ready = pending.filter((row) => !row.replyToJobId || created.has(row.replyToJobId))
    if (ready.length === 0) {
      throw new Error("Не удалось сохранить ветку комментариев: родительский комментарий не найден")
    }

    await tx.farmJob.createMany({
      data: ready.map((row) => ({
        ...row,
        taskId,
      })),
    })
    for (const row of ready) created.add(row.id)
    const readyIds = new Set(ready.map((row) => row.id))
    pending = pending.filter((row) => !readyIds.has(row.id))
  }
}

async function readCommentMedia(file: File): Promise<{ error: string } | { bytes: Buffer; ext: string }> {
  const error = commentMediaError(file)
  if (error) return { error }
  const bytes = Buffer.from(await file.arrayBuffer())
  const ext = commentMediaExtension(file)
  if (!hasCommentMediaSignature(bytes, ext)) return { error: "Содержимое файла не соответствует формату фото, GIF или MP4" }
  return { bytes, ext }
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
  formData?: FormData,
): Promise<EnqueueFarmResult> {
  const session = await getActiveSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  const action = input.action
  if (action !== "mixed" && !FARM_ACTIONS.has(action)) {
    return { error: "Неизвестное действие" }
  }

  let jobs = input.jobs
    .map((job) => {
      const jobAction = job.action && FARM_ACTIONS.has(job.action) ? job.action : action === "mixed" ? "comment" : action
      const needsMessage = !MESSAGELESS_ACTIONS.has(jobAction)
      return {
        action: jobAction,
        profileId: job.profileId.trim(),
        fanName: (job.fanName || "").trim(),
        url: normalizeFacebookUrl(job.url),
        message: job.message.trim(),
        aiComment: needsMessage && job.aiComment === true,
        clientKey: (job.clientKey || "").trim(),
        replyToKey: (job.replyToKey || "").trim(),
        photoKey: job.photoKey || "",
        photoPath: "",
      }
    })
    .filter((job) => job.profileId && isFacebookUrl(job.url) && (MESSAGELESS_ACTIONS.has(job.action) || job.aiComment || job.message))

  if (jobs.length === 0) {
    return { error: "Нет заданий для очереди" }
  }
  if (jobs.length > 2000) {
    return { error: "Слишком много заданий за раз (макс. 2000)" }
  }
  if (jobs.some((job) => job.message.length > 8000)) {
    return { error: "Сообщение слишком длинное" }
  }
  const accessError = await getFarmProfileAccessError(session, jobs.map((job) => job.profileId))
  if (accessError) return { error: accessError }

  if (formData) {
    const photoPaths = new Map<string, string>()
    const files = new Map<string, File>()
    const globalFile = formData.get("photo")
    if (globalFile instanceof File) files.set("__global__", globalFile)
    for (const key of new Set(jobs.map((job) => job.photoKey).filter(Boolean))) {
      const file = formData.get(`photo:${key}`)
      if (file instanceof File) files.set(key, file)
    }
    const totalBytes = [...files.values()].reduce((sum, file) => sum + file.size, Buffer.byteLength(JSON.stringify(input)))
    if (totalBytes > MAX_COMMENT_MEDIA_TOTAL_SIZE) return { error: "Общий размер вложений и задачи должен быть до 70 МБ" }
    const prepared = new Map<string, { bytes: Buffer; ext: string }>()
    for (const [key, file] of files) {
      const media = await readCommentMedia(file)
      if ("error" in media) return { error: media.error }
      prepared.set(key, media)
    }
    if (prepared.size) await mkdir(COMMENT_PHOTO_DIR, { recursive: true })
    for (const [key, media] of prepared) {
      const fileName = `${Date.now()}-${randomUUID()}.${media.ext}`
      await writeFile(path.join(COMMENT_PHOTO_DIR, fileName), media.bytes)
      photoPaths.set(key, `/uploads/farm-comments/${fileName}`)
    }
    jobs = jobs.map((job) => ({
      ...job,
      photoPath: MESSAGELESS_ACTIONS.has(job.action)
        ? ""
        : photoPaths.get(job.photoKey) || photoPaths.get("__global__") || "",
    }))
  }
  let finalJobs = jobs
  let rewritten = 0
  const commentJobs = jobs.filter((job) => !MESSAGELESS_ACTIONS.has(job.action))
  if (commentJobs.length > 0) {
    const antiSpam = await rewriteFarmJobsForAntiSpam({ jobs: commentJobs }).catch((error) => ({
      ok: false,
      jobs: commentJobs,
      rewritten: 0,
      message: error instanceof Error ? error.message : "Антиспам: не удалось перефразировать комментарии",
    }))
    if (!antiSpam.ok) {
      return { error: antiSpam.message || "Антиспам: проверь комментарии" }
    }
    let commentIndex = 0
    finalJobs = jobs.map((job) => {
      if (MESSAGELESS_ACTIONS.has(job.action)) return job
      const rewrittenJob = antiSpam.jobs[commentIndex]
      commentIndex += 1
      return rewrittenJob || job
    })
    rewritten = antiSpam.rewritten
  }

  const taskRows = (() => {
    const idByClientKey = new Map<string, string>()
    const rows = finalJobs.map((job) => {
      const id = randomUUID()
      if (job.clientKey) idByClientKey.set(job.clientKey, id)
      return { ...job, id }
    })
    return rows.map((job) => ({
      id: job.id,
      action: job.action,
      profileId: job.profileId,
      fanName: job.fanName,
      url: job.url,
      message: job.message,
      aiComment: job.aiComment,
      photoPath: job.photoPath,
      replyToJobId: job.replyToKey ? idByClientKey.get(job.replyToKey) || null : null,
    }))
  })()

  const task = await prisma.$transaction(async (tx) => {
    const createdTask = await tx.farmTask.create({
      data: {
        name: (input.name || "").trim(),
        createdBy: session.name,
        createdByUserId: session.id,
        action,
        total: finalJobs.length,
      },
    })
    await createFarmJobsInReplyOrder(tx, createdTask.id, taskRows)
    return createdTask
  })

  const kind =
    action === "subscribe"
      ? "Комментарий + лайк + подписка"
      : action === "like"
        ? "Комментарий + лайк"
        : action === "likeonly"
          ? "Лайк"
          : action === "comment_like"
            ? "Лайк комментария"
          : action === "mixed"
            ? "Смешанная задача"
          : "Комментарий"

  const taskName = (input.name || "").trim()
  await writeTrackerLog({
    userName: session.name,
    action: "Создал задачу",
    detail: `${taskName ? `${taskName} · ` : ""}${kind} · ${finalJobs.length} шт. в очередь${rewritten > 0 ? ` · AI перефразировал ${rewritten}` : ""}`,
  })

  after(() => {
    kickFarmQueue()
  })
  revalidatePath("/tasks")

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

  return createFarmTask(input, formData)
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

export async function getFarmTaskCopyOptions(taskId: string) {
  const session = await getActiveSession()
  if (!session) return { error: "Нужно войти в аккаунт" }
  const access = farmTaskAccessWhere(await getFarmQueueAccess(session))
  const task = await prisma.farmTask.findFirst({
    where: access ? { AND: [{ id: taskId }, access] } : { id: taskId }, select: { id: true },
  })
  if (!task) return { error: "Задача не найдена или нет доступа" }
  try {
    const { fans, geos, countries } = await getFarmCopyCatalog(session)
    return { countries, geos, available: fans.length }
  } catch {
    return { error: "Не удалось загрузить доступные профили. Попробуйте ещё раз." }
  }
}

export async function duplicateFarmTask(input: {
  taskId: string
  urls: string[]
  comments?: Array<{ jobId?: string; message?: string }>
  draft?: CopyDraft
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

  const accessError = await getFarmProfileAccessError(session, task.jobs.map((job) => job.profileId))
  if (accessError) return { error: accessError }

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

  let sourceJobs: CopySourceJob[] = task.jobs
  if (input.draft) {
    try {
      const catalog = await getFarmCopyCatalog(session)
      sourceJobs = buildFarmTaskCopy(task.jobs, input.draft, catalog.fans, urlByOriginal)
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Не удалось подобрать фанки" }
    }
  }
  const nextJobs = sourceJobs.map((job) => {
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
  if (nextJobs.some(({ job, message }) => !MESSAGELESS_ACTIONS.has(job.action) && !message && !job.aiComment)) {
    return { error: "Заполните комментарии или оставьте AI-комментарий для генерации" }
  }

  const commentNextJobs = nextJobs.filter(({ job }) => !MESSAGELESS_ACTIONS.has(job.action))
  const antiSpam = await rewriteFarmJobsForAntiSpam({
    jobs: commentNextJobs.map(({ job, message }) => ({
      id: job.id,
      profileId: job.profileId,
      fanName: job.fanName,
      url: input.draft ? job.url : (urlByOriginal.get(job.url) ?? job.url),
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
  const newIdByOldId = new Map(nextJobs.map(({ job }) => [job.id, randomUUID()]))

  const duplicateRows = nextJobs.map(({ job, message }) => ({
    id: newIdByOldId.get(job.id) || randomUUID(),
    action: job.action,
    profileId: job.profileId,
    fanName: job.fanName,
    url: input.draft ? job.url : (urlByOriginal.get(job.url) ?? job.url),
    message: rewrittenMessages.get(job.id) ?? message,
    aiComment: job.aiComment && !(rewrittenMessages.get(job.id) ?? message),
    photoPath: job.photoPath,
    replyToJobId: job.replyToJobId ? newIdByOldId.get(job.replyToJobId) || null : null,
  }))

  const duplicated = await prisma.$transaction(async (tx) => {
    const createdTask = await tx.farmTask.create({
      data: {
        name: task.name ? `${task.name} · копия` : "",
        createdBy: session.name,
        createdByUserId: session.id,
        action: input.draft ? (new Set(duplicateRows.map((row) => row.action)).size > 1 ? "mixed" : duplicateRows[0].action) : task.action,
        total: duplicateRows.length,
      },
    })
    await createFarmJobsInReplyOrder(tx, createdTask.id, duplicateRows)
    return createdTask
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Скопировал задачу",
    detail: `${task.action} · ${duplicateRows.length} шт. · ${originalUrls.length} → ${newUrls.length} пост.${antiSpam.rewritten > 0 ? ` · AI перефразировал ${antiSpam.rewritten}` : ""}`,
  })

  revalidatePath("/stats")
  revalidatePath("/queue")
  revalidatePath("/constructor")
  revalidatePath("/tasks")

  after(() => {
    kickFarmQueue()
  })

  return { taskId: duplicated.id, total: duplicateRows.length, rewritten: antiSpam.rewritten }
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
  revalidatePath("/tasks")

  return { deleted: deleted.count }
}
