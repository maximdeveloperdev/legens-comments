import path from "node:path"
import { existsSync } from "node:fs"
import { FanPageAssetType, Gender, type Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { writeActionLog, writeTrackerLog } from "@/lib/action-log"
import { prisma } from "@/lib/db"
import { generateFanIdentity } from "@/lib/openai-fan-format"
import { runFacebookFanFormatQueue, type FanFormatJob } from "@/lib/facebook-page-switch"
import { requireAdminSession } from "@/lib/session"

export const maxDuration = 300
export const dynamic = "force-dynamic"

type FormatFanRequest = {
  profileId?: string
  fans?: Array<{ name?: string; geo?: string; teamMarker?: string }>
}

function normalizeMarker(value: string | undefined) {
  return (value || "").trim().toUpperCase()
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

export async function POST(request: Request) {
  const session = await requireAdminSession()
  if (!session) {
    return Response.json({ error: "Нет доступа" }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as FormatFanRequest | null
  const profileId = body?.profileId?.trim() || ""
  const fans = (body?.fans || [])
    .map((fan) => ({
      name: fan.name?.trim() || "",
      geo: fan.geo?.trim().toUpperCase() || "",
      teamMarker: normalizeMarker(fan.teamMarker),
    }))
    .filter((fan) => fan.name)

  if (!profileId) return Response.json({ error: "Выберите профиль" }, { status: 400 })
  if (fans.length === 0) return Response.json({ error: "Выберите фанку" }, { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }
      const log = (line: { level: "info" | "ok" | "error"; text: string }) => {
        send({ type: "log", level: line.level, text: line.text })
        void writeActionLog({
          userName: session.name,
          action: "Форматирование фанок",
          detail: line.text,
          level: line.level,
          profileId,
          source: "adspower",
        })
      }

      await writeTrackerLog({
        userName: session.name,
        action: "Форматирование фанок",
        detail: `Запустил · профиль ${profileId} · фанок ${fans.length}`,
        profileId,
      })

      try {
        const countryRows = await prisma.country.findMany({
          where: { code: { in: [...new Set(fans.map((fan) => fan.geo).filter(Boolean))] } },
          select: { code: true, nameEn: true, nameRu: true },
        })
        const countries = Object.fromEntries(countryRows.map((country) => [country.code, country]))
        const jobs = fans.map((fan) => ({
          currentName: fan.name,
          geo: fan.geo,
          teamMarker: fan.teamMarker,
        }))
        const result = await runFacebookFanFormatQueue(
          profileId,
          jobs,
          async (fan: FanFormatJob & { geo?: string; teamMarker?: string }) => {
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
          async (fan, job: FanFormatJob & { geo?: string; teamMarker?: string }) => {
            const geoCode = (job.geo || "").trim().toUpperCase()
            const teamMarker = normalizeMarker(job.teamMarker)
            const avatarGender = identityGenderToAssetGender(fan.gender)
            log({
              level: "info",
              text: `Имя применилось — берём avatar/cover из библиотеки для «${fan.newName}» · ${teamMarker || "ALL"} · ${geoCode || "без гео"} · ${genderLabel(avatarGender)}`,
            })

            const [avatarAsset, coverAsset] = await Promise.all([
              pickRandomLibraryAsset({
                type: FanPageAssetType.AVATAR,
                geoCode,
                teamMarker,
                gender: avatarGender,
              }),
              pickRandomLibraryAsset({
                type: FanPageAssetType.COVER,
                geoCode,
                teamMarker,
              }),
            ])

            const avatarPath = avatarAsset ? assetDiskPath(avatarAsset.url) : ""
            const coverPath = coverAsset ? assetDiskPath(coverAsset.url) : ""
            const result: { avatarPath?: string; coverPath?: string; coverTheme?: string } = {}

            if (avatarPath && existsSync(avatarPath)) {
              result.avatarPath = avatarPath
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

            if (coverPath && existsSync(coverPath)) {
              result.coverPath = coverPath
              result.coverTheme = `library ${coverAsset?.team.marker || teamMarker || "ALL"} ${geoCode}`.trim()
              log({
                level: "ok",
                text: `Обложка выбрана из библиотеки: ${coverAsset?.team.marker} · ${geoCode} · ${coverAsset?.originalName}`,
              })
            } else {
              log({
                level: "info",
                text: `Обложку пропускаем: нет файла в библиотеке для ${teamMarker || "ALL"} · ${geoCode || "без гео"}`,
              })
            }

            return {
              ...result,
            }
          },
        )
        const pending = result.pending || []
        const failed = result.failed || []
        const ok = result.ok && failed.length === 0
        const message = result.message
        for (const item of result.formatted || []) {
          if (item.nameApplied === false) continue
          const gender = identityGenderToAssetGender(item.gender)
          await prisma.facebookFan.updateMany({
            where: { adsPowerUserId: profileId, name: item.currentName },
            data: {
              name: item.newName,
              syncedAt: new Date(),
              ...(gender ? { gender } : {}),
            },
          })
        }

        await writeTrackerLog({
          userName: session.name,
          action: "Форматирование фанок",
          detail: message,
          level: ok ? "ok" : "error",
          profileId,
        })
        send({
          type: "done",
          ok,
          message,
          formatted: result.formatted || [],
          pending,
          failed,
        })
        revalidatePath("/constructor")
      } catch (error) {
        const message = error instanceof Error ? error.message : "Форматирование не прошло"
        log({ level: "error", text: message })
        await writeTrackerLog({
          userName: session.name,
          action: "Форматирование фанок",
          detail: message,
          level: "error",
          profileId,
        })
        send({ type: "done", ok: false, message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
