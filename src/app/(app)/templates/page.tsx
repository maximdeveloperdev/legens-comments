
import { getTranslations } from "@/lib/i18n-server"
export default async function TemplatesPage() {
  const t = await getTranslations()

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">{t("Шаблоны сообщений")}</h1>
      <p className="text-muted-foreground">
        {t("Заготовки ответов для модерации комментариев.")}</p>
    </div>
  )
}
