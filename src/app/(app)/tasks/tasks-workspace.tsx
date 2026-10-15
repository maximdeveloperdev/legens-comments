"use client"

import { useTranslations } from "@/components/language-provider"

import Link from "next/link"
import { ListTree, PlusCircle } from "lucide-react"
import type { AdsPowerProfile } from "@/lib/adspower"
import type { CountryInfo } from "@/app/(app)/constructor/farm-comments"
import { Button } from "@/components/ui/button"
import { TaskCreateForm } from "./task-create-form"

export function TasksWorkspace({
  profiles,
  countries,
  error,
}: {
  profiles: AdsPowerProfile[]
  countries: Record<string, CountryInfo>
  error?: string
}) {
  const t = useTranslations()

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <section className="flex items-center justify-between gap-4 rounded-2xl border bg-gradient-to-r from-muted/80 to-card p-4 md:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-background text-primary shadow-sm ring-1 ring-foreground/10">
            <PlusCircle className="size-5" />
          </span>
          <div className="grid min-w-0 gap-1">
            <h1 className="font-heading text-lg font-medium">{t("Создать задачу")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("Создание задачи с таргетингом фанок, комментариями, ответами, картинками и реакциями.")}</p>
          </div>
        </div>
        <Button variant="outline" render={<Link href="/tasks/list" />}>
          <ListTree />
          {t("Список задач")}</Button>
      </section>

      <TaskCreateForm profiles={profiles} countries={countries} error={error} />
    </div>
  )
}
