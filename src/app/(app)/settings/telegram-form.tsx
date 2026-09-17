"use client"

import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function TelegramForm() {
  return (
    <div className="grid max-w-md gap-4">
      <Field>
        <FieldLabel htmlFor="telegram-token">Токен бота</FieldLabel>
        <Input id="telegram-token" placeholder="123456:ABC..." autoComplete="off" />
      </Field>
      <Field>
        <FieldLabel htmlFor="telegram-chat">ID чата</FieldLabel>
        <Input id="telegram-chat" placeholder="-100..." autoComplete="off" />
      </Field>
    </div>
  )
}
