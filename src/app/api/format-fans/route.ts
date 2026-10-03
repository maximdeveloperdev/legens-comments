import { revalidatePath } from "next/cache"
import { writeActionLog, writeTrackerLog } from "@/lib/action-log"
import { prisma } from "@/lib/db"
import { generateFanAvatar, generateFanCover, generateFanIdentity } from "@/lib/openai-fan-format"
import { runFacebookFanFormatQueue, type FanFormatJob } from "@/lib/facebook-page-switch"
import { requireAdminSession } from "@/lib/session"

export const maxDuration = 300
export const dynamic = "force-dynamic"

type FormatFanRequest = {
  profileId?: string
  fans?: Array<{ name?: string; geo?: string }>
}

const COVER_THEMES = ["nature", "cars", "venue", "history", "music"] as const

function pickCoverTheme(seed: string) {
  const total = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return COVER_THEMES[total % COVER_THEMES.length]
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
        const jobs = fans.map((fan) => ({ currentName: fan.name, geo: fan.geo }))
        const result = await runFacebookFanFormatQueue(
          profileId,
          jobs,
          async (fan: FanFormatJob & { geo?: string }) => {
            const country = fan.geo ? countries[fan.geo] : undefined
            log({
              level: "info",
              text: `Генерируем имя для «${fan.currentName}»${fan.geo ? ` · ${fan.geo}` : ""}`,
            })
            const identity = await generateFanIdentity({
              currentName: fan.currentName,
              geo: fan.geo || "",
              countryName: country?.nameEn || country?.nameRu,
              includeMediaPrompts: false,
            })
            log({ level: "ok", text: `Имя сгенерировано: ${fan.currentName} → ${identity.fullName}` })
            return {
              currentName: fan.currentName,
              firstName: identity.firstName,
              lastName: identity.lastName,
              newName: identity.fullName,
            }
          },
          log,
          async (fan, job: FanFormatJob & { geo?: string }) => {
            const country = job.geo ? countries[job.geo] : undefined
            const countryName = country?.nameEn || country?.nameRu
            const coverTheme = fan.coverTheme || pickCoverTheme(`${fan.newName}:${job.geo || ""}`)
            log({ level: "info", text: `Имя применилось — генерируем avatar/cover для «${fan.newName}»` })
            const avatar = await generateFanAvatar({
              fullName: fan.newName,
              geo: job.geo || "",
              countryName,
              prompt:
                fan.avatarPrompt ||
                `Realistic original headshot photo of an adult person from ${countryName || job.geo || "Europe"}, natural light, neutral background, social media profile picture, not a celebrity.`,
            })
            const cover = await generateFanCover({
              fullName: fan.newName,
              geo: job.geo || "",
              countryName,
              theme: coverTheme,
              prompt:
                fan.coverPrompt ||
                `Wide Facebook cover photo scene from ${countryName || job.geo || "Europe"}, theme ${coverTheme}, clean composition, no text, no logos.`,
            })
            log({ level: "ok", text: `Сгенерированы avatar/cover: ${fan.newName} · cover ${coverTheme}` })
            return {
              avatarPath: avatar.filePath,
              coverPath: cover.filePath,
              coverTheme,
            }
          },
        )
        const pending = result.pending || []
        const failed = result.failed || []
        const ok = result.ok && failed.length === 0
        const message = result.message
        for (const item of result.formatted || []) {
          if (item.nameApplied === false) continue
          await prisma.facebookFan.updateMany({
            where: { adsPowerUserId: profileId, name: item.currentName },
            data: { name: item.newName, syncedAt: new Date() },
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
