"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { useLanguage, useTranslations } from "@/components/language-provider"
import { Button } from "@/components/ui/button"

export function LanguageSwitcher() {
  const language = useLanguage()
  const t = useTranslations()
  const router = useRouter()
  const inFlight = useRef(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState("")
  const busy = saving || refreshing

  async function toggle() {
    if (inFlight.current || busy) return
    inFlight.current = true
    setSaving(true); setError("")
    try {
      const response = await fetch("/api/preferences/language", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: language === "ru" ? "uk" : "ru" }),
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error("language-save")
      startTransition(() => router.refresh())
    } catch { setError(t("Не удалось сохранить язык. Попробуйте ещё раз.")) }
    finally { setSaving(false); inFlight.current = false }
  }

  return <div className="relative">
    <Button type="button" variant="ghost" className="h-8 min-w-11 px-2 text-xs" disabled={busy} aria-label={t("Язык интерфейса: {0}. Переключить на {1}", language === "ru" ? "Русский" : "Українська", language === "ru" ? "Українська" : "Русский")} title={t("Сменить язык")} onClick={() => void toggle()}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : language === "ru" ? "RU" : "UKR"}
    </Button>
    {error ? <div role="alert" className="absolute top-full right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 text-xs text-destructive shadow-lg">{t(error)}</div> : null}
  </div>
}
