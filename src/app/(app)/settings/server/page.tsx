
import { getTranslations } from "@/lib/i18n-server"
import { getServerMetrics } from "@/lib/server-metrics"
import { ServerMonitor } from "./server-monitor"

export default async function ServerMonitorPage() {
  const t = await getTranslations()

  const initial = await getServerMetrics()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="font-heading text-base font-medium">{t("Мониторинг сервера")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Память, оператива, диск, CPU и график нагрузки этого компьютера.")}</p>
      </div>
      <ServerMonitor initial={initial} />
    </div>
  )
}
