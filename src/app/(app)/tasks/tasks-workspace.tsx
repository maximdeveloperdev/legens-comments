"use client"

import { useState } from "react"
import { ListTree, PlusCircle } from "lucide-react"
import type { AdsPowerProfile } from "@/lib/adspower"
import type { CountryInfo } from "@/app/(app)/constructor/farm-comments"
import { Button } from "@/components/ui/button"
import { cn } from "cn"
import { FarmQueue } from "@/app/(app)/constructor/farm-queue"
import { TaskCreateForm } from "./task-create-form"

type TasksTab = "create" | "list"
type QueueScope = "all" | "team" | "own"

const tabs: { id: TasksTab; label: string; icon: typeof PlusCircle }[] = [
  { id: "create", label: "Task create", icon: PlusCircle },
  { id: "list", label: "Task list", icon: ListTree },
]

export function TasksWorkspace({
  profiles,
  countries,
  canManage,
  currentUserName,
  queueScope,
  initialTab,
  initialQuery,
  initialPage,
  initialPageSize,
  error,
}: {
  profiles: AdsPowerProfile[]
  countries: Record<string, CountryInfo>
  canManage: boolean
  currentUserName?: string
  queueScope: QueueScope
  initialTab: TasksTab
  initialQuery: string
  initialPage: number
  initialPageSize: number
  error?: string
}) {
  const [tab, setTab] = useState<TasksTab>(initialTab)
  const [listMounted, setListMounted] = useState(initialTab === "list")

  function selectTab(id: TasksTab) {
    setTab(id)
    if (id === "list") setListMounted(true)
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    url.searchParams.set("tab", id)
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`)
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <section className="flex items-center justify-between gap-4 rounded-2xl border bg-gradient-to-r from-muted/80 to-card p-4 md:p-5">
        <div className="grid gap-1">
          <h1 className="font-heading text-lg font-medium">Таски</h1>
          <p className="text-sm text-muted-foreground">
            Создание задач и список очереди в одном разделе.
          </p>
        </div>
      </section>

      <div className="flex w-fit flex-wrap items-center gap-1 rounded-full bg-muted p-1">
        {tabs.map((item) => {
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
                active ? "bg-background shadow-sm hover:bg-background" : "text-muted-foreground",
              )}
              onClick={() => selectTab(item.id)}
            >
              <Icon />
              {item.label}
            </Button>
          )
        })}
      </div>

      {tab === "create" ? (
        <TaskCreateForm profiles={profiles} countries={countries} error={error} />
      ) : null}

      {listMounted ? (
        <div className={tab === "list" ? undefined : "hidden"}>
          <FarmQueue
            full
            showTabs
            tableTools
            initialTab="work"
            canManage={canManage}
            currentUserName={currentUserName}
            queueScope={queueScope}
            initialQuery={initialQuery}
            initialPage={initialPage}
            initialPageSize={initialPageSize}
          />
        </div>
      ) : null}
    </div>
  )
}
