"use client"

import { useMemo, useState, useTransition } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { FanPageAssetType, Gender } from "@prisma/client"
import { ImageIcon, Plus, SearchIcon, Trash2, UploadIcon } from "lucide-react"
import {
  deleteFanPageAsset,
  uploadFanPageAsset,
} from "@/app/actions/fan-page-library"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { cn } from "cn"

type TeamOption = {
  id: string
  name: string
  marker: string
}

type CountryOption = {
  code: string
  name: string
  flagSvg: string
}

type FanPageAssetRow = {
  id: string
  createdAt: string
  type: FanPageAssetType
  gender: Gender
  geoCode: string
  url: string
  originalName: string
  size: number
  team: TeamOption
  createdByName: string | null
}

type UploadForm = {
  type: FanPageAssetType
  gender: Gender
  geoCode: string
  teamId: string
  files: File[]
}

const assetTypeLabels: Record<FanPageAssetType, string> = {
  AVATAR: "Аватарки",
  COVER: "Обложки",
}

const genderLabels: Record<Gender, string> = {
  ANY: "Любой пол",
  MALE: "Мужские",
  FEMALE: "Женские",
}

const emptyFilter = "all"

function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

function formatSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`
  return `${(value / 1024 / 1024).toFixed(1)} МБ`
}

function teamLine(team: TeamOption) {
  return `${team.name} · ${team.marker}`
}

function countryLine(country: CountryOption) {
  return country.name
}

function CountryLabel({ country }: { country: CountryOption }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {country.flagSvg ? (
        <Image
          src={country.flagSvg}
          alt=""
          width={18}
          height={14}
          className="h-3.5 w-[18px] shrink-0 rounded-[2px] object-cover"
        />
      ) : null}
      <span className="truncate">{countryLine(country)}</span>
    </span>
  )
}

export function FanPageLibraryManager({
  assets,
  teams,
  countries,
  canDelete,
}: {
  assets: FanPageAssetRow[]
  teams: TeamOption[]
  countries: CountryOption[]
  canDelete: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string>(emptyFilter)
  const [genderFilter, setGenderFilter] = useState<string>(emptyFilter)
  const [geoFilter, setGeoFilter] = useState<string>(emptyFilter)
  const [teamFilter, setTeamFilter] = useState<string>(emptyFilter)
  const [query, setQuery] = useState("")
  const [form, setForm] = useState<UploadForm>({
    type: FanPageAssetType.AVATAR,
    gender: Gender.ANY,
    geoCode: countries[0]?.code ?? "",
    teamId: teams[0]?.id ?? "",
    files: [],
  })
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()

  const countryMap = useMemo(
    () => new Map(countries.map((country) => [country.code, country])),
    [countries],
  )
  const selectedCountry = countryMap.get(form.geoCode) ?? null
  const selectedTeam = teams.find((team) => team.id === form.teamId) ?? null

  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return assets.filter((asset) => {
      if (typeFilter !== emptyFilter && asset.type !== typeFilter) return false
      if (genderFilter !== emptyFilter && asset.gender !== genderFilter) return false
      if (geoFilter !== emptyFilter && asset.geoCode !== geoFilter) return false
      if (teamFilter !== emptyFilter && asset.team.id !== teamFilter) return false
      if (!needle) return true
      const country = countryMap.get(asset.geoCode)
      return [
        asset.originalName,
        asset.geoCode,
        country?.name ?? "",
        asset.team.name,
        asset.team.marker,
        asset.createdByName ?? "",
        assetTypeLabels[asset.type],
        genderLabels[asset.gender],
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [assets, countryMap, genderFilter, geoFilter, query, teamFilter, typeFilter])

  function openUpload() {
    setForm({
      type: FanPageAssetType.AVATAR,
      gender: Gender.ANY,
      geoCode: countries[0]?.code ?? "",
      teamId: teams[0]?.id ?? "",
      files: [],
    })
    setError("")
    setMessage("")
    setOpen(true)
  }

  function submitUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setMessage("")

    const data = new FormData()
    data.set("type", form.type)
    data.set("gender", form.type === FanPageAssetType.AVATAR ? form.gender : Gender.ANY)
    data.set("geoCode", form.geoCode)
    data.set("teamId", form.teamId)
    for (const file of form.files) {
      data.append("files", file)
    }

    startTransition(async () => {
      const result = await uploadFanPageAsset(data)
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
      setMessage(`Картинок добавлено: ${form.files.length}`)
      router.refresh()
    })
  }

  function removeAsset(asset: FanPageAssetRow) {
    if (!confirm(`Удалить «${asset.originalName}»?`)) return
    const data = new FormData()
    data.set("id", asset.id)
    setError("")
    setMessage("")
    startTransition(async () => {
      const result = await deleteFanPageAsset(data)
      if (result.error) {
        setError(result.error)
        return
      }
      setMessage("Картинка удалена")
      router.refresh()
    })
  }

  return (
    <>
      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по названию, geo, команде или автору"
              className="pl-8"
              aria-label="Поиск по библиотеке"
            />
          </div>
          <Button type="button" onClick={openUpload} disabled={teams.length === 0 || countries.length === 0}>
            <Plus />
            Добавить
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value ?? emptyFilter)}>
            <SelectTrigger className="w-full">
              <span className="truncate text-left">
                {typeFilter === emptyFilter
                  ? "Все типы"
                  : assetTypeLabels[typeFilter as FanPageAssetType]}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={emptyFilter}>Все типы</SelectItem>
              <SelectItem value={FanPageAssetType.AVATAR}>Аватарки</SelectItem>
              <SelectItem value={FanPageAssetType.COVER}>Обложки</SelectItem>
            </SelectContent>
          </Select>

          <Select value={genderFilter} onValueChange={(value) => setGenderFilter(value ?? emptyFilter)}>
            <SelectTrigger className="w-full">
              <span className="truncate text-left">
                {genderFilter === emptyFilter ? "Все полы" : genderLabels[genderFilter as Gender]}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={emptyFilter}>Все полы</SelectItem>
              <SelectItem value={Gender.ANY}>Любой пол</SelectItem>
              <SelectItem value={Gender.FEMALE}>Женские</SelectItem>
              <SelectItem value={Gender.MALE}>Мужские</SelectItem>
            </SelectContent>
          </Select>

          <Select value={geoFilter} onValueChange={(value) => setGeoFilter(value ?? emptyFilter)}>
            <SelectTrigger className="w-full">
              <span className="truncate text-left">
                {geoFilter === emptyFilter
                  ? "Все geo"
                  : countryMap.get(geoFilter)
                    ? <CountryLabel country={countryMap.get(geoFilter)!} />
                    : geoFilter}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={emptyFilter}>Все geo</SelectItem>
              {countries.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  <CountryLabel country={country} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={teamFilter} onValueChange={(value) => setTeamFilter(value ?? emptyFilter)}>
            <SelectTrigger className="w-full">
              <span className="truncate text-left">
                {teamFilter === emptyFilter
                  ? "Все команды"
                  : teams.find((team) => team.id === teamFilter)
                    ? teamLine(teams.find((team) => team.id === teamFilter)!)
                    : "Команда"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={emptyFilter}>Все команды</SelectItem>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {teamLine(team)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{filteredAssets.length} найдено</Badge>
          <Badge variant="outline">Аватарки {assets.filter((asset) => asset.type === "AVATAR").length}</Badge>
          <Badge variant="outline">Обложки {assets.filter((asset) => asset.type === "COVER").length}</Badge>
        </div>

        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет доступных команд. Админ может создать команду в разделе «Команды».
          </p>
        ) : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </section>

      {filteredAssets.length === 0 ? (
        <section className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          <ImageIcon className="mx-auto mb-3 size-8" />
          В библиотеке пока нет картинок под выбранные фильтры
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredAssets.map((asset) => {
            const country = countryMap.get(asset.geoCode)
            return (
              <article key={asset.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "relative block overflow-hidden bg-muted",
                    asset.type === FanPageAssetType.COVER ? "aspect-video" : "aspect-square",
                  )}
                >
                  <Image
                    src={asset.url}
                    alt={asset.originalName}
                    fill
                    sizes="(min-width: 1536px) 25vw, (min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                  />
                </a>
                <div className="grid gap-3 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="grid min-w-0 gap-1">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge>{assetTypeLabels[asset.type]}</Badge>
                        {asset.type === FanPageAssetType.AVATAR ? (
                          <Badge variant="outline">{genderLabels[asset.gender]}</Badge>
                        ) : null}
                        <Badge variant="secondary" className="gap-1.5">
                          {country?.flagSvg ? (
                            <Image
                              src={country.flagSvg}
                              alt=""
                              width={14}
                              height={10}
                              className="h-2.5 w-3.5 rounded-[2px] object-cover"
                            />
                          ) : null}
                          {country?.name ?? asset.geoCode}
                        </Badge>
                      </div>
                      <p className="truncate font-medium" title={asset.originalName}>
                        {asset.originalName}
                      </p>
                    </div>
                    {canDelete ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => removeAsset(asset)}
                        aria-label="Удалить картинку"
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-1 text-xs text-muted-foreground">
                    <span className="truncate">{teamLine(asset.team)}</span>
                    <span>
                      {formatSize(asset.size)} · {formatDate(asset.createdAt)}
                    </span>
                    {asset.createdByName ? <span className="truncate">Добавил: {asset.createdByName}</span> : null}
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submitUpload}>
            <DialogHeader>
              <DialogTitle>Добавить картинку</DialogTitle>
              <DialogDescription>
                Выберите тип, geo, команду и файл для библиотеки Fan Page.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="mt-4">
              <Field>
                <FieldLabel>Тип</FieldLabel>
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      type: value === FanPageAssetType.COVER ? FanPageAssetType.COVER : FanPageAssetType.AVATAR,
                      gender: value === FanPageAssetType.COVER ? Gender.ANY : current.gender,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <span>{assetTypeLabels[form.type]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FanPageAssetType.AVATAR}>Аватарки</SelectItem>
                    <SelectItem value={FanPageAssetType.COVER}>Обложки</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {form.type === FanPageAssetType.AVATAR ? (
                <Field>
                  <FieldLabel>Пол</FieldLabel>
                  <Select
                    value={form.gender}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        gender:
                          value === Gender.MALE || value === Gender.FEMALE || value === Gender.ANY
                            ? value
                            : Gender.ANY,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <span>{genderLabels[form.gender]}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={Gender.ANY}>Любой пол</SelectItem>
                      <SelectItem value={Gender.FEMALE}>Женские</SelectItem>
                      <SelectItem value={Gender.MALE}>Мужские</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              <Field>
                <FieldLabel>Geo</FieldLabel>
                <Select
                  value={form.geoCode}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, geoCode: value ?? "" }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <span className="truncate text-left">
                      {selectedCountry ? <CountryLabel country={selectedCountry} /> : "Выберите geo"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {countries.map((country) => (
                      <SelectItem key={country.code} value={country.code}>
                        <CountryLabel country={country} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Команда</FieldLabel>
                <Select
                  value={form.teamId}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, teamId: value ?? "" }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <span className="truncate text-left">
                      {selectedTeam ? teamLine(selectedTeam) : "Выберите команду"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {teamLine(team)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="fan-page-asset-file">Файлы</FieldLabel>
                <Input
                  id="fan-page-asset-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      files: event.target.files ? Array.from(event.target.files) : [],
                    }))
                  }
                  required
                />
                {form.files.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Выбрано: {form.files.length} · {form.files.map((file) => file.name).join(", ")}
                  </p>
                ) : null}
              </Field>

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={isPending || form.files.length === 0 || !form.geoCode || !form.teamId}>
                <UploadIcon />
                {isPending ? "Загрузка…" : "Загрузить"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
