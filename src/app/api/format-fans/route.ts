import { NextResponse } from "next/server"
import { enqueueFanFormatJobs, kickFanFormatQueue, listFanFormatJobs, type FanFormatQueueInput } from "@/lib/fan-format-queue"
import { requireAdminSession } from "@/lib/session"

export const maxDuration = 30
export const dynamic = "force-dynamic"

type FormatFanRequest = {
  profileId?: string
  fans?: Array<{ name?: string; geo?: string; teamMarker?: string }>
  jobs?: Array<{
    profileId?: string
    fans?: Array<{ name?: string; geo?: string; teamMarker?: string }>
  }>
}

function normalizeMarker(value: string | undefined) {
  return (value || "").trim().toUpperCase()
}

function normalizeFans(value: FormatFanRequest["fans"]) {
  return (value || [])
    .map((fan) => ({
      name: fan.name?.trim() || "",
      geo: fan.geo?.trim().toUpperCase() || "",
      teamMarker: normalizeMarker(fan.teamMarker),
    }))
    .filter((fan) => fan.name)
}

function normalizeJobs(body: FormatFanRequest | null): FanFormatQueueInput[] {
  const jobs = Array.isArray(body?.jobs)
    ? body.jobs.map((job) => ({ profileId: job.profileId?.trim() || "", fans: normalizeFans(job.fans) }))
    : [
        {
          profileId: body?.profileId?.trim() || "",
          fans: normalizeFans(body?.fans),
        },
      ]
  return jobs.filter((job) => job.profileId && job.fans.length > 0)
}

export async function GET(request: Request) {
  const session = await requireAdminSession()
  if (!session) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 })
  }

  const url = new URL(request.url)
  const ids = (url.searchParams.get("ids") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  kickFanFormatQueue()
  const jobs = await listFanFormatJobs({ ids, limit: 30 })
  return NextResponse.json({ jobs })
}

export async function POST(request: Request) {
  const session = await requireAdminSession()
  if (!session) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as FormatFanRequest | null
  const jobs = normalizeJobs(body)
  if (jobs.length === 0) return NextResponse.json({ error: "Выберите профиль и фанку" }, { status: 400 })

  const created = await enqueueFanFormatJobs({
    createdBy: session.name,
    createdByUserId: session.id,
    jobs,
  })
  if (created.length === 0) return NextResponse.json({ error: "Нет задач для форматирования" }, { status: 400 })

  return NextResponse.json({
    ok: true,
    jobs: created.map((job) => ({
      id: job.id,
      profileId: job.profileId,
      total: job.total,
      status: job.status,
    })),
  })
}
