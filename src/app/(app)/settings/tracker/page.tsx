
import { getTranslations } from "@/lib/i18n-server"
import { listActionLogs } from "@/lib/action-log"
import { parseActionLogsPage, parseActionLogsPageSize } from "../action-logs-params"
import { ActionLogsTable } from "../action-logs-table"
import { SettingsSection } from "../settings-section"

type LogsPageProps = {
  searchParams: Promise<{ q?: string; page?: string; size?: string }>
}

export default async function TrackerLogsPage({ searchParams }: LogsPageProps) {
  const t = await getTranslations()

  const params = await searchParams
  const logs = await listActionLogs(2000, "tracker")

  return (
    <SettingsSection
      title={t("Логи действий в трекере")}
      description={t("Кто что сделал: вход, задачи, синхронизация, профили и пользователи.")}
    >
      <ActionLogsTable
        clearSource="tracker"
        emptyText={t("Пока нет действий. Они появятся, когда кто-то войдёт, создаст задачу или изменит данные.")}
        rows={logs.map((log) => ({
          date: log.createdAt.toISOString(),
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
