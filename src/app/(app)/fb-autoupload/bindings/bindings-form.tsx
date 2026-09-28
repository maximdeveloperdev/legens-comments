"use client"

import { useMemo, useState, useTransition } from "react"
import type { FormEvent } from "react"
import { useRouter } from "next/navigation"
import { XIcon } from "lucide-react"

import { createFbAutouploadBinding } from "@/app/actions/fb-autoupload"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

import {
  autouploadPrimaryButtonClass,
  autouploadSecondaryButtonClass,
} from "../ui"

const fieldLabelClass =
  "text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground"
const controlClass = "h-10 w-full rounded-sm bg-card px-3 text-sm"

export type CountryOption = {
  label: string
  value: string
}

type SelectOption = CountryOption | string

function optionValue(option: SelectOption) {
  return typeof option === "string" ? option : option.value
}

function optionLabel(option: SelectOption) {
  return typeof option === "string" ? option : option.label
}

const placementGroups = [
  {
    title: "Facebook",
    items: [
      "Лента",
      "Лента профиля",
      "In-Stream",
      "Правый столбец Facebook",
      "Видеоленты Facebook",
      "Facebook Marketplace",
      "Истории",
      "Результаты поиска на Facebook",
      "Reels",
      "Reels Overlay",
      "Уведомления Facebook",
    ],
  },
  {
    title: "Instagram",
    items: [
      "Лента",
      "Лента профиля",
      "Истории",
      "Интересное",
      'Главный экран раздела "Интересное"',
      "Результаты поиска в Instagram",
      "Reels",
      "Reels в профиле",
    ],
  },
  {
    title: "Audience Network",
    items: ["Нативная реклама", "Видео с вознаграждением"],
  },
  {
    title: "Messenger",
    items: ["Входящие", "Истории"],
  },
  {
    title: "Threads",
    items: ["Лента Threads"],
  },
]

function SelectField({
  label,
  defaultValue,
  options,
  name,
}: {
  label: string
  defaultValue: string
  options: SelectOption[]
  name?: string
}) {
  const [value, setValue] = useState(defaultValue)

  return (
    <Field className="gap-1.5">
      <FieldLabel className={fieldLabelClass}>{label}</FieldLabel>
      <input type="hidden" name={name ?? label} value={value} />
      <Select value={value} onValueChange={(nextValue) => setValue(String(nextValue))}>
        <SelectTrigger className={controlClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={optionValue(option)} value={optionValue(option)}>
              {optionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function IncludeExcludeBlock({
  title,
  includeName,
  excludeName,
}: {
  title: string
  includeName: string
  excludeName: string
}) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-normal text-foreground">{title}</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        <Field className="gap-1.5">
          <FieldLabel className={fieldLabelClass}>Включить</FieldLabel>
          <Input name={includeName} className={controlClass} />
        </Field>
        <Field className="gap-1.5">
          <FieldLabel className={fieldLabelClass}>Исключить</FieldLabel>
          <Input name={excludeName} className={controlClass} />
        </Field>
      </div>
    </section>
  )
}

function IncludeExcludeSelectBlock({
  title,
  options,
  includeName,
  excludeName,
}: {
  title: string
  options: CountryOption[]
  includeName: string
  excludeName: string
}) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-normal text-foreground">{title}</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        <MultiSelectField
          label="Включить"
          options={options}
          name={includeName}
        />
        <MultiSelectField
          label="Исключить"
          options={options}
          name={excludeName}
        />
      </div>
    </section>
  )
}

function MultiSelectField({
  label,
  options,
  name,
}: {
  label: string
  options: CountryOption[]
  name: string
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<CountryOption[]>([])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const selectedValues = new Set(selected.map((item) => item.value))
    return options
      .filter((option) => !selectedValues.has(option.value))
      .filter((option) => !needle || option.label.toLowerCase().includes(needle))
      .slice(0, 80)
  }, [options, query, selected])

  function addOption(option: CountryOption) {
    setSelected((current) =>
      current.some((item) => item.value === option.value)
        ? current
        : [...current, option],
    )
    setQuery("")
    setOpen(false)
  }

  function addCustomValue() {
    const value = query.trim()
    if (!value) return
    addOption({ label: value, value })
  }

  return (
    <Field className="gap-1.5">
      <FieldLabel className={fieldLabelClass}>{label}</FieldLabel>
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(selected.map((item) => item.value))}
      />
      <div className="relative">
        <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-sm border border-input bg-card px-2 py-1 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          {selected.map((item) => (
            <span
              key={item.value}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-secondary px-2 text-xs text-secondary-foreground"
            >
              {item.label}
              <button
                type="button"
                className="rounded-sm text-muted-foreground hover:text-foreground"
                aria-label={`Убрать ${item.label}`}
                onClick={() =>
                  setSelected((current) =>
                    current.filter((selectedItem) => selectedItem.value !== item.value),
                  )
                }
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          <input
            className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            placeholder={selected.length ? "" : "Печатай для поиска"}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                if (filtered[0]) addOption(filtered[0])
                else addCustomValue()
              }
              if (event.key === "Backspace" && !query && selected.length) {
                setSelected((current) => current.slice(0, -1))
              }
              if (event.key === "Escape") setOpen(false)
            }}
          />
        </div>
        {open ? (
          <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md">
            {filtered.length ? (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addOption(option)}
                >
                  {option.label}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={addCustomValue}
              >
                Добавить {query.trim()}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </Field>
  )
}

function PlacementCheckbox({ label }: { label: string }) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
      <Checkbox aria-label={label} name="placements" value={label} />
      <span>{label}</span>
    </label>
  )
}

export function BindingsForm({ countries }: { countries: CountryOption[] }) {
  const router = useRouter()
  const [message, setMessage] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage("")

    startTransition(async () => {
      const result = await createFbAutouploadBinding(formData)
      if (result.error) {
        setMessage(result.error)
        return
      }
      setMessage(`Связка сохранена, ID ${result.id}`)
    })
  }

  return (
    <div className="flex min-h-[calc(100svh-var(--header-height))] flex-col bg-background">
      <div className="flex-1 p-4 md:p-5">
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <input
            type="hidden"
            name="name"
            value="Связка автозалива"
          />
          <div className="grid gap-4 xl:grid-cols-4">
            <SelectField
              label="Цель кампании"
              name="campaignGoal"
              defaultValue="Клики по ссылке (Трафик)"
              options={[
                "Клики по ссылке (Трафик)",
                "Лиды",
                "Продажи",
                "Конверсии (Устарело, используйте тип ЛИДЫ)",
                "Инсталлы",
                "Лайки страницы",
              ]}
            />
          </div>

          <IncludeExcludeSelectBlock
            title="Страны"
            options={countries}
            includeName="countriesInclude"
            excludeName="countriesExclude"
          />
          <IncludeExcludeBlock
            title="Регионы"
            includeName="regionsInclude"
            excludeName="regionsExclude"
          />
          <IncludeExcludeBlock
            title="Города"
            includeName="citiesInclude"
            excludeName="citiesExclude"
          />
          <IncludeExcludeBlock
            title="Интересы"
            includeName="interestsInclude"
            excludeName="interestsExclude"
          />

          <div className="grid gap-4 xl:grid-cols-4">
            <SelectField
              label="Местоположение"
              name="locationType"
              defaultValue="Живущие здесь или недавние посетители"
              options={[
                "Живущие здесь или недавние посетители",
                "Живущие здесь",
                "Недавние посетители",
                "Путешествующие здесь",
              ]}
            />
            <SelectField
              label="Расширение детального таргетинга"
              name="detailedTargetingExpansion"
              defaultValue="Нет"
              options={["Нет", "Да"]}
            />
          </div>

          <IncludeExcludeBlock
            title="Поведение"
            includeName="behaviorsInclude"
            excludeName="behaviorsExclude"
          />

          <section className="grid gap-4 xl:max-w-[50%]">
            <h2 className="text-xl font-normal text-foreground">Языки</h2>
            <Field className="gap-1.5">
              <FieldLabel className={fieldLabelClass}>Включить</FieldLabel>
              <Input name="languagesInclude" className={controlClass} />
            </Field>
          </section>

          <section className="grid gap-3 xl:max-w-[50%]">
            <h2 className="text-xl font-normal text-foreground">
              Специальные категории (Если не нужно - оставить пустым)
            </h2>
            <Input name="specialCategories" className={controlClass} />
          </section>

          <div className="flex items-center gap-3">
            <span className={fieldLabelClass}>Автоплейсмент</span>
            <Switch name="autoPlacement" />
          </div>

          <section className="grid gap-5 xl:grid-cols-4">
            <div className="grid gap-5 xl:col-span-2 xl:grid-cols-2">
              {placementGroups.slice(0, 2).map((group) => (
                <div key={group.title} className="grid content-start gap-2.5">
                  <h2 className="text-xl font-normal text-foreground">
                    {group.title}
                  </h2>
                  <div className="grid gap-2">
                    {group.items.map((item) => (
                      <PlacementCheckbox key={item} label={item} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid content-start gap-6">
              {placementGroups.slice(2, 4).map((group) => (
                <div key={group.title} className="grid gap-2.5">
                  <h2 className="text-xl font-normal text-foreground">
                    {group.title}
                  </h2>
                  <div className="grid gap-2">
                    {group.items.map((item) => (
                      <PlacementCheckbox key={item} label={item} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid content-start gap-2.5">
              <h2 className="text-xl font-normal text-foreground">Threads</h2>
              <PlacementCheckbox label="Лента Threads" />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-4">
            <div className="grid gap-3">
              <SelectField
                label="Устройства"
                name="devices"
                defaultValue="Все"
                options={["Все"]}
              />
              <div className="flex items-center gap-3">
                <span className={fieldLabelClass}>Только WI-FI</span>
                <Switch name="wifiOnly" />
              </div>
              <SelectField
                label="Запускать от имени"
                name="runAs"
                defaultValue="ФП"
                options={["ФП", "Аккаунт"]}
              />
            </div>
            <SelectField
              label="Пол"
              name="gender"
              defaultValue="Все"
              options={["Все", "Мужчины", "Женщины"]}
            />
            <Field className="gap-1.5">
              <FieldLabel className={fieldLabelClass}>
                Возраст от (диапазон)
              </FieldLabel>
              <Input name="ageFromPrimary" defaultValue="13" className={controlClass} />
              <Input name="ageFromSecondary" defaultValue="13" className={controlClass} />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel className={fieldLabelClass}>До</FieldLabel>
              <Input name="ageToPrimary" defaultValue="13" className={controlClass} />
              <Input name="ageToSecondary" defaultValue="13" className={controlClass} />
            </Field>
          </section>

          <section className="grid gap-4">
            <h2 className="text-xl font-normal text-foreground">Бюджет</h2>
            <div className="grid gap-4 xl:grid-cols-4">
              <SelectField
                label="Устанавливаем бюджет на"
                name="budgetTarget"
                defaultValue="Адсет"
                options={["Адсет", "Кампания"]}
              />
              <SelectField
                label="Тип бюджета"
                name="budgetType"
                defaultValue="Дневной"
                options={["Дневной", "Пожизненный"]}
              />
              <Field className="gap-1.5">
                <FieldLabel className={fieldLabelClass}>Бюджет от ($)</FieldLabel>
                <Input name="budgetFrom" className={controlClass} />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel className={fieldLabelClass}>До ($)</FieldLabel>
                <Input name="budgetTo" className={controlClass} />
              </Field>
            </div>
            <div className="grid gap-4 xl:grid-cols-4">
              <SelectField
                label="Стратегия ставок"
                name="bidStrategy"
                defaultValue="Минимальная цена"
                options={["Минимальная цена", "Предельная ставка", "Предельная цена"]}
              />
              <SelectField
                label="Окно конверсии"
                name="conversionWindow"
                defaultValue="7 дней после клика или 1 день после просмотра"
                options={[
                  "7 дней после клика или 1 день после просмотра",
                  "1 день после клика",
                  "7 дней после клика",
                  "1 день после клика или просмотра",
                ]}
              />
            </div>
          </section>

          {message ? (
            <p className="text-sm text-muted-foreground">{message}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              className={autouploadPrimaryButtonClass}
              disabled={isPending}
            >
              Создать
            </Button>
            <Button
              type="button"
              variant="outline"
              className={autouploadSecondaryButtonClass}
              onClick={() => router.push("/fb-autoupload")}
            >
              Назад
            </Button>
          </div>
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-5 text-sm text-muted-foreground md:px-6">
        <span>Copyright © 2018-2026 Legends Tools. Все права защищены.</span>
        <span>Made with heart in Estonia</span>
      </div>
    </div>
  )
}
