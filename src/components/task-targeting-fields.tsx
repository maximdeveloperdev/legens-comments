"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Search, X } from "lucide-react"
import { cn } from "cn"
import { Input } from "@/components/ui/input"
import type { CountryInfo } from "@/app/(app)/constructor/farm-comments"

function geoSelectionLabel(geos: string[], countries: Record<string, CountryInfo>, emptyLabel: string) {
  if (geos.length === 0) return emptyLabel
  return geos.map((geo) => countries[geo]?.name || geo).join(", ")
}

export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <span className="relative">
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full appearance-none rounded-lg border bg-background px-3 pr-10 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  )
}

export function GeoMultiSelect({
  label,
  value,
  geos,
  countries,
  emptyLabel,
  onChange,
}: {
  label: string
  value: string[]
  geos: string[]
  countries: Record<string, CountryInfo>
  emptyLabel: string
  onChange: (value: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selected = useMemo(() => new Set(value), [value])
  const selectedLabel = geoSelectionLabel(value, countries, emptyLabel)
  const filteredGeos = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return geos
    return geos.filter((geo) => {
      const label = countries[geo]?.name || geo
      return geo.toLowerCase().includes(needle) || label.toLowerCase().includes(needle)
    })
  }, [countries, geos, query])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  function toggleGeo(geo: string) {
    if (selected.has(geo)) {
      onChange(value.filter((item) => item !== geo))
      return
    }
    onChange([...value, geo])
  }

  return (
    <div ref={rootRef} className="relative grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {value.length > 0 ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => onChange([])}
          >
            Очистить
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`${label}: ${selectedLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-left text-sm outline-none transition-colors hover:border-ring focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
          {selectedLabel}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border bg-popover shadow-lg">
          <div className="flex items-center gap-2 border-b p-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск гео"
                className="h-10 pr-9 pl-9"
                autoFocus
              />
              {query ? (
                <button
                  type="button"
                  className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label="Очистить поиск"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          </div>
          <div role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto p-2">
            {filteredGeos.length > 0 ? (
              filteredGeos.map((geo) => (
                <label
                  key={geo}
                  className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(geo)}
                    onChange={() => toggleGeo(geo)}
                    className="size-4 shrink-0 rounded border-border accent-primary"
                  />
                  <span className="truncate">{countries[geo]?.name || geo}</span>
                </label>
              ))
            ) : (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</div>
            )}
          </div>
        </div>
      ) : null}

    </div>
  )
}

export function RangeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="grid gap-2 sm:grid-cols-[1fr_5rem] sm:items-center">
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full accent-primary"
        />
        <Input
          type="number"
          aria-label={label}
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {min} - {max}, сейчас {value}
      </span>
    </label>
  )
}

