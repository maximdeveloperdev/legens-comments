"use server"

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

export async function enqueueFarmTask(input: {
  action: "comment" | "like" | "likeonly" | "subscribe"
  jobs: Array<{
    profileId: string
    fanName?: string
    url: string
    message: string
  }>
}): Promise<EnqueueFarmResult> {
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
    }))
    .filter((job) => job.profileId && isFacebookUrl(job.url) && (action === "likeonly" || job.message))

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
