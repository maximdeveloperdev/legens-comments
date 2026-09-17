import { FarmQueue } from "@/app/(app)/constructor/farm-queue"
import { getActiveSession } from "@/lib/session"

type QueuePageProps = {
  searchParams: Promise<{ tab?: string }>
}

function queueTab(value: string | undefined) {
  return value === "completed" ? "completed" : "work"
}

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const user = await getActiveSession()
  const { tab } = await searchParams

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="grid gap-1">
        <h1 className="font-heading text-lg font-medium">Очередь</h1>
      </div>
      <FarmQueue
        full
        showTabs
        initialTab={queueTab(tab)}
        canManage={user?.role === "ADMIN"}
        currentUserName={user?.name}
      />
    </div>
  )
}
