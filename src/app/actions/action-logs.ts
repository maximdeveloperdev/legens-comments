"use server"

import { revalidatePath } from "next/cache"
import type { ActionLogSource } from "@/lib/action-log"
import { prisma } from "@/lib/db"
import { requireAdminSession } from "@/lib/session"

export async function clearActionLogs(source: ActionLogSource): Promise<{
  error?: string
  deleted?: number
}> {
  const session = await requireAdminSession()
  if (!session) {
    return { error: "Нет доступа" }
  }
  if (source !== "tracker" && source !== "adspower") {
    return { error: "Неизвестный раздел логов" }
  }

  const result = await prisma.actionLog.deleteMany({ where: { source } })

  revalidatePath(source === "tracker" ? "/settings/tracker" : "/settings/adspower")

  return { deleted: result.count }
}
