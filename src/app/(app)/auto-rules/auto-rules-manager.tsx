"use client"

import { useTranslations } from "@/components/language-provider"

import { useState } from "react"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

const fieldLabelClass =
  "text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const t = useTranslations()
  return (
    <Field className="gap-2">
      <FieldLabel className={fieldLabelClass}>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) onChange(nextValue)
        }}
      >
        <SelectTrigger className="h-12 w-full rounded-sm bg-card px-4 text-base">
          <SelectValue>{(selected) => t(String(selected ?? ""))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {t(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function RuleForm({ onBack }: { onBack: () => void }) {
  const t = useTranslations()

  const [ruleType, setRuleType] = useState("Расписание")
  const [frequency, setFrequency] = useState("Каждые полчаса")
  const [statsPeriod, setStatsPeriod] = useState("Все время")
  const [workTarget, setWorkTarget] = useState("Объявления")
  const [status, setStatus] = useState("Активные")
  const [action, setAction] = useState("Остановить")
  const [group, setGroup] = useState("Без группы")
  const [withoutConditions, setWithoutConditions] = useState(false)
  const [conditions, setConditions] = useState([0])

  return (
    <div className="flex min-h-[calc(100svh-var(--header-height))] flex-col bg-background">
      <div className="flex-1 p-4 md:p-6">
        <div className="grid gap-x-6 gap-y-5 xl:grid-cols-2">
          <Field className="gap-2">
            <FieldLabel className={fieldLabelClass}>{t("Название правила")}</FieldLabel>
            <Input className="h-12 rounded-sm bg-card px-4 text-base" />
          </Field>
          <SelectField
            label={t("Тип правила")}
            value={ruleType}
            options={["Расписание", "По условию"]}
            onChange={setRuleType}
          />
          <SelectField
            label={t("Частота")}
            value={frequency}
            options={["Каждые полчаса", "Каждый час", "Раз в день"]}
            onChange={setFrequency}
          />
          <SelectField
            label={t("Период времени статы")}
            value={statsPeriod}
            options={["Все время", "Сегодня", "Вчера", "Последние 7 дней"]}
            onChange={setStatsPeriod}
          />
          <SelectField
            label={t("С чем работать?")}
            value={workTarget}
            options={["Объявления", "Кампании", "Группы объявлений"]}
            onChange={setWorkTarget}
          />
          <SelectField
            label={t("Какие статусы брать?")}
            value={status}
            options={["Активные", "Остановленные", "Все"]}
            onChange={setStatus}
          />
          <SelectField
            label={t("Что делать?")}
            value={action}
            options={["Остановить", "Запустить", "Изменить бюджет"]}
            onChange={setAction}
          />
          <SelectField
            label={t("Группа")}
            value={group}
            options={["Без группы"]}
            onChange={setGroup}
          />
        </div>

        <div className="mt-8 rounded-sm bg-sky-100 px-4 py-3 text-sm leading-6 text-sky-800">
          {t("Внимание, теперь для вашего удобства все цены в условиях указываются в Долларах! Если валюта кабинета не доллары, то правило автоматически сконвертируется в валюту кабинета в момент его установки!")}</div>

        <div className="mt-9 flex items-center gap-3">
          <span className="text-base text-muted-foreground">{t("Без условий")}</span>
          <Switch
            checked={withoutConditions}
            onCheckedChange={setWithoutConditions}
          />
        </div>

        <div className="mt-10 grid gap-6">
          {conditions.map((condition, index) => (
            <div key={condition} className="grid gap-3">
              <p className="text-base text-muted-foreground">
                {t("Условие ")}{index + 1}
              </p>
              <div className="grid gap-4 xl:grid-cols-[1fr_300px_1fr]">
                <Select defaultValue="Показы">
                  <SelectTrigger className="h-12 w-full rounded-sm bg-card px-4 text-base">
                    <SelectValue>{(selected) => t(String(selected ?? ""))}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Показы">{t("Показы")}</SelectItem>
                    <SelectItem value="Клики">{t("Клики")}</SelectItem>
                    <SelectItem value="Расход">{t("Расход")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select defaultValue="=">
                  <SelectTrigger className="h-12 w-full rounded-sm bg-card px-4 text-base">
                    <SelectValue>{(selected) => t(String(selected ?? ""))}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="=">=</SelectItem>
                    <SelectItem value=">">&gt;</SelectItem>
                    <SelectItem value="<">&lt;</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="h-12 rounded-sm bg-card px-4 text-base" />
              </div>
            </div>
          ))}

          <div className="flex justify-center">
            <Button
              type="button"
              size="icon-lg"
              className="rounded-full"
              onClick={() =>
                setConditions((current) => [
                  ...current,
                  (current.at(-1) ?? 0) + 1,
                ])
              }
            >
              <PlusIcon />
            </Button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" className="h-11 px-6 text-base">
            {t("Создать")}</Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-8 text-base"
            onClick={onBack}
          >
            {t("Назад")}</Button>
        </div>
      </div>
      <div className="border-t px-4 py-5 text-sm text-muted-foreground md:px-6">
        {t("Copyright © 2018-2026 Legends Tools. Все права защищены.")}</div>
    </div>
  )
}

function RulesList({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations()

  return (
    <div className="flex min-h-[calc(100svh-var(--header-height))] flex-col bg-background">
      <div className="flex flex-1 flex-col p-4 md:p-6">
        <div className="flex justify-end">
          <Button type="button" className="h-10 px-5 text-base" onClick={onCreate}>
            <PlusIcon />
            {t("Создать правило")}</Button>
        </div>
        <div className="flex-1" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-5 text-sm text-muted-foreground md:px-6">
        <span>{t("Copyright © 2018-2026 Legends Tools. Все права защищены.")}</span>
        <span>Made with heart in Estonia</span>
      </div>
    </div>
  )
}

export function AutoRulesManager() {
  const [view, setView] = useState<"list" | "create">("list")

  if (view === "create") {
    return <RuleForm onBack={() => setView("list")} />
  }

  return <RulesList onCreate={() => setView("create")} />
}
