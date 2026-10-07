"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Image from "next/image"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FanPageAssetType, Gender } from "@prisma/client"
import { ChevronLeft, ChevronRight, ImageIcon, Pencil, Plus, SearchIcon, Trash2, UploadIcon } from "lucide-react"
import {
  deleteFanPageAsset,
  deleteFanPageAssets,
  updateFanPageAssets,
} from "@/app/actions/fan-page-library"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

type BulkEditForm = {
  type: string
  gender: string
  geoCode: string
  teamId: string
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
const keepValue = "__keep__"
const uploadBatchSize = 1
const maxUploadFileSize = 10 * 1024 * 1024
const acceptedUploadTypes = new Set(["image/jpeg", "image/png", "image/webp"])
const pageSizeOptions = [24, 48, 96]
const emptyBulkEditForm: BulkEditForm = {
  type: keepValue,
  gender: keepValue,
  geoCode: keepValue,
  teamId: keepValue,
}

function parseTypeFilter(value: string | null) {
  if (value === FanPageAssetType.AVATAR || value === FanPageAssetType.COVER) return value
  return emptyFilter
}

function parseGenderFilter(value: string | null) {
  if (value === Gender.MALE || value === Gender.FEMALE || value === Gender.ANY) return value
  return emptyFilter
}

function parseGeoFilter(value: string | null, countries: CountryOption[]) {
  const geoCode = (value || "").trim().toUpperCase()
  return countries.some((country) => country.code === geoCode) ? geoCode : emptyFilter
}

function parseTeamFilter(value: string | null, teams: TeamOption[]) {
  const teamId = (value || "").trim()
  return teams.some((team) => team.id === teamId) ? teamId : emptyFilter
}

function parsePageParam(value: string | null) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function parsePageSizeParam(value: string | null) {
  const parsed = Number(value)
  return pageSizeOptions.includes(parsed) ? parsed : pageSizeOptions[0]
}

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
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlFilters = useMemo(
    () => ({
      type: parseTypeFilter(searchParams.get("type")),
      gender: parseGenderFilter(searchParams.get("gender")),
      geo: parseGeoFilter(searchParams.get("geo"), countries),
      team: parseTeamFilter(searchParams.get("team"), teams),
      query: searchParams.get("q") ?? "",
      page: parsePageParam(searchParams.get("page")),
      size: parsePageSizeParam(searchParams.get("size")),
    }),
    [countries, searchParams, teams],
  )
  const [open, setOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string>(urlFilters.type)
  const [genderFilter, setGenderFilter] = useState<string>(urlFilters.gender)
  const [geoFilter, setGeoFilter] = useState<string>(urlFilters.geo)
  const [teamFilter, setTeamFilter] = useState<string>(urlFilters.team)
  const [query, setQuery] = useState(urlFilters.query)
  const [page, setPage] = useState(urlFilters.page)
  const [pageSize, setPageSize] = useState(urlFilters.size)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkEditForm, setBulkEditForm] = useState<BulkEditForm>(emptyBulkEditForm)
  const [form, setForm] = useState<UploadForm>({
    type: FanPageAssetType.AVATAR,
    gender: Gender.ANY,
    geoCode: countries[0]?.code ?? "",
    teamId: teams[0]?.id ?? "",
    files: [],
  })
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [isPending, startTransition] = useTransition()

  const countryMap = useMemo(
    () => new Map(countries.map((country) => [country.code, country])),
    [countries],
  )
  const selectedCountry = countryMap.get(form.geoCode) ?? null
  const selectedTeam = teams.find((team) => team.id === form.teamId) ?? null
  const bulkGeo = bulkEditForm.geoCode === keepValue ? null : countryMap.get(bulkEditForm.geoCode) ?? null
  const bulkTeam = bulkEditForm.teamId === keepValue ? null : teams.find((team) => team.id === bulkEditForm.teamId) ?? null

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const setOrDelete = (key: string, value: string, fallback = "") => {
      if (!value || value === fallback) params.delete(key)
      else params.set(key, value)
    }

    setOrDelete("type", typeFilter, emptyFilter)
    setOrDelete("gender", genderFilter, emptyFilter)
    setOrDelete("geo", geoFilter, emptyFilter)
    setOrDelete("team", teamFilter, emptyFilter)
    setOrDelete("q", query.trim())
    if (page > 1) params.set("page", String(page))
    else params.delete("page")
    if (pageSize !== pageSizeOptions[0]) params.set("size", String(pageSize))
    else params.delete("size")

    const nextQuery = params.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery !== currentQuery) {
      router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, { scroll: false })
    }
  }, [genderFilter, geoFilter, page, pageSize, pathname, query, router, searchParams, teamFilter, typeFilter])

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
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageEnd = Math.min(pageStart + pageSize, filteredAssets.length)
  const paginatedAssets = useMemo(
    () => filteredAssets.slice(pageStart, pageStart + pageSize),
    [filteredAssets, pageSize, pageStart],
  )
  const pageAssetIds = paginatedAssets.map((asset) => asset.id)
  const selectedOnPage = pageAssetIds.filter((id) => selectedIds.includes(id))
  const allPageSelected = pageAssetIds.length > 0 && selectedOnPage.length === pageAssetIds.length
  const hasActiveFilters =
    typeFilter !== emptyFilter ||
    genderFilter !== emptyFilter ||
    geoFilter !== emptyFilter ||
    teamFilter !== emptyFilter ||
    query.trim().length > 0 ||
    page !== 1 ||
    pageSize !== pageSizeOptions[0]

  function clearFilters() {
    setTypeFilter(emptyFilter)
    setGenderFilter(emptyFilter)
    setGeoFilter(emptyFilter)
    setTeamFilter(emptyFilter)
    setQuery("")
    setPage(1)
    setPageSize(pageSizeOptions[0])
  }

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

  async function uploadFanPageAsset(data: FormData) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetch("/api/fan-page-library/assets", {
        method: "POST",
        body: data,
        signal: controller.signal,
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        uploaded?: number
      } | null
      if (!response.ok) {
        return { error: payload?.error || `Ошибка загрузки (${response.status})` }
      }
      return payload || {}
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === "AbortError") {
        return { error: "Загрузка заняла больше 2 минут. Попробуй меньше файлов или сжать картинки." }
      }
      return {
        error: uploadError instanceof Error ? uploadError.message : "Не удалось загрузить картинки",
      }
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  async function submitUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setMessage("")

    const invalidFile = form.files.find((file) => !acceptedUploadTypes.has(file.type) || file.size > maxUploadFileSize)
    if (invalidFile) {
      setError(
        !acceptedUploadTypes.has(invalidFile.type)
          ? `${invalidFile.name || "Файл"}: нужен JPG, PNG или WEBP`
          : `${invalidFile.name || "Файл"}: файл должен быть до 10 МБ`,
      )
      return
    }

    setIsUploading(true)
    try {
      let uploaded = 0
      for (let index = 0; index < form.files.length; index += uploadBatchSize) {
        const batch = form.files.slice(index, index + uploadBatchSize)
        const data = new FormData()
        data.set("type", form.type)
        data.set("gender", form.type === FanPageAssetType.AVATAR ? form.gender : Gender.ANY)
        data.set("geoCode", form.geoCode)
        data.set("teamId", form.teamId)
        for (const file of batch) {
          data.append("files", file)
        }

        setMessage(`Загрузка: ${uploaded}/${form.files.length} · ${batch[0]?.name ?? "файл"}`)
        const result = await uploadFanPageAsset(data)
        if (result.error) {
          setError(result.error)
          setMessage(uploaded > 0 ? `Загружено до ошибки: ${uploaded}/${form.files.length}` : "")
          return
        }
        uploaded += result.uploaded || batch.length
      }
      setOpen(false)
      setMessage(`Картинок добавлено: ${uploaded}`)
      setPage(1)
      router.refresh()
    } finally {
      setIsUploading(false)
    }
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
      setSelectedIds((current) => current.filter((id) => id !== asset.id))
      router.refresh()
    })
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter((item) => item !== id)
    })
  }

  function togglePageSelected(checked: boolean) {
    setSelectedIds((current) => {
      if (checked) return Array.from(new Set([...current, ...pageAssetIds]))
      const pageIds = new Set(pageAssetIds)
      return current.filter((id) => !pageIds.has(id))
    })
  }

  function removeSelectedAssets() {
    if (selectedIds.length === 0) return
    if (!confirm(`Удалить выбранные картинки (${selectedIds.length})?`)) return
    const data = new FormData()
    for (const id of selectedIds) {
      data.append("ids", id)
    }
    setError("")
    setMessage("")
    startTransition(async () => {
      const result = await deleteFanPageAssets(data)
      if (result.error) {
        setError(result.error)
        return
      }
      setMessage(`Удалено картинок: ${selectedIds.length}`)
      setSelectedIds([])
      router.refresh()
    })
  }

  function openBulkEdit() {
    if (selectedIds.length === 0) return
    setBulkEditForm(emptyBulkEditForm)
    setError("")
    setMessage("")
    setBulkEditOpen(true)
  }

  function submitBulkEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const shouldUpdate =
      bulkEditForm.type !== keepValue ||
      bulkEditForm.gender !== keepValue ||
      bulkEditForm.geoCode !== keepValue ||
      bulkEditForm.teamId !== keepValue
    if (!shouldUpdate) {
      setError("Выберите, что изменить")
      return
    }

    const data = new FormData()
    for (const id of selectedIds) {
      data.append("ids", id)
    }
    if (bulkEditForm.type !== keepValue) data.set("type", bulkEditForm.type)
    if (bulkEditForm.gender !== keepValue) data.set("gender", bulkEditForm.gender)
    if (bulkEditForm.geoCode !== keepValue) data.set("geoCode", bulkEditForm.geoCode)
    if (bulkEditForm.teamId !== keepValue) data.set("teamId", bulkEditForm.teamId)

    setError("")
    setMessage("")
    startTransition(async () => {
      const result = await updateFanPageAssets(data)
      if (result.error) {
        setError(result.error)
        return
      }
      setMessage(`Обновлено картинок: ${result.updated ?? selectedIds.length}`)
      setSelectedIds([])
      setBulkEditOpen(false)
      router.refresh()
    })
  }

  const pagination = filteredAssets.length > 0 ? (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">
        Показано {pageStart + 1}-{pageEnd} из {filteredAssets.length}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            setPageSize(pageSizeOptions.includes(Number(value)) ? Number(value) : pageSizeOptions[0])
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-[132px]">
            <span>{pageSize} на странице</span>
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} на странице
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={currentPage <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            aria-label="Предыдущая страница"
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-24 text-center text-sm text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            aria-label="Следующая страница"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
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

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <Select
            value={typeFilter}
            onValueChange={(value) => {
              setTypeFilter(value ?? emptyFilter)
              setPage(1)
            }}
          >
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

          <Select
            value={genderFilter}
            onValueChange={(value) => {
              setGenderFilter(value ?? emptyFilter)
              setPage(1)
            }}
          >
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

          <Select
            value={geoFilter}
            onValueChange={(value) => {
              setGeoFilter(value ?? emptyFilter)
              setPage(1)
            }}
          >
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

          <Select
            value={teamFilter}
            onValueChange={(value) => {
              setTeamFilter(value ?? emptyFilter)
              setPage(1)
            }}
          >
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

          <Button
            type="button"
            variant="outline"
            className="w-full xl:w-auto"
            disabled={!hasActiveFilters}
            onClick={clearFilters}
          >
            Очистить
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{filteredAssets.length} найдено</Badge>
          {filteredAssets.length > 0 ? <Badge variant="outline">Страница {currentPage}/{totalPages}</Badge> : null}
          {selectedIds.length > 0 ? <Badge variant="secondary">Выбрано {selectedIds.length}</Badge> : null}
          <Badge variant="outline">Аватарки {assets.filter((asset) => asset.type === "AVATAR").length}</Badge>
          <Badge variant="outline">Обложки {assets.filter((asset) => asset.type === "COVER").length}</Badge>
        </div>

        {canDelete && filteredAssets.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={allPageSelected}
                indeterminate={!allPageSelected && selectedOnPage.length > 0}
                onCheckedChange={(checked) => togglePageSelected(Boolean(checked))}
                aria-label="Выбрать картинки на странице"
              />
              <span className="text-sm text-muted-foreground">
                На странице выбрано {selectedOnPage.length}/{pageAssetIds.length}
              </span>
              {selectedIds.length > 0 ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                  Снять выбор
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isPending || selectedIds.length === 0}
                onClick={openBulkEdit}
              >
                <Pencil />
                Редактировать {selectedIds.length > 0 ? selectedIds.length : ""}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isPending || selectedIds.length === 0}
                onClick={removeSelectedAssets}
              >
                <Trash2 />
                Удалить выбранные {selectedIds.length > 0 ? selectedIds.length : ""}
              </Button>
            </div>
          </div>
        ) : null}

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
        <div className="grid gap-3">
          {pagination}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {paginatedAssets.map((asset) => {
              const country = countryMap.get(asset.geoCode)
              const selected = selectedIds.includes(asset.id)
              return (
                <article
                  key={asset.id}
                  className={cn(
                    "relative overflow-hidden rounded-xl border bg-card shadow-sm",
                    selected ? "border-primary ring-2 ring-primary/25" : "",
                  )}
                >
                  {canDelete ? (
                    <div className="absolute top-2 left-2 z-10 rounded-md bg-background/90 p-1 shadow-sm backdrop-blur">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) => toggleSelected(asset.id, Boolean(checked))}
                        aria-label={`Выбрать ${asset.originalName}`}
                      />
                    </div>
                  ) : null}
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
                      quality={60}
                      sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 30vw, (min-width: 640px) 48vw, 100vw"
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
          {pagination}
        </div>
      )}

      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!isUploading) setOpen(nextOpen)
      }}>
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
                  <p className="max-h-24 overflow-auto text-xs text-muted-foreground">
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
              <Button type="button" variant="outline" disabled={isUploading} onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={isPending || isUploading || form.files.length === 0 || !form.geoCode || !form.teamId}
              >
                <UploadIcon />
                {isUploading ? "Загрузка…" : "Загрузить"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submitBulkEdit}>
            <DialogHeader>
              <DialogTitle>Массовое редактирование</DialogTitle>
              <DialogDescription>
                Изменения применятся к выбранным картинкам: {selectedIds.length}.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="mt-4">
              <Field>
                <FieldLabel>Тип</FieldLabel>
                <Select
                  value={bulkEditForm.type}
                  onValueChange={(value) =>
                    setBulkEditForm((current) => ({
                      ...current,
                      type: value ?? keepValue,
                      gender: value === FanPageAssetType.COVER ? Gender.ANY : current.gender,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <span>
                      {bulkEditForm.type === keepValue
                        ? "Не менять"
                        : assetTypeLabels[bulkEditForm.type as FanPageAssetType]}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={keepValue}>Не менять</SelectItem>
                    <SelectItem value={FanPageAssetType.AVATAR}>Аватарки</SelectItem>
                    <SelectItem value={FanPageAssetType.COVER}>Обложки</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Пол</FieldLabel>
                <Select
                  value={bulkEditForm.gender}
                  onValueChange={(value) =>
                    setBulkEditForm((current) => ({
                      ...current,
                      gender:
                        value === Gender.MALE || value === Gender.FEMALE || value === Gender.ANY
                          ? value
                          : keepValue,
                    }))
                  }
                  disabled={bulkEditForm.type === FanPageAssetType.COVER}
                >
                  <SelectTrigger className="w-full">
                    <span>
                      {bulkEditForm.gender === keepValue
                        ? "Не менять"
                        : genderLabels[bulkEditForm.gender as Gender]}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={keepValue}>Не менять</SelectItem>
                    <SelectItem value={Gender.ANY}>Любой пол</SelectItem>
                    <SelectItem value={Gender.FEMALE}>Женские</SelectItem>
                    <SelectItem value={Gender.MALE}>Мужские</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Geo</FieldLabel>
                <Select
                  value={bulkEditForm.geoCode}
                  onValueChange={(value) =>
                    setBulkEditForm((current) => ({ ...current, geoCode: value ?? keepValue }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <span className="truncate text-left">
                      {bulkEditForm.geoCode === keepValue
                        ? "Не менять"
                        : bulkGeo
                          ? <CountryLabel country={bulkGeo} />
                          : bulkEditForm.geoCode}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={keepValue}>Не менять</SelectItem>
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
                  value={bulkEditForm.teamId}
                  onValueChange={(value) =>
                    setBulkEditForm((current) => ({ ...current, teamId: value ?? keepValue }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <span className="truncate text-left">
                      {bulkEditForm.teamId === keepValue
                        ? "Не менять"
                        : bulkTeam
                          ? teamLine(bulkTeam)
                          : "Команда"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={keepValue}>Не менять</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {teamLine(team)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setBulkEditOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={isPending || selectedIds.length === 0}>
                <Pencil />
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
