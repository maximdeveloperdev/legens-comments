"use client"

import { useState } from "react"
import { ListTree, MessageCircle, Play, Server } from "lucide-react"
import type { AdsPowerProfile } from "@/lib/adspower"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "cn"
import { FarmComments, type CountryInfo } from "./farm-comments"
import { FarmQueue } from "./farm-queue"
import { FarmVps } from "./farm-vps"

type FarmTab = "comments" | "queue" | "vps"

const tabs: { id: FarmTab; label: string; icon: typeof Play }[] = [
  { id: "comments", label: "Комментарии", icon: Play },
  { id: "queue", label: "Очередь", icon: ListTree },
  { id: "vps", label: "AdsPower VPS", icon: Server },
]

export function ConstructorFarm({
  profiles,
  countries,
  error,
  canManage,
  currentUserName,
  initialTab,
}: {
  profiles: AdsPowerProfile[]
  countries: Record<string, CountryInfo>
  error?: string
  canManage: boolean
  currentUserName?: string
  initialTab: FarmTab
}) {
  const defaultTab = !canManage && initialTab === "vps" ? "comments" : initialTab
  const [tab, setTab] = useState<FarmTab>(defaultTab)
  const [queueMounted, setQueueMounted] = useState(defaultTab === "queue")
  const openCount = profiles.filter((profile) => profile.open).length

  function selectTab(id: FarmTab) {
    setTab(id)
    if (id === "queue") setQueueMounted(true)
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    url.searchParams.set("tab", id)
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`)
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <section className="flex items-center justify-between gap-4 rounded-2xl border bg-gradient-to-r from-muted/80 to-card p-4 md:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-background text-emerald-700 shadow-sm ring-1 ring-foreground/10">
            <MessageCircle className="size-5" />
          </span>
          <h1 className="font-heading min-w-0 text-lg font-medium">Ферма комментариев</h1>
        </div>
        <Badge
          variant="outline"
          className="h-7 w-fit gap-1.5 rounded-full border-emerald-200 bg-emerald-50 px-3 font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {openCount}/{profiles.length} соц
        </Badge>
      </section>

      <div className="flex w-fit flex-wrap items-center gap-1 rounded-full bg-muted p-1">
        {tabs.filter((item) => canManage || item.id !== "vps").map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          return (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "rounded-full",
                active
                  ? "bg-background shadow-sm hover:bg-background"
                  : "text-muted-foreground",
              )}
              onClick={() => selectTab(item.id)}
            >
              <Icon />
              {item.label}
            </Button>
          )
        })}
      </div>

      {tab === "comments" ? (
        <FarmComments profiles={profiles} countries={countries} />
      ) : null}

      {queueMounted ? (
        <div className={tab === "queue" ? undefined : "hidden"}>
          <FarmQueue
            active={tab === "queue"}
            canManage={canManage}
            currentUserName={currentUserName}
          />
        </div>
      ) : null}

      {tab === "vps" ? (
        <FarmVps profiles={profiles} countries={countries} error={error} />
      ) : null}
    </div>
  )
}
