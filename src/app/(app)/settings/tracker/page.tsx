import { formatActionLogDate, listActionLogs } from "@/lib/action-log"
import { parseActionLogsPage, parseActionLogsPageSize } from "../action-logs-params"
import { ActionLogsTable } from "../action-logs-table"
import { SettingsSection } from "../settings-section"

type LogsPageProps = {
  searchParams: Promise<{ q?: string; page?: string; size?: string }>
}

export default async function TrackerLogsPage({ searchParams }: LogsPageProps) {
  const params = await searchParams
  const logs = await listActionLogs(2000, "tracker")

  return (
    <SettingsSection
      title="Логи действий в трекере"
      description="Кто что сделал: вход, задачи, синхронизация, профили и пользователи."
    >
      <ActionLogsTable
        clearSource="tracker"
        emptyText="Пока нет действий. Они появятся, когда кто-то войдёт, создаст задачу или изменит данные."
        rows={logs.map((log) => ({
          date: formatActionLogDate(log.createdAt),
          user: log.userName,
          action: log.action,
          detail: log.detail,
        }))}
        initialQuery={params.q ?? ""}
        initialPage={parseActionLogsPage(params.page)}
        initialPageSize={parseActionLogsPageSize(params.size)}
      />
    </SettingsSection>
  )
}
