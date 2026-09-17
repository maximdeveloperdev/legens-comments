import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"

export type ActionLogSource = "tracker" | "adspower"

export async function writeActionLog(input: {
  userName: string
  action: string
  detail: string
  level?: string
  profileId?: string
  source?: ActionLogSource
}) {
  const source = input.source || "adspower"
  try {
    await prisma.actionLog.create({
      data: {
        userName: input.userName,
        action: input.action,
        detail: input.detail,
        level: input.level || "info",
        source,
        profileId: input.profileId || null,
      },
    })
    if (source === "tracker") {
      revalidatePath("/settings/tracker")
    }
  } catch (error) {
    console.error("action log", error)
  }
}

export async function writeTrackerLog(input: {
  userName: string
  action: string
  detail: string
  level?: string
  profileId?: string
}) {
  await writeActionLog({ ...input, source: "tracker" })
}

export async function listActionLogs(limit = 300, source?: ActionLogSource) {
  return prisma.actionLog.findMany({
    where: source ? { source } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}

export function formatActionLogDate(value: Date) {
  return value.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}
