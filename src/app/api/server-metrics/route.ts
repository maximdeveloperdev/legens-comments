import { NextResponse } from "next/server"
import { getServerMetrics } from "@/lib/server-metrics"
import { requireAdminSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await requireAdminSession()
  if (!session) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 })
  }

  const data = await getServerMetrics()
  return NextResponse.json(data)
}
