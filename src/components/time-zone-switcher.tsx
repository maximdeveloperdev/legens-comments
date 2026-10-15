"use client"

import { useEffect, useRef, useState } from "react"
import { Clock3, Loader2, Search, Check } from "lucide-react"
import { useTimeZone } from "@/components/time-zone-provider"
import { TIME_ZONES, timeZoneOffset } from "@/lib/time-zones"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function TimeZoneSwitcher() {
  const { timeZone, setTimeZone } = useTimeZone()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const root = useRef<HTMLDivElement>(null)
  const selected = TIME_ZONES.find(([zone]) => zone === timeZone)
  useEffect(() => {
    if (!open) return
    function pointer(event: PointerEvent) { if (!root.current?.contains(event.target as Node) && !busy) setOpen(false) }
    function key(event: KeyboardEvent) { if (event.key === "Escape" && !busy) setOpen(false) }
    document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", key)
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key) }
  }, [open, busy])

  async function select(next: string) {
    if (busy) return
    if (next === timeZone) { setOpen(false); return }
    setBusy(true); setError("")
    try {
      const response = await fetch("/api/preferences/time-zone", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeZone: next }), signal: AbortSignal.timeout(15000) })
      const result = await response.json()
      if (!response.ok || result.error) { setError(result.error || "Не удалось сохранить часовой пояс"); return }
      setTimeZone(result.timeZone); setOpen(false)
    } catch { setError("Не удалось сохранить часовой пояс. Проверьте соединение и попробуйте ещё раз.") }
    finally { setBusy(false) }
  }
  const needle = query.trim().toLowerCase()
  const filtered = TIME_ZONES.filter(([zone, label]) => `${zone} ${label}`.toLowerCase().includes(needle))
  return (
    <div ref={root} className="relative">
      <Button type="button" variant="ghost" className="h-8 gap-1.5 px-2" aria-label={`Часовой пояс: ${selected?.[1] ?? timeZone}`} disabled={busy} aria-expanded={open} aria-haspopup="dialog" title={selected?.[1]} onClick={() => { setOpen((value) => !value); setError("") }}>
        <Clock3 /><span className="hidden text-xs tabular-nums sm:inline">{timeZoneOffset(timeZone)}</span>
      </Button>
      {open ? <div role="dialog" aria-label="Выбор часового пояса" className="absolute top-full -right-9 z-50 mt-2 grid max-h-[calc(100svh-5rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto gap-2 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg">
        <div className="grid gap-1"><span className="text-sm font-medium">Часовой пояс</span><p className="text-xs text-muted-foreground">Все даты и время в приложении. Выбор сохраняется в аккаунте.</p></div>
        <div className="relative"><Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus placeholder="Страна или город" aria-label="Поиск часового пояса" className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="max-h-72 overflow-y-auto" aria-busy={busy}>
          {filtered.map(([zone, label]) => <button key={zone} type="button" disabled={busy} aria-pressed={zone === timeZone} onClick={() => void select(zone)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-60">
            <span className="grid min-w-0 gap-0.5"><span className="truncate">{label}</span><span className="text-xs text-muted-foreground">{timeZoneOffset(zone)}</span></span>{zone === timeZone ? <Check className="size-4 shrink-0" /> : null}
          </button>)}
          {!filtered.length ? <p className="py-5 text-center text-sm text-muted-foreground">Ничего не найдено</p> : null}
        </div>
        {busy ? <p role="status" className="flex items-center gap-2 text-xs"><Loader2 className="size-3 animate-spin" />Сохраняем…</p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div> : null}
    </div>
  )
}
