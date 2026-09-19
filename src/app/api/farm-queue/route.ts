import { NextResponse } from "next/server"
import { kickFarmQueue, listFarmQueue } from "@/lib/farm-queue"
import { getActiveSession, requireAdminSession } from "@/lib/session"

export const maxDuration = 30

type FarmQueueData = Awaited<ReturnType<typeof listFarmQueue>>

function hideOtherUsersQueue(data: FarmQueueData, currentUserName: string) {
  return {
    ...data,
    tasks: data.tasks.map((task) => {
      if (task.createdBy === currentUserName) return task
      return {
        ...task,
        createdBy: "Другой пользователь",
        jobs: [],
      }
    }),
  }
}

export async function GET(request: Request) {
  const session = await getActiveSession()
  if (!session) {
    return NextResponse.json({ error: "Нужно войти в аккаунт" }, { status: 401 })
  }

  const url = new URL(request.url)
  const ownOnly = url.searchParams.get("scope") === "own"
  if (ownOnly) {
    const data = await listFarmQueue({ createdBy: session.name })
    return NextResponse.json(data)
  }

  const data = await listFarmQueue()
  return NextResponse.json(session.role === "ADMIN" ? data : hideOtherUsersQueue(data, session.name))
}

export async function POST() {
  const session = await requireAdminSession()
  if (!session) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 })
  }

  kickFarmQueue()
  return NextResponse.json({ ok: true })
}
