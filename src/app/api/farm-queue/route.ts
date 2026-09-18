import { NextResponse } from "next/server"
import { kickFarmQueue, listFarmQueue } from "@/lib/farm-queue"
import { getActiveSession, requireAdminSession } from "@/lib/session"

export const maxDuration = 30

export async function GET(request: Request) {
  const session = await getActiveSession()
  if (!session) {
    return NextResponse.json({ error: "Нужно войти в аккаунт" }, { status: 401 })
  }

  const url = new URL(request.url)
  const ownOnly = url.searchParams.get("scope") === "own"
  const data = await listFarmQueue(ownOnly ? { createdBy: session.name } : undefined)
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
