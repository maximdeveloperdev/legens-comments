import { prisma } from "@/lib/db"
import { inferFanGenders } from "@/lib/fan-gender"
import { Gender } from "@prisma/client"
import type { AdsPowerFan } from "@/lib/adspower"

export type SyncedFan = {
  name: string
  gender?: Gender | null
  position: number
  current: boolean
}

type FanSyncLog = {
  level: "info" | "ok" | "error"
  text: string
}

function concreteGender(value: Gender | null | undefined) {
  return value === Gender.MALE || value === Gender.FEMALE ? value : null
}

export async function replaceFacebookFans(
  adsPowerUserId: string,
  fans: SyncedFan[],
  options: { geo?: string; log?: (line: FanSyncLog) => void } = {},
) {
  const existingFans = await prisma.facebookFan.findMany({
    where: { adsPowerUserId },
    select: { name: true, position: true, gender: true },
  })
  const genderByPosition = new Map(existingFans.map((fan) => [fan.position, fan.gender]))
  const genderByName = new Map(existingFans.map((fan) => [fan.name, fan.gender]))
  const preparedFans = fans.map((fan) => ({
    ...fan,
    gender:
      concreteGender(fan.gender) ??
      concreteGender(genderByName.get(fan.name)) ??
      concreteGender(genderByPosition.get(fan.position)),
  }))

  const missingGender = preparedFans
    .map((fan, index) => ({ fan, index }))
    .filter(({ fan }) => !fan.gender)

  if (missingGender.length > 0) {
    const inference = await inferFanGenders(
      missingGender.map(({ fan, index }) => ({
        key: String(index),
        name: fan.name,
        geo: options.geo,
      })),
    )

    for (const { fan, index } of missingGender) {
      const guess = inference.guesses.get(String(index))
      fan.gender = guess?.gender ?? null
    }

    const sourceParts = [
      inference.counts.dictionary > 0 ? `словарь ${inference.counts.dictionary}` : "",
      inference.counts.heuristic > 0 ? `эвристика ${inference.counts.heuristic}` : "",
      inference.counts.openai > 0 ? `GPT ${inference.counts.openai}` : "",
    ].filter(Boolean)
    const suffix = [
      sourceParts.length > 0 ? `источник: ${sourceParts.join(", ")}` : "",
      inference.openAiError ? `GPT fallback не сработал: ${inference.openAiError}` : "",
    ].filter(Boolean)
    options.log?.({
      level: inference.counts.unknown > 0 ? "info" : "ok",
      text: `Пол фанок определён: муж. ${inference.counts.male}, жен. ${inference.counts.female}, неизвестно ${inference.counts.unknown}${
        suffix.length > 0 ? ` · ${suffix.join(" · ")}` : ""
      }`,
    })
  }

  await prisma.$transaction([
    prisma.facebookFan.deleteMany({ where: { adsPowerUserId } }),
    ...preparedFans.map((fan) =>
      prisma.facebookFan.create({
        data: {
          adsPowerUserId,
          name: fan.name,
          gender: concreteGender(fan.gender),
          position: fan.position,
          current: fan.current,
        },
      }),
    ),
  ])
}

export async function listFacebookFansByProfile(profileIds: string[]) {
  if (profileIds.length === 0) return new Map<string, AdsPowerFan[]>()

  const rows = await prisma.facebookFan.findMany({
    where: { adsPowerUserId: { in: profileIds } },
    orderBy: { position: "asc" },
  })

  const grouped = new Map<string, AdsPowerFan[]>()
  for (const row of rows) {
    const list = grouped.get(row.adsPowerUserId) ?? []
    list.push({
      id: row.id,
      name: row.name,
      gender: row.gender,
      position: row.position,
      current: row.current,
    })
    grouped.set(row.adsPowerUserId, list)
  }
  return grouped
}
