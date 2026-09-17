import { prisma } from "@/lib/db"
import type { AdsPowerFan } from "@/lib/adspower"

export type SyncedFan = {
  name: string
  position: number
  current: boolean
}

export async function replaceFacebookFans(adsPowerUserId: string, fans: SyncedFan[]) {
  await prisma.$transaction([
    prisma.facebookFan.deleteMany({ where: { adsPowerUserId } }),
    ...fans.map((fan) =>
      prisma.facebookFan.create({
        data: {
          adsPowerUserId,
          name: fan.name,
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
      position: row.position,
      current: row.current,
    })
    grouped.set(row.adsPowerUserId, list)
  }
  return grouped
}
