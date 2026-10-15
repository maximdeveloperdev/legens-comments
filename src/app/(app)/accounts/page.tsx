
import { getTranslations } from "@/lib/i18n-server"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default async function AccountsPage() {
  const t = await getTranslations()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("Аккаунты")}</CardTitle>
          <CardDescription>{t("Управление аккаунтами.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("Пока без задач.")}</p>
        </CardContent>
      </Card>
    </div>
  )
}
