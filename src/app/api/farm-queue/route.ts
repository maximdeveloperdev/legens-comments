import { NextResponse } from "next/server"
import { kickFarmQueue, listFarmQueue } from "@/lib/farm-queue"
import { getActiveSession, requireAdminSession } from "@/lib/session"

export const maxDuration = 30

export async function GET() {
  const session = await getActiveSession()
  if (!session) {
    return NextResponse.json({ error: "Нужно войти в аккаунт" }, { status: 401 })
  }

  const data = await listFarmQueue()
  return NextResponse.json(data)
}

export async function POST() {
  const session = await requireAdminSession()
  if (!session) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 })
  }

  kickFarmQueue()
  return NextResponse.json({ ok: true })
}
