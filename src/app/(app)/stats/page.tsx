import { FarmQueue } from "@/app/(app)/constructor/farm-queue"
import { getActiveSession } from "@/lib/session"

const PAGE_SIZES = new Set([20, 50, 100, 200, 500])

type StatsPageProps = {
  searchParams: Promise<{ q?: string; page?: string; size?: string }>
}

function parsePage(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function parsePageSize(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && PAGE_SIZES.has(parsed) ? parsed : 50
}

export default async function StatsPage({ searchParams }: StatsPageProps) {
  const user = await getActiveSession()
  const params = await searchParams

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="grid gap-1">
        <h1 className="font-heading text-lg font-medium">Статистика</h1>
      </div>
      <FarmQueue
        full
        cards
        tableTools
        canManage={user?.role === "ADMIN"}
        currentUserName={user?.name}
        initialQuery={params.q ?? ""}
        initialPage={parsePage(params.page)}
        initialPageSize={parsePageSize(params.size)}
      />
    </div>
  )
}
