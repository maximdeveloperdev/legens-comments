"use client"

import { useTranslations } from "@/components/language-provider"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function RefreshButton() {
  const t = useTranslations()

  const router = useRouter()
  return (
    <Button type="button" variant="outline" onClick={() => router.refresh()}>
      {t("Обновить")}</Button>
  )
}
