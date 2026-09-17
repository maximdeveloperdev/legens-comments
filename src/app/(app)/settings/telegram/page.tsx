import { SettingsSection } from "../settings-section"
import { TelegramForm } from "../telegram-form"

export default function TelegramSettingsPage() {
  return (
    <SettingsSection title="Telegram" description="Подключение бота для уведомлений.">
      <TelegramForm />
    </SettingsSection>
  )
}
