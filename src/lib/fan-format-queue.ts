import { existsSync } from "node:fs"
import path from "node:path"
import { FanPageAssetType, FarmJobStatus, Gender, Prisma, type FanFormatJob as DbFanFormatJob } from "@prisma/client"
import { writeActionLog, writeTrackerLog } from "@/lib/action-log"
import { prisma } from "@/lib/db"
import { runFacebookFanFormatQueue, type FanFormatJob as FacebookFanFormatJob } from "@/lib/facebook-page-switch"
import { generateFanIdentity } from "@/lib/openai-fan-format"

const DEFAULT_MAX_PARALLEL = 1
const HARD_MAX_PARALLEL = 5

let processing = false

export type FanFormatQueueInput = {
  profileId: string
  fans: Array<{ name: string; geo?: string; teamMarker?: string }>
}

export type FanFormatJobView = {
  id: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  status: FarmJobStatus
  profileId: string
  total: number
  message: string
  error: string | null
  formattedCount: number
  pendingCount: number
  failedCount: number
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeMarker(value: string | undefined) {
  return (value || "").trim().toUpperCase()
}

function normalizeFans(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((fan) => {
      if (!fan || typeof fan !== "object") return null
      const item = fan as { name?: unknown; geo?: unknown; teamMarker?: unknown }
      const name = typeof item.name === "string" ? item.name.trim() : ""
      if (!name) return null
      return {
        name,
        geo: typeof item.geo === "string" ? item.geo.trim().toUpperCase() : "",
        teamMarker: typeof item.teamMarker === "string" ? normalizeMarker(item.teamMarker) : "",
      }
    })
    .filter((fan): fan is { name: string; geo: string; teamMarker: string } => Boolean(fan))
}

function identityGenderToAssetGender(gender: string | undefined) {
  if (gender === "male") return Gender.MALE
  if (gender === "female") return Gender.FEMALE
  return null
}

function genderLabel(gender: Gender | null) {
  if (gender === Gender.MALE) return "муж."
  if (gender === Gender.FEMALE) return "жен."
  return "любой"
}

function assetDiskPath(url: string) {
  const cleanUrl = url.split("?")[0] || ""
  if (!cleanUrl.startsWith("/uploads/fan-page-library/")) return ""
  return path.join(process.cwd(), "public", cleanUrl.replace(/^\/+/, ""))
}

function jsonArrayLength(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value.length : 0
}

export function serializeFanFormatJob(job: DbFanFormatJob): FanFormatJobView {
  return {
    id: job.id,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    status: job.status,
    profileId: job.profileId,
    total: job.total,
    message: job.message,
    error: job.error,
    formattedCount: jsonArrayLength(job.formatted),
    pendingCount: jsonArrayLength(job.pending),
    failedCount: jsonArrayLength(job.failed),
  }
}

export function getFanFormatQueueMaxParallel() {
  const parsed = Number(process.env.FAN_FORMAT_QUEUE_MAX_PARALLEL || DEFAULT_MAX_PARALLEL)
  if (!Number.isInteger(parsed)) return DEFAULT_MAX_PARALLEL
  return Math.min(Math.max(parsed, 1), HARD_MAX_PARALLEL)
}

async function pickRandomLibraryAsset(input: {
  type: FanPageAssetType
  geoCode: string
  teamMarker: string
  gender?: Gender | null
}) {
  const geoCode = input.geoCode.trim().toUpperCase()
  const teamMarker = normalizeMarker(input.teamMarker)
  if (!geoCode) return null

  const baseWhere: Prisma.FanPageAssetWhereInput = {
    type: input.type,
    geoCode,
  }
  if (teamMarker && teamMarker !== "ALL") {
    baseWhere.team = { marker: teamMarker }
  }

  const whereOptions =
    input.type === FanPageAssetType.AVATAR && input.gender
      ? [{ ...baseWhere, gender: input.gender }, { ...baseWhere, gender: Gender.ANY }]
      : [baseWhere]

  for (const where of whereOptions) {
    const count = await prisma.fanPageAsset.count({ where })
    if (count === 0) continue

    const [asset] = await prisma.fanPageAsset.findMany({
      where,
      orderBy: { id: "asc" },
      skip: Math.floor(Math.random() * count),
      take: 1,
      include: { team: { select: { name: true, marker: true } } },
    })
    if (asset) return asset
  }
  return null
}

async function claimNextFanFormatJob(maxParallel: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`LOCK TABLE "FanFormatJob" IN SHARE ROW EXCLUSIVE MODE`
    const running = await tx.fanFormatJob.findMany({
      where: { status: FarmJobStatus.RUNNING },
      select: { profileId: true },
    })
    if (running.length >= maxParallel) return null
    const busyProfileIds = [...new Set(running.map((job) => job.profileId).filter(Boolean))]
    const next = await tx.fanFormatJob.findFirst({
      where: {
        status: FarmJobStatus.PENDING,
        ...(busyProfileIds.length > 0 ? { profileId: { notIn: busyProfileIds } } : {}),
      },
      orderBy: { createdAt: "asc" },
    })
    if (!next) return null
    return tx.fanFormatJob.update({
      where: { id: next.id },
      data: {
        status: FarmJobStatus.RUNNING,
        startedAt: new Date(),
        finishedAt: null,
        message: "В работе",
        error: null,
      },
    })
  })
}

async function runFanFormatJob(job: DbFanFormatJob) {
  const fans = normalizeFans(job.fans)
  const log = (line: { level: "info" | "ok" | "error"; text: string }) => {
    void writeActionLog({
      userName: job.createdBy || "очередь",
      action: "Форматирование фанок",
      detail: line.text,
      level: line.level,
      profileId: job.profileId,
      source: "adspower",
    })
  }

  try {
    if (fans.length === 0) throw new Error("В задаче нет фанок")
    log({ level: "info", text: `Фоновая задача началась · профиль ${job.profileId} · фанок ${fans.length}` })

    const countryRows = await prisma.country.findMany({
      where: { code: { in: [...new Set(fans.map((fan) => fan.geo).filter(Boolean))] } },
      select: { code: true, nameEn: true, nameRu: true },
    })
    const countries = Object.fromEntries(countryRows.map((country) => [country.code, country]))
    const queueJobs = fans.map((fan) => ({
      currentName: fan.name,
      geo: fan.geo,
      teamMarker: fan.teamMarker,
    }))

    const result = await runFacebookFanFormatQueue(
      job.profileId,
      queueJobs,
      async (fan: FacebookFanFormatJob & { geo?: string; teamMarker?: string }) => {
        const country = fan.geo ? countries[fan.geo] : undefined
        log({
          level: "info",
          text: `Генерируем имя для «${fan.currentName}»${fan.geo ? ` · ${fan.geo}` : ""}${fan.teamMarker ? ` · ${fan.teamMarker}` : ""}`,
        })
        const identity = await generateFanIdentity({
          currentName: fan.currentName,
          geo: fan.geo || "",
          countryName: country?.nameEn || country?.nameRu,
          includeMediaPrompts: false,
        })
        log({
          level: "ok",
          text: `Имя сгенерировано: ${fan.currentName} → ${identity.fullName} · ${identity.gender === "male" ? "муж." : "жен."}`,
        })
        return {
          currentName: fan.currentName,
          firstName: identity.firstName,
          lastName: identity.lastName,
          newName: identity.fullName,
          gender: identity.gender,
        }
      },
      log,
      async (fan, queueJob: FacebookFanFormatJob & { geo?: string; teamMarker?: string }) => {
        const geoCode = (queueJob.geo || "").trim().toUpperCase()
        const teamMarker = normalizeMarker(queueJob.teamMarker)
        const avatarGender = identityGenderToAssetGender(fan.gender)
        log({
          level: "info",
          text: `Берём аватарку из библиотеки для «${fan.newName}» · ${teamMarker || "ALL"} · ${geoCode || "без гео"} · ${genderLabel(avatarGender)}`,
        })

        const avatarAsset = await pickRandomLibraryAsset({
          type: FanPageAssetType.AVATAR,
          geoCode,
          teamMarker,
          gender: avatarGender,
        })

        const avatarPath = avatarAsset ? assetDiskPath(avatarAsset.url) : ""
        const prepared: { avatarPath?: string } = {}

        if (avatarPath && existsSync(avatarPath)) {
          prepared.avatarPath = avatarPath
          log({
            level: "ok",
            text: `Аватарка выбрана из библиотеки: ${avatarAsset?.team.marker} · ${geoCode} · ${genderLabel(avatarAsset?.gender ?? null)} · ${avatarAsset?.originalName}`,
          })
        } else {
          log({
            level: "info",
            text: `Аватарку пропускаем: нет файла в библиотеке для ${teamMarker || "ALL"} · ${geoCode || "без гео"} · ${genderLabel(avatarGender)}`,
          })
        }

        log({ level: "info", text: "Обложку не меняем: оставляем текущую в Facebook" })
        return prepared
      },
    )

    for (const item of result.formatted || []) {
      if (item.nameApplied === false) continue
      const gender = identityGenderToAssetGender(item.gender)
      await prisma.facebookFan.updateMany({
        where: { adsPowerUserId: job.profileId, name: item.currentName },
        data: {
          name: item.newName,
          syncedAt: new Date(),
          ...(gender ? { gender } : {}),
        },
      })
    }

    const failed = result.failed || []
    const ok = result.ok && failed.length === 0
    await prisma.fanFormatJob.updateMany({
      where: { id: job.id, status: FarmJobStatus.RUNNING },
      data: {
        status: ok ? FarmJobStatus.DONE : FarmJobStatus.ERROR,
        finishedAt: new Date(),
        message: result.message,
        error: ok ? null : result.message,
        formatted: (result.formatted || []) as unknown as Prisma.InputJsonValue,
        pending: (result.pending || []) as unknown as Prisma.InputJsonValue,
        failed: failed as unknown as Prisma.InputJsonValue,
      },
    })
    await writeTrackerLog({
      userName: job.createdBy,
      action: "Форматирование фанок",
      detail: result.message,
      level: ok ? "ok" : "error",
      profileId: job.profileId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Форматирование не прошло"
    log({ level: "error", text: message })
    await prisma.fanFormatJob.updateMany({
      where: { id: job.id, status: FarmJobStatus.RUNNING },
      data: {
        status: FarmJobStatus.ERROR,
        finishedAt: new Date(),
        message,
        error: message,
        failed: [{ message }] as unknown as Prisma.InputJsonValue,
      },
    })
    await writeTrackerLog({
      userName: job.createdBy,
      action: "Форматирование фанок",
      detail: message,
      level: "error",
      profileId: job.profileId,
    })
  } finally {
    await pause(3000)
  }
}

async function processFanFormatQueue() {
  if (processing) return
  processing = true
  const maxParallel = getFanFormatQueueMaxParallel()
  const active = new Set<Promise<void>>()
  try {
    await prisma.fanFormatJob.updateMany({
      where: { status: FarmJobStatus.RUNNING },
      data: { status: FarmJobStatus.PENDING, startedAt: null, error: null, message: "Возвращено в очередь после рестарта" },
    })

    while (true) {
      while (active.size < maxParallel) {
        const job = await claimNextFanFormatJob(maxParallel)
        if (!job) break
        const task = runFanFormatJob(job)
        const tracked = task.finally(() => {
          active.delete(tracked)
        })
        active.add(tracked)
      }

      if (active.size === 0) {
        const pending = await prisma.fanFormatJob.count({ where: { status: FarmJobStatus.PENDING } })
        if (pending === 0) break
        await pause(1000)
        continue
      }

      await Promise.race(active)
    }
  } finally {
    await Promise.allSettled(active)
    processing = false
  }

  const leftover = await prisma.fanFormatJob.count({ where: { status: FarmJobStatus.PENDING } })
  if (leftover > 0) kickFanFormatQueue()
}

export function kickFanFormatQueue() {
  void processFanFormatQueue()
}

export async function enqueueFanFormatJobs(input: {
  createdBy: string
  createdByUserId?: string
  jobs: FanFormatQueueInput[]
}) {
  const created: DbFanFormatJob[] = []
  for (const job of input.jobs) {
    const profileId = job.profileId.trim()
    const fans = normalizeFans(job.fans)
    if (!profileId || fans.length === 0) continue
    created.push(
      await prisma.fanFormatJob.create({
        data: {
          createdBy: input.createdBy,
          createdByUserId: input.createdByUserId,
          profileId,
          total: fans.length,
          fans: fans as unknown as Prisma.InputJsonValue,
          message: "В очереди",
        },
      }),
    )
  }
  if (created.length > 0) kickFanFormatQueue()
  return created
}

export async function listFanFormatJobs(options: { ids?: string[]; limit?: number } = {}) {
  const jobs = await prisma.fanFormatJob.findMany({
    where: options.ids && options.ids.length > 0 ? { id: { in: options.ids } } : undefined,
    orderBy: { createdAt: "desc" },
    take: options.ids && options.ids.length > 0 ? undefined : options.limit ?? 20,
  })
  return jobs.map(serializeFanFormatJob)
}
