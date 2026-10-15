"use client"

import { useTranslations } from "@/components/language-provider"

import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function TelegramForm() {
  const t = useTranslations()

  return (
    <div className="grid max-w-md gap-4">
      <Field>
        <FieldLabel htmlFor="telegram-token">{t("Токен бота")}</FieldLabel>
        <Input id="telegram-token" placeholder="123456:ABC..." autoComplete="off" />
      </Field>
      <Field>
        <FieldLabel htmlFor="telegram-chat">{t("ID чата")}</FieldLabel>
        <Input id="telegram-chat" placeholder="-100..." autoComplete="off" />
      </Field>
    </div>
  )
}
