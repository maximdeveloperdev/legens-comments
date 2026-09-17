import { Badge } from "@/components/ui/badge"
import { getAdsPowerConnection } from "@/lib/adspower"
import { formatActionLogDate, listActionLogs } from "@/lib/action-log"
import { parseActionLogsPage, parseActionLogsPageSize } from "../action-logs-params"
import { ActionLogsTable } from "../action-logs-table"
import { SettingsSection } from "../settings-section"

type LogsPageProps = {
  searchParams: Promise<{ q?: string; page?: string; size?: string }>
}

export default async function AdsPowerLogsPage({ searchParams }: LogsPageProps) {
  const params = await searchParams
  const [connection, logs] = await Promise.all([
    getAdsPowerConnection(),
    listActionLogs(2000, "adspower"),
  ])

  return (
    <SettingsSection
      title="Логи действий Ads Power"
      description="Подключение к Local API и журнал запуска, switch и синхронизации фанок."
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge variant={connection.ok ? "default" : "destructive"}>
          {connection.ok ? "Подключено" : "Нет связи"}
        </Badge>
        {connection.ok ? <Badge variant="outline">Тариф оплачен</Badge> : null}
        <p className="text-sm text-muted-foreground">{connection.url}</p>
      </div>
      <p className="mb-6 text-sm">
        {connection.ok
          ? "Всё оплачено: список профилей, запуск браузеров и логи Local API доступны."
          : connection.message}
      </p>
      {connection.openBrowsers.length > 0 ? (
        <div className="mb-6 grid gap-2">
          <p className="text-sm font-medium">Открытые браузеры</p>
          <div className="flex flex-wrap gap-2">
            {connection.openBrowsers.map((browser) => (
              <Badge key={browser.id} variant="secondary">
                {browser.name} · {browser.detail}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      <ActionLogsTable
        clearSource="adspower"
        emptyText={
          connection.ok
            ? "Пока нет логов. Запусти тест или синхронизацию фанок из конструктора."
            : "Нет данных: сначала нужно подключить AdsPower."
        }
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
