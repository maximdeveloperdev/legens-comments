"use client"

import { useMemo, useState, useTransition } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { LayoutGrid, Loader2, Play, RefreshCw, SearchIcon, Square } from "lucide-react"
import { startAdsPowerProfile, stopAdsPowerProfile } from "@/app/actions/adspower"
import type { AdsPowerProfile } from "@/lib/adspower"
import { pushAppNotification } from "@/lib/app-notifications"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "cn"
import type { CountryInfo } from "./farm-comments"

function formatUnix(value: number) {
  if (!value) return "—"
  return new Date(value * 1000).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

function groupKey(profile: AdsPowerProfile, byGeo: boolean, countries: Record<string, CountryInfo>) {
  if (byGeo) {
    if (!profile.ipCountry) return "Без гео"
    return countries[profile.ipCountry]?.name || profile.ipCountry
  }
  return profile.groupName.trim() || "Без группы"
}

export function FarmVps({
  profiles,
  countries = {},
  error,
}: {
  profiles: AdsPowerProfile[]
  countries: Record<string, CountryInfo>
  error?: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [byGeo, setByGeo] = useState(false)
  const [refreshing, startRefresh] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [stoppingAll, setStoppingAll] = useState(false)
  const [actionError, setActionError] = useState<Record<string, string>>({})

  const openCount = profiles.filter((profile) => profile.open).length

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return profiles
    return profiles.filter((profile) =>
      [profile.name, profile.id, profile.serial, profile.groupName, profile.username, profile.ipCountry]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
  }, [profiles, query])

  const grouped = useMemo(() => {
    const buckets = new Map<string, AdsPowerProfile[]>()
    for (const profile of filtered) {
      const key = groupKey(profile, byGeo, countries)
      const list = buckets.get(key) ?? []
      list.push(profile)
      buckets.set(key, list)
    }
    return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right, "ru"))
  }, [byGeo, countries, filtered])

  async function toggleProfile(profile: AdsPowerProfile) {
    setPendingId(profile.id)
    setActionError((current) => {
      const next = { ...current }
      delete next[profile.id]
      return next
    })

    const result = profile.open
      ? await stopAdsPowerProfile(profile.id)
      : await startAdsPowerProfile(profile.id)

    if (result.error) {
      setActionError((current) => ({ ...current, [profile.id]: result.error ?? "" }))
      pushAppNotification(
        profile.open ? "Стоп профиля · ошибка" : "Старт профиля · ошибка",
        `${profile.name} · ${result.error}`,
        { tone: "error" },
      )
    } else {
      pushAppNotification(
        profile.open ? "Профиль остановлен" : "Профиль запущен",
        profile.name,
        { tone: "success" },
      )
      router.refresh()
    }

    setPendingId(null)
  }

  async function stopAll() {
    const open = profiles.filter((profile) => profile.open && profile.id)
    if (open.length === 0) return
    setStoppingAll(true)
    for (const profile of open) {
      await stopAdsPowerProfile(profile.id)
    }
    pushAppNotification("Освободить память", `Остановлено: ${open.length} профил.`, {
      tone: "success",
    })
    setStoppingAll(false)
    router.refresh()
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
              <LayoutGrid className="size-5" />
            </span>
            <div className="grid min-w-0 gap-1">
              <h2 className="font-heading text-base font-medium">AdsPower VPS</h2>
              <p className="text-sm text-muted-foreground">
                Общие профили фермы — запуск, стоп и вход. Нужные окна поднимаются сами при
                комментариях.
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary" className="font-normal text-emerald-700">
                  Запущено: {openCount} / {profiles.length}
                </Badge>
                <Badge variant="outline" className="font-normal">
                  Комфортно до ~15 (упор в CPU, не RAM)
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={byGeo ? "default" : "outline"}
              onClick={() => setByGeo((value) => !value)}
            >
              Гео по названиям
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={stoppingAll || openCount === 0}
              onClick={() => void stopAll()}
            >
              {stoppingAll ? <Loader2 className="animate-spin" /> : null}
              Освободить память
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={refreshing}
              onClick={() => startRefresh(() => router.refresh())}
            >
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
              Обновить
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <div className="relative min-w-0">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по имени, группе, заметке..."
              className="pl-8"
              aria-label="Поиск профилей VPS"
            />
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          <span className="text-emerald-700">Запущен</span> — браузер открыт, можно комментировать.{" "}
          <span className="text-foreground">Остановлен</span> — нажми Запустить. Комментарии сами
          поднимают нужный профиль.
        </p>
      </section>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border bg-card py-10 text-center text-sm text-muted-foreground">
          {profiles.length === 0 ? "Профилей нет" : "Никого не нашли"}
        </p>
      ) : (
        grouped.map(([name, items]) => {
          const openInGroup = items.filter((item) => item.open).length
          return (
            <section key={name} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="font-heading text-sm font-medium">{name}</h3>
                <p className="text-sm text-muted-foreground">
                  {openInGroup} / {items.length} фанок
                </p>
              </div>
              <ul className="grid gap-2">
                {items.map((profile) => {
                  const country = countries[profile.ipCountry]
                  const pending = pendingId === profile.id || stoppingAll
                  return (
                    <li
                      key={profile.id || profile.serial}
                      className={cn(
                        "flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-center",
                        profile.open ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900" : "",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              profile.open ? "bg-emerald-500" : "bg-destructive",
                            )}
                          />
                          <p className="truncate font-medium">{profile.name}</p>
                          <Badge variant={profile.open ? "default" : "outline"}>
                            {profile.open ? "Запущен" : "Остановлен"}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          № {profile.serial || "—"}
                          {profile.username ? ` · ${profile.username}` : ""}
                          {" · "}
                          {profile.ipCountry ? (
                            <span className="inline-flex items-center gap-1">
                              {country?.flagSvg ? (
                                <Image
                                  src={country.flagSvg}
                                  alt=""
                                  width={16}
                                  height={12}
                                  className="inline h-3 w-4 rounded-[2px] object-cover"
                                />
                              ) : null}
                              {country?.name || profile.ipCountry}
                            </span>
                          ) : (
                            "без гео"
                          )}
                          {" · "}
                          {formatUnix(profile.lastOpenAt)}
                        </p>
                        {actionError[profile.id] ? (
                          <p className="mt-1 text-sm text-destructive" role="alert">
                            {actionError[profile.id]}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant={profile.open ? "outline" : "default"}
                        disabled={pending || !profile.id}
                        onClick={() => void toggleProfile(profile)}
                      >
                        {pendingId === profile.id ? (
                          <Loader2 className="animate-spin" />
                        ) : profile.open ? (
                          <Square />
                        ) : (
                          <Play />
                        )}
                        {profile.open ? "Стоп" : "Запустить"}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}
