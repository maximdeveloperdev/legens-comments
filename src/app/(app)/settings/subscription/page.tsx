import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { getOpenAiAccount } from "@/lib/openai-account"
import { SettingsSection } from "../settings-section"
import { RefreshButton } from "./refresh-button"

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr] sm:items-start">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

export default async function SubscriptionSettingsPage() {
  const account = await getOpenAiAccount()
  const statusLabel = !account.keyPresent
    ? "Ключ не задан"
    : account.connected
      ? "Подключено"
      : "Нет связи"
  const statusVariant = account.connected ? "default" : "destructive"

  return (
    <SettingsSection
      title="Подписки"
      description="Ключ ChatGPT (OpenAI) и доступ к API."
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge variant={statusVariant}>{statusLabel}</Badge>
        {account.modelAvailable ? <Badge variant="outline">{account.model}</Badge> : null}
        <RefreshButton />
      </div>

      {account.error && !account.connected ? (
        <p className="mb-6 text-sm text-destructive">{account.error}</p>
      ) : null}

      <div className="mb-8 grid gap-3">
        <Row label="Ключ">{account.keyMasked}</Row>
        <Row label="Модель конструктора">
          {account.model}
          {account.modelAvailable == null
            ? ""
            : account.modelAvailable
              ? " · есть в аккаунте"
              : " · нет в списке моделей"}
        </Row>
        <Row label="Модели">{account.modelCount ? `${account.modelCount} шт.` : "—"}</Row>
        <Row label="Файлы">
          {account.files == null ? "—" : `${account.files}${account.filesHasMore ? "+" : ""}`}
        </Row>
        <Row label="Fine-tune">{account.fineTunes == null ? "—" : account.fineTunes}</Row>
        <Row label="Batches">{account.batches == null ? "—" : account.batches}</Row>
        <Row label="API">{account.apiVersion || "—"}</Row>
        {account.organization ? <Row label="Organization">{account.organization}</Row> : null}
        {account.project ? <Row label="Project">{account.project}</Row> : null}
      </div>
    </SettingsSection>
  )
}
