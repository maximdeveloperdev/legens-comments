
import { getTranslations } from "@/lib/i18n-server"
import Link from "next/link"
import { PlusCircle } from "lucide-react"
import { FarmQueue, type QueueSort, type QueueStatusFilter } from "@/app/(app)/constructor/farm-queue"
import { Button } from "@/components/ui/button"
import { getActiveSession } from "@/lib/session"

const PAGE_SIZES = new Set([20, 50, 100, 200, 500])
const SORTS = new Set<QueueSort>(["latest", "oldest"])
const STATUSES = new Set<QueueStatusFilter>([
  "all",
  "succeed",
  "in_progress",
  "pending",
  "all_failed",
  "failed",
  "partially_failed",
])

type TasksListPageProps = {
  searchParams: Promise<{
    q?: string
    page?: string
    size?: string
    sort?: string
    status?: string
    team?: string
  }>
}

function parsePage(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function parsePageSize(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && PAGE_SIZES.has(parsed) ? parsed : 50
}

function parseSort(value: string | undefined): QueueSort {
  return SORTS.has(value as QueueSort) ? (value as QueueSort) : "latest"
}

function parseStatus(value: string | undefined): QueueStatusFilter {
  return STATUSES.has(value as QueueStatusFilter) ? (value as QueueStatusFilter) : "all"
}

function queueScope(role: string | undefined) {
  if (role === "ADMIN") return "all"
  if (role === "TEAM_LEAD") return "team"
  return "own"
}

export default async function TasksListPage({ searchParams }: TasksListPageProps) {
  const t = await getTranslations()

  const user = await getActiveSession()
  const params = await searchParams
  const canManage = user?.role === "ADMIN"

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <section className="flex items-center justify-between gap-4 rounded-2xl border bg-gradient-to-r from-muted/80 to-card p-4 md:p-5">
        <div className="grid min-w-0 gap-1">
          <h1 className="font-heading text-lg font-medium">{t("Список задач")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Список задач с быстрыми действиями, статусами и сервисным сообщением внизу карточки.")}</p>
        </div>
        <Button render={<Link href="/tasks" />}>
          <PlusCircle />
          {t("Создать задачу")}</Button>
      </section>

      <FarmQueue
        full
        taskCards
        taskFilters
        tableTools
        canManage={canManage}
        currentUserName={user?.name}
        queueScope={queueScope(user?.role)}
        initialQuery={params.q ?? ""}
        initialSort={parseSort(params.sort)}
        initialStatus={parseStatus(params.status)}
        initialTeam={params.team?.trim() || "all"}
        initialPage={parsePage(params.page)}
        initialPageSize={parsePageSize(params.size)}
      />
    </div>
  )
}
