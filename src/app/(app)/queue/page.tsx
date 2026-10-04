import { FarmQueue } from "@/app/(app)/constructor/farm-queue"
import { getActiveSession } from "@/lib/session"

const PAGE_SIZES = new Set([20, 50, 100, 200, 500])

type QueuePageProps = {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; size?: string }>
}

function queueTab(value: string | undefined) {
  return value === "completed" ? "completed" : "work"
}

function parsePage(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function parsePageSize(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && PAGE_SIZES.has(parsed) ? parsed : 50
}

function queueScope(role: string | undefined) {
  if (role === "ADMIN") return "all"
  if (role === "TEAM_LEAD") return "team"
  return "own"
}

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const user = await getActiveSession()
  const params = await searchParams
  const canManage = user?.role === "ADMIN"

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="grid gap-1">
        <h1 className="font-heading text-lg font-medium">Очередь</h1>
      </div>
      <FarmQueue
        full
        showTabs
        tableTools
        initialTab={queueTab(params.tab)}
        canManage={canManage}
        currentUserName={user?.name}
        queueScope={queueScope(user?.role)}
        initialQuery={params.q ?? ""}
        initialPage={parsePage(params.page)}
        initialPageSize={parsePageSize(params.size)}
      />
    </div>
  )
}
