"use client"

import { useTranslations, useLocalizedCountries } from "@/components/language-provider"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { CheckCheck, Heart, Loader2, Paperclip, Play, Plus, RefreshCw, Sparkles, Trash2, UserPlus, X } from "lucide-react"
import { enqueueFarmTaskForm } from "@/app/actions/farm-queue"
import type { AdsPowerProfile } from "@/lib/adspower"
import { pushAppNotification } from "@/lib/app-notifications"
import { profileDisplayGeo, profileTeamMarkerFromName } from "@/lib/profile-geo"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"
import { CommentMediaPreview } from "@/components/comment-media-preview"
import { COMMENT_MEDIA_ACCEPT, COMMENT_MEDIA_HINT, MAX_COMMENT_MEDIA_TOTAL_SIZE, commentMediaError, isCommentVideo } from "@/lib/comment-media"

export type CountryInfo = {
  name: string
  flagSvg: string
}

type FarmPage = AdsPowerProfile & {
  listId: string
  displayName: string
  browserId: string
  displayGeo: string
  displayTeamMarker: string
  gender?: string | null
  synced: boolean
}

type FarmAction = "comment" | "like" | "likeonly" | "subscribe"
type ContentMode = "same" | "split" | "ai"
type GenderFilter = "ALL" | "MALE" | "FEMALE" | "UNKNOWN"

const UNKNOWN_GEO = "ZZ"
const AVATAR_TONES = [
  "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200",
]

function fansLabel(count: number) {
  const n10 = count % 10
  const n100 = count % 100
  if (n10 === 1 && n100 !== 11) return `${count} фанка`
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${count} фанки`
  return `${count} фанок`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase() || "?"
}

function avatarTone(value: string) {
  let hash = 0
  for (const char of value) hash = (hash + char.charCodeAt(0)) % AVATAR_TONES.length
  return AVATAR_TONES[hash]
}

function fanGenderLabel(gender?: string | null) {
  if (gender === "MALE") return "Муж."
  if (gender === "FEMALE") return "Жен."
  return "Пол не определён"
}

function fanGenderTone(gender?: string | null) {
  if (gender === "MALE") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
  if (gender === "FEMALE") return "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900 dark:bg-pink-950/40 dark:text-pink-200"
  return "border-muted-foreground/20 bg-muted text-muted-foreground"
}

function groupKey(profile: AdsPowerProfile) {
  return profile.groupName.trim() || profile.name.trim() || profile.id
}

function messageKey(postIndex: number, listId: string) {
  return `${postIndex}:${listId}`
}

function pagesFromProfile(profile: AdsPowerProfile, countryCodes?: Iterable<string>): FarmPage[] {
  if (profile.fans.length > 0) {
    return profile.fans.map((fan) => ({
      ...profile,
      listId: fan.id,
      displayName: fan.name,
      browserId: profile.id,
      displayGeo: profileDisplayGeo(profile, countryCodes),
      displayTeamMarker: profileTeamMarkerFromName(profile.name),
      gender: fan.gender,
      synced: true,
    }))
  }
  return [
    {
      ...profile,
      listId: profile.id,
      displayName: profile.name,
      browserId: profile.id,
      displayGeo: profileDisplayGeo(profile, countryCodes),
      displayTeamMarker: profileTeamMarkerFromName(profile.name),
      gender: null,
      synced: false,
    },
  ]
}


function actionLabel(action: FarmAction) {
  if (action === "likeonly") return "Лайк"
  if (action === "like") return "Комментарий + лайк"
  if (action === "subscribe") return "Комментарий + лайк + подписка"
  return "Комментарий"
}

function fileSizeLabel(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`
}

function PagesIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

async function readSwitchEvents(
  response: Response,
  onEvent: (event: {
    type: string
    level?: "info" | "ok" | "error"
    text?: string
    ok?: boolean
    message?: string
    formatted?: Array<{ currentName: string; newName: string; nameApplied?: boolean }>
    pending?: Array<{ currentName: string; newName: string; message: string }>
    failed?: Array<{ currentName: string; newName?: string; message: string }>
  }) => void,
) {
  if (!response.body) {
    throw new Error("Нет потока логов")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      const line = part.split("\n").find((value) => value.startsWith("data: "))
      if (!line) continue
      onEvent(JSON.parse(line.slice(6)) as {
        type: string
        level?: "info" | "ok" | "error"
        text?: string
        ok?: boolean
        message?: string
        formatted?: Array<{ currentName: string; newName: string; nameApplied?: boolean }>
        pending?: Array<{ currentName: string; newName: string; message: string }>
        failed?: Array<{ currentName: string; newName?: string; message: string }>
      })
    }
  }
}

type FormatJobStatus = "PENDING" | "RUNNING" | "DONE" | "ERROR"

type FormatJobSnapshot = {
  id: string
  status: FormatJobStatus
  total: number
  message: string
  error: string | null
  formattedCount: number
  pendingCount: number
  failedCount: number
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatJobsFinished(jobs: FormatJobSnapshot[]) {
  return jobs.length > 0 && jobs.every((job) => job.status === "DONE" || job.status === "ERROR")
}

async function fetchFormatJobs(ids: string[]) {
  const response = await fetch(`/api/format-fans?ids=${encodeURIComponent(ids.join(","))}`, {
    cache: "no-store",
  })
  if (!response.ok) throw new Error("Не удалось получить статус форматирования")
  const data = (await response.json()) as { jobs?: FormatJobSnapshot[] }
  return data.jobs ?? []
}

export function FarmComments({
  profiles,
  countries: sourceCountries = {},
  canSyncFans,
}: {
  profiles: AdsPowerProfile[]
  countries: Record<string, CountryInfo>
  canSyncFans: boolean
}) {
  const t = useTranslations()
  const countries = useLocalizedCountries(sourceCountries)

  const ACTION_OPTIONS: {
    id: FarmAction
    title: ReactNode
    description: string
  }[] = [
    {
      id: "comment",
      title: t("Комментарий"),
      description: t("Комментарий от фанки через браузер, как от страницы."),
    },
    {
      id: "likeonly",
      title: (
        <span className="inline-flex items-center gap-1.5">
          <Heart className="size-4 fill-current" />
          {t("Просто лайк")}
        </span>
      ),
      description: t("Фанка ставит Like или Love, комментарий не пишем."),
    },
    {
      id: "like",
      title: (
        <span className="inline-flex items-center gap-1.5">
          <Heart className="size-4 fill-current" />
          {t("Лайк вместе с комментарием")}
        </span>
      ),
      description: t("Комментарий, затем наводим на лайк и ставим Like или Love."),
    },
    {
      id: "subscribe",
      title: (
        <span className="inline-flex items-center gap-1.5">
          <UserPlus className="size-4" />
          {t("Подписка + лайк + комментарий")}
        </span>
      ),
      description:
        t("Комментарий, лайк и подписка на автора: Follow на карточке или в профиле. Если Follow не выйдет — комментарий и лайк всё равно уйдут."),
    },
  ]


  const router = useRouter()
  const [posts, setPosts] = useState<string[]>([""])
  const [action, setAction] = useState<FarmAction>("comment")
  const [contentMode, setContentMode] = useState<ContentMode>("same")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [bulkSplitText, setBulkSplitText] = useState("")
  const [splitMessages, setSplitMessages] = useState<Record<string, string>>({})
  const [commentPhoto, setCommentPhoto] = useState<File | null>(null)
  const [commentPhotoError, setCommentPhotoError] = useState("")
  const [commentPhotoPreview, setCommentPhotoPreview] = useState("")
  const [splitPhotos, setSplitPhotos] = useState<Record<string, File>>({})
  const [splitPhotoErrors, setSplitPhotoErrors] = useState<Record<string, string>>({})
  const [splitPhotoPreviews, setSplitPhotoPreviews] = useState<Record<string, string>>({})
  const [profileQuery, setProfileQuery] = useState("")
  const [pageQuery, setPageQuery] = useState("")
  const [activeGroups, setActiveGroups] = useState<string[]>([])
  const [geoFilter, setGeoFilter] = useState<string | null>(null)
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("ALL")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [syncPending, setSyncPending] = useState(false)
  const [formatPending, setFormatPending] = useState(false)
  const [enqueueing, setEnqueueing] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const countryCodes = useMemo(() => Object.keys(countries), [countries])

  const groups = useMemo(() => {
    const buckets = new Map<string, AdsPowerProfile[]>()
    for (const profile of profiles) {
      const key = groupKey(profile)
      const list = buckets.get(key) ?? []
      list.push(profile)
      buckets.set(key, list)
    }
    return [...buckets.entries()]
      .map(([key, items]) => ({
        key,
        name: key,
        items,
        open: items.some((item) => item.open),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "ru"))
  }, [profiles])

  const visibleGroups = useMemo(() => {
    const needle = profileQuery.trim().toLowerCase()
    if (!needle) return groups
    return groups.filter((group) =>
      [group.name, ...group.items.map((item) => `${item.name} ${item.serial} ${item.username}`)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
  }, [groups, profileQuery])

  const activeProfiles = useMemo(() => {
    if (activeGroups.length === 0) return []
    const selected = new Set(activeGroups)
    return groups.filter((group) => selected.has(group.key)).flatMap((group) => group.items)
  }, [activeGroups, groups])

  const geos = useMemo(() => {
    const codes = [...new Set(activeProfiles.map((profile) => profileDisplayGeo(profile, countryCodes) || UNKNOWN_GEO))]
    return codes.sort((left, right) => {
      if (left === UNKNOWN_GEO) return 1
      if (right === UNKNOWN_GEO) return -1
      return (countries[left]?.name || left).localeCompare(countries[right]?.name || right, "ru")
    })
  }, [activeProfiles, countries, countryCodes])

  const pageList = useMemo(() => {
    const needle = pageQuery.trim().toLowerCase()
    return activeProfiles
      .flatMap((profile) => pagesFromProfile(profile, countryCodes))
      .filter((page) => {
        if (geoFilter && (page.displayGeo || UNKNOWN_GEO) !== geoFilter) return false
        if (genderFilter === "MALE" && page.gender !== "MALE") return false
        if (genderFilter === "FEMALE" && page.gender !== "FEMALE") return false
        if (genderFilter === "UNKNOWN" && (page.gender === "MALE" || page.gender === "FEMALE")) return false
        if (!needle) return true
        return [page.displayName, page.name, page.serial, page.username, page.displayGeo, page.id]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ru"))
  }, [activeProfiles, countryCodes, genderFilter, geoFilter, pageQuery])

  const visibleIds = pageList.map((page) => page.listId)
  const selectedPages = pageList.filter((page) => selectedIds.includes(page.listId))
  const postUrls = posts.map((value) => value.trim()).filter(Boolean)
  const splitPostSlots = postUrls.length > 0 ? postUrls : [""]
  const splitPerPage =
    contentMode === "split"

  useEffect(() => {
    return () => {
      if (commentPhotoPreview) URL.revokeObjectURL(commentPhotoPreview)
    }
  }, [commentPhotoPreview])

  function toggleGroup(key: string) {
    setActiveGroups((current) => {
      const next = current.includes(key) ? current.filter((value) => value !== key) : [...current, key]
      if (next.length === 0) {
        setGeoFilter(null)
        setSelectedIds([])
      }
      return next
    })
  }

  function toggleId(id: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
    )
  }

  function messageFor(listId: string, postIndex: number) {
    if (!splitPerPage) return message
    return splitMessages[messageKey(postIndex, listId)] ?? ""
  }

  function clearForm() {
    setPosts([""])
    setMessage("")
    setBulkSplitText("")
    setSplitMessages({})
    setCommentPhoto(null)
    for (const preview of Object.values(splitPhotoPreviews)) URL.revokeObjectURL(preview)
    setSplitPhotos({})
    setSplitPhotoErrors({})
    setSplitPhotoPreviews({})
    setCommentPhotoPreview("")
    setCommentPhotoError("")
    if (photoInputRef.current) photoInputRef.current.value = ""
    setSelectedIds([])
  }

  function validatePhoto(file: File | undefined) {
    if (!file) return { file: null }
    const error = commentMediaError(file)
    if (error) return { file: null, error }
    return { file }
  }

  function onPhotoSelected(file: File | undefined) {
    setCommentPhotoError("")
    const result = validatePhoto(file)
    if (!result.file) {
      setCommentPhoto(null)
      setCommentPhotoPreview("")
      if (result.error) setCommentPhotoError(result.error)
      if (photoInputRef.current) photoInputRef.current.value = ""
      return
    }
    setCommentPhoto(result.file)
    setCommentPhotoPreview(URL.createObjectURL(result.file))
  }

  function removePhoto() {
    setCommentPhoto(null)
    setCommentPhotoPreview("")
    setCommentPhotoError("")
    if (photoInputRef.current) photoInputRef.current.value = ""
  }

  function onSplitPhotoSelected(key: string, file: File | undefined) {
    const result = validatePhoto(file)
    if (!result.file) {
      setSplitPhotos((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      setSplitPhotoPreviews((current) => {
        if (current[key]) URL.revokeObjectURL(current[key])
        const next = { ...current }
        delete next[key]
        return next
      })
      setSplitPhotoErrors((current) => ({ ...current, [key]: result.error || "" }))
      return
    }

    const selectedFile = result.file
    setSplitPhotos((current) => ({ ...current, [key]: selectedFile }))
    setSplitPhotoPreviews((current) => {
      if (current[key]) URL.revokeObjectURL(current[key])
      return { ...current, [key]: URL.createObjectURL(selectedFile) }
    })
    setSplitPhotoErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function removeSplitPhoto(key: string) {
    setSplitPhotos((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setSplitPhotoPreviews((current) => {
      if (current[key]) URL.revokeObjectURL(current[key])
      const next = { ...current }
      delete next[key]
      return next
    })
    setSplitPhotoErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function generateSplitMessages() {
    const lines = bulkSplitText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const keys = splitPostSlots.flatMap((_, postIndex) =>
      selectedPages.map((page) => messageKey(postIndex, page.listId)),
    )
    if (lines.length === 0 || keys.length === 0) return

    setSplitMessages((current) => {
      const next = { ...current }
      for (const key of keys) {
        delete next[key]
      }
      keys.forEach((key, index) => {
        if (lines[index]) next[key] = lines[index]
      })
      return next
    })
  }

  async function onLaunch() {
    const jobs = selectedPages.flatMap((page) =>
      postUrls.map((url, postIndex) => ({
        profileId: page.browserId,
        fanName: page.displayName,
        url,
        message: contentMode === "ai" ? "" : messageFor(page.listId, postIndex),
        aiComment: contentMode === "ai",
        photoKey: splitPerPage ? messageKey(postIndex, page.listId) : undefined,
      })),
    )

    if (jobs.length === 0) return

    setEnqueueing(true)
    try {
      const payload = { action, jobs }
      const formData = new FormData()
      const payloadText = JSON.stringify(payload)
      const attachmentFiles = splitPerPage ? Object.values(splitPhotos) : commentPhoto ? [commentPhoto] : []
      if (attachmentFiles.reduce((sum, file) => sum + file.size, new Blob([payloadText]).size) > MAX_COMMENT_MEDIA_TOTAL_SIZE) {
        pushAppNotification(t("Вложения"), t("Общий размер вложений и задачи должен быть до 70 МБ"), { tone: "error" })
        return
      }
      formData.set("payload", payloadText)
      if (splitPerPage) {
        for (const [key, file] of Object.entries(splitPhotos)) {
          formData.set(`photo:${key}`, file)
        }
      } else if (commentPhoto) {
        formData.set("photo", commentPhoto)
      }
      const result = await enqueueFarmTaskForm(formData)
      if (result.error) {
        pushAppNotification(t("Очередь"), result.error, {
          href: "/queue?tab=work",
          tone: "error",
        })
        return
      }
      setConfirmOpen(false)
      clearForm()
      pushAppNotification(
        t("Задача в очереди"),
        t("{0} · {1} шт.{2} Можно создавать следующую.", actionLabel(action), result.total || jobs.length, result.rewritten ? t(" AI перефразировал дублей: {0}.", result.rewritten) : ""),
        { href: "/queue?tab=work", tone: "queue" },
      )
      void fetch("/api/farm-queue", { method: "POST" })
    } catch (error) {
      pushAppNotification(
        t("Очередь"),
        error instanceof Error ? error.message : t("Не удалось поставить в очередь"),
        { href: "/queue?tab=work", tone: "error" },
      )
    } finally {
      setEnqueueing(false)
    }
  }

  async function onSyncFans() {
    const ids = [...new Set(activeProfiles.map((profile) => profile.id))]
    if (ids.length === 0) return
    setSyncPending(true)
    pushAppNotification(
      t("Синхронизация фанок"),
      t("Запущена · {0} профил.", ids.length),
      { tone: "queue" },
    )

    let okCount = 0
    let failCount = 0
    try {
      for (const profileId of ids) {
        const response = await fetch("/api/sync-fans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId }),
        })
        let profileOk = false
        await readSwitchEvents(response, (event) => {
          if (event.type === "done") {
            profileOk = event.ok === true
          }
        })
        if (profileOk) okCount += 1
        else failCount += 1
      }
    } catch {
      failCount += 1
    } finally {
      pushAppNotification(
        failCount === 0 ? t("Синхронизация фанок") : t("Синхронизация фанок · ошибка"),
        failCount === 0
          ? t("Готово · {0} профил.", okCount)
          : t("{0} ок, {1} с ошибкой", okCount, failCount),
        { tone: failCount === 0 ? "success" : "error" },
      )
      setSyncPending(false)
      router.refresh()
    }
  }

  async function onFormatFans() {
    if (selectedPages.length === 0) return
    const byProfile = new Map<string, FarmPage[]>()
    for (const page of selectedPages) {
      const list = byProfile.get(page.browserId) ?? []
      list.push(page)
      byProfile.set(page.browserId, list)
    }

    setFormatPending(true)
    pushAppNotification(
      t("Форматирование фанок"),
      t("Ставим в фон · {0} фанок", selectedPages.length),
      { tone: "queue" },
    )

    let queuedIds: string[] = []
    try {
      const response = await fetch("/api/format-fans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobs: [...byProfile.entries()].map(([profileId, pages]) => ({
            profileId,
            fans: pages.map((page) => ({
              name: page.displayName,
              geo: page.displayGeo,
              teamMarker: page.displayTeamMarker,
              gender: page.gender,
            })),
          })),
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | { jobs?: Array<{ id: string; profileId: string; total: number }>; error?: string }
        | null
      if (!response.ok || !data?.jobs?.length) {
        throw new Error(data?.error || t("Не удалось поставить форматирование в очередь"))
      }

      queuedIds = data.jobs.map((job) => job.id)
      setSelectedIds([])
      pushAppNotification(
        t("Форматирование фанок"),
        t("Фоновая задача создана · {0} профил. · {1} фанок", data.jobs.length, selectedPages.length),
        { tone: "queue" },
      )

      let jobs: FormatJobSnapshot[] = []
      for (let attempt = 0; attempt < 720; attempt += 1) {
        await wait(2500)
        jobs = await fetchFormatJobs(queuedIds)
        if (formatJobsFinished(jobs)) break
      }

      const okCount = jobs.reduce((sum, job) => sum + job.formattedCount, 0)
      const pendingCount = jobs.reduce((sum, job) => sum + job.pendingCount, 0)
      const failCount = jobs.reduce(
        (sum, job) => sum + job.failedCount + (job.status === "ERROR" && job.failedCount === 0 ? 1 : 0),
        0,
      )
      const summary = [
        t("{0} ок", okCount),
        pendingCount > 0 ? t("{0} на review", pendingCount) : "",
        failCount > 0 ? t("{0} с ошибкой", failCount) : "",
      ]
        .filter(Boolean)
        .join(", ")
      pushAppNotification(
        failCount > 0
          ? t("Форматирование фанок · ошибка")
          : pendingCount > 0
            ? t("Форматирование фанок · review")
            : t("Форматирование фанок"),
        failCount === 0 && pendingCount === 0 ? t("Готово · {0} фанок", okCount) : summary,
        { tone: failCount > 0 ? "error" : pendingCount > 0 ? "queue" : "success" },
      )
    } catch (error) {
      pushAppNotification(
        queuedIds.length > 0 ? t("Форматирование фанок") : t("Форматирование фанок · ошибка"),
        queuedIds.length > 0
          ? t("Фоновая задача продолжает идти на сервере; статус будет в логах")
          : error instanceof Error
            ? error.message
            : t("Не удалось запустить форматирование"),
        { tone: queuedIds.length > 0 ? "queue" : "error" },
      )
    } finally {
      setFormatPending(false)
      router.refresh()
    }
  }

  const needsMessage = action !== "likeonly"
  const canLaunch =
    selectedPages.length > 0 &&
    postUrls.length > 0 &&
    (!needsMessage ||
      contentMode === "ai" ||
      (splitPerPage
        ? postUrls.every((_, postIndex) =>
            selectedPages.every((page) => (splitMessages[messageKey(postIndex, page.listId)] ?? "").trim()),
          )
        : message.trim().length > 0))
  const splitPhotoCount = Object.keys(splitPhotos).length
  const showTaskBuilder = false

  return (
    <div className={cn(
      "grid items-start gap-4",
      showTaskBuilder ? "sm:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)]" : "sm:grid-cols-1",
    )}>
      {showTaskBuilder ? (
      <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="grid gap-1">
          <h2 className="font-heading text-base font-medium">{t("Пост и действия")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Вставь ссылку на пост и выбери комментарий или лайк.")}</p>
        </div>

        <div className="mt-5 grid gap-2">
          <p className="text-sm font-medium">{t("Ссылки на посты (или числовые id)")}</p>
          <div className="grid gap-2">
            {posts.map((post, index) => (
              <Input
                key={index}
                value={post}
                onChange={(event) =>
                  setPosts((current) =>
                    current.map((value, itemIndex) =>
                      itemIndex === index ? event.target.value : value,
                    ),
                  )
                }
                placeholder={t("Ссылка на пост Facebook или числовой id")}
                autoComplete="off"
              />
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-fit rounded-full"
            onClick={() => setPosts((current) => [...current, ""])}
          >
            <Plus />
            {t("Добавить ещё пост")}</Button>
        </div>

        <div className="mt-6 grid gap-2">
          <p className="text-sm font-medium">{t("Действия")}</p>
          <div role="radiogroup" aria-label={t("Действие")} className="grid gap-2">
            {ACTION_OPTIONS.map((option) => (
              <ActionTablet
                key={option.id}
                selected={action === option.id}
                title={option.title}
                description={option.description}
                onSelect={() => setAction(option.id)}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          {action === "likeonly" ? (
            <p className="text-sm text-muted-foreground">
              {t("Для простого лайка текст не нужен — фанка только поставит реакцию на пост.")}</p>
          ) : (
            <>
              <p className="text-sm font-medium">{t("Текст комментария")}</p>
          <div className="grid h-9 grid-cols-3 items-center gap-1 rounded-full bg-muted p-1">
            {(
              [
                { id: "same", label: t("Один текст") },
                { id: "split", label: t("Разные") },
                { id: "ai", label: "ChatGPT" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setContentMode(option.id)}
                className={cn(
                  "inline-flex h-full items-center justify-center gap-1 truncate rounded-full px-2 text-xs font-medium whitespace-nowrap transition-colors",
                  contentMode === option.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.id === "ai" ? <Sparkles className="size-3.5" /> : null}
                {option.label}
              </button>
            ))}
          </div>

          {contentMode === "ai" ? null : splitPerPage ? (
            selectedIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("Выбери страницы справа — появится поле на каждую.")}</p>
            ) : (
              <div className="grid gap-3">
                <div className="grid gap-2 rounded-xl border bg-muted/25 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="grid gap-1">
                      <p className="text-sm font-medium">{t("Раздельный текст")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("Каждая новая строка станет отдельным комментарием.")}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={bulkSplitText.trim().length === 0 || selectedPages.length === 0}
                      onClick={generateSplitMessages}
                    >
                      <Sparkles />
                      {t("Сгенерировать")}
                    </Button>
                  </div>
                  <Textarea
                    value={bulkSplitText}
                    onChange={(event) => setBulkSplitText(event.target.value)}
                    placeholder={t("Первый комментарий\nВторой комментарий\nТретий комментарий")}
                    rows={5}
                  />
                </div>
                {splitPostSlots.map((url, postIndex) => (
                  <div key={`${postIndex}-${url || "draft"}`} className="grid gap-2">
                    {splitPostSlots.length > 1 ? (
                      <p className="truncate text-xs font-medium text-muted-foreground">
                        {t("Пост ")}{postIndex + 1}: {url}
                      </p>
                    ) : postUrls.length === 0 ? (
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("Ссылка ещё не заполнена — комментарии подготовятся для первого поста.")}</p>
                    ) : null}
                    {selectedPages.map((page) => {
                      const key = messageKey(postIndex, page.listId)
                      return (
                        <div key={key} className="grid gap-2">
                          <label className="grid gap-1.5">
                            <span className="text-sm font-medium">{page.displayName}</span>
                            <Textarea
                              value={splitMessages[key] ?? ""}
                              onChange={(event) =>
                                setSplitMessages((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                              placeholder={t("Текст комментария")}
                              rows={3}
                            />
                          </label>
                          <CommentPhotoPicker
                            file={splitPhotos[key] || null}
                            preview={splitPhotoPreviews[key] || ""}
                            error={splitPhotoErrors[key] || ""}
                            onSelect={(file) => onSplitPhotoSelected(key, file)}
                            onRemove={() => removeSplitPhoto(key)}
                          />
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          ) : (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{t("Сообщение")}</span>
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t("Текст комментария")}
                rows={4}
              />
            </label>
          )}
          {!splitPerPage ? (
            <div className="grid gap-2 rounded-xl border border-dashed bg-muted/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t("Вложение к комментарию")}</p>
                  <p className="text-xs text-muted-foreground">{t(COMMENT_MEDIA_HINT)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {commentPhoto ? (
                    <Button type="button" variant="ghost" size="icon" aria-label={t("Убрать вложение")} onClick={removePhoto}>
                      <Trash2 />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <Paperclip />
                    {t("Прикрепить")}</Button>
                </div>
              </div>
            <input
              ref={photoInputRef}
              type="file"
              accept={COMMENT_MEDIA_ACCEPT}
              className="hidden"
              onChange={(event) => onPhotoSelected(event.target.files?.[0])}
            />
            {commentPhoto ? (
              <div className="flex items-center gap-3 rounded-lg border bg-background p-2">
                {commentPhotoPreview ? (
                  <CommentMediaPreview
                    src={commentPhotoPreview}
                    name={commentPhoto.name}
                    mime={commentPhoto.type}
                    controls
                    className={isCommentVideo(commentPhoto.name, commentPhoto.type) ? "h-32 w-48 shrink-0 rounded-md bg-black object-contain" : "size-12 rounded-md object-cover"}
                  />
                ) : null}
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{commentPhoto.name}</p>
                  <p className="text-xs text-muted-foreground">{fileSizeLabel(commentPhoto.size)}</p>
                </div>
              </div>
            ) : null}
            {commentPhotoError ? (
              <p className="text-sm text-destructive">{commentPhotoError}</p>
            ) : null}
            </div>
          ) : null}
            </>
          )}
        </div>

        <Button
          type="button"
          className="mt-5 w-full"
          disabled={!canLaunch}
          onClick={() => setConfirmOpen(true)}
        >
          <Play />
          {t("Создать задачу ({0})", selectedPages.length * postUrls.length)}
        </Button>
      </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading shrink-0 text-sm font-medium">
            {t("Страницы (")}{selectedIds.length} {t(" выбрано)")}</h2>
          <div className="flex shrink-0 items-center gap-0.5">
            {canSyncFans ? (
              <>
                <PagesIconButton
                  label={t("Синхронизировать фанки")}
                  disabled={syncPending || formatPending || activeProfiles.length === 0}
                  onClick={() => void onSyncFans()}
                >
                  {syncPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                </PagesIconButton>
                <PagesIconButton
                  label={t("Форматировать фанки")}
                  disabled={syncPending || formatPending || selectedPages.length === 0}
                  onClick={() => void onFormatFans()}
                >
                  {formatPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                </PagesIconButton>
              </>
            ) : null}
            <PagesIconButton
              label={t("Выбрать видимые")}
              disabled={visibleIds.length === 0}
              onClick={() =>
                setSelectedIds((current) => [...new Set([...current, ...visibleIds])])
              }
            >
              <CheckCheck className="size-4" />
            </PagesIconButton>
            <PagesIconButton
              label={t("Сбросить")}
              disabled={selectedIds.length === 0}
              onClick={() => setSelectedIds([])}
            >
              <X className="size-4" />
            </PagesIconButton>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          <Input
            value={profileQuery}
            onChange={(event) => setProfileQuery(event.target.value)}
            placeholder={t("Поиск профиля...")}
            aria-label={t("Поиск профиля")}
          />
          {visibleGroups.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              {t("Профилей нет")}</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {visibleGroups.map((group) => {
                const groupPages = group.items.flatMap((profile) => pagesFromProfile(profile, countryCodes))
                const selectedCount = groupPages.filter((page) =>
                  selectedIds.includes(page.listId),
                ).length
                const fanCount = group.items.reduce(
                  (count, item) => count + Math.max(item.fans.length, 1),
                  0,
                )
                const active = activeGroups.includes(group.key)
                const groupGeos = [
                  ...new Set(group.items.map((item) => profileDisplayGeo(item, countryCodes)).filter(Boolean)),
                ]
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className={cn(
                      "min-w-40 shrink-0 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-primary bg-muted"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-1 size-2 shrink-0 rounded-full",
                          group.open ? "bg-emerald-500" : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{group.name}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          #{group.items[0]?.serial || "—"}
                          <span>{fansLabel(fanCount)}</span>
                          {selectedCount > 0 ? (
                            <span className="text-foreground">✓ {selectedCount}</span>
                          ) : null}
                        </span>
                        {groupGeos.length > 0 ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {groupGeos.slice(0, 3).map((code) => {
                              const country = countries[code]
                              return (
                                <Badge key={code} variant="outline" className="h-5 gap-1 px-1.5 text-[0.68rem] font-normal">
                                  {country?.flagSvg ? (
                                    <Image
                                      src={country.flagSvg}
                                      alt=""
                                      width={14}
                                      height={10}
                                      className="h-2.5 w-3.5 rounded-[2px] object-cover"
                                    />
                                  ) : null}
                                  {code}
                                </Badge>
                              )
                            })}
                            {groupGeos.length > 3 ? (
                              <Badge variant="outline" className="h-5 px-1.5 text-[0.68rem] font-normal">
                                +{groupGeos.length - 3}
                              </Badge>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-2">
          <Input
            value={pageQuery}
            onChange={(event) => setPageQuery(event.target.value)}
            placeholder={t("Поиск страниц или гео...")}
            aria-label={t("Поиск страниц или гео")}
            disabled={activeGroups.length === 0}
          />

          {activeGroups.length === 0 ? (
            <div className="grid gap-6 py-8 text-center text-sm text-muted-foreground">
              <p>
                {t("Сначала выбери профиль выше — тогда появится фильтр гео и список фанок.")}</p>
              <p>{t("Выбери профиль выше.")}</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant={geoFilter === null ? "secondary" : "outline"}
                  className="rounded-full"
                  onClick={() => setGeoFilter(null)}
                >
                  {t("Все гео")}</Button>
                {geos.map((code) => (
                  <Button
                    key={code}
                    type="button"
                    size="xs"
                    variant={geoFilter === code ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => setGeoFilter(code === geoFilter ? null : code)}
                  >
                    {code === UNKNOWN_GEO ? "—" : code}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ["ALL", t("Все полы")],
                  ["FEMALE", t("Жен.")],
                  ["MALE", t("Муж.")],
                  ["UNKNOWN", t("Не определено")],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="xs"
                    variant={genderFilter === value ? "secondary" : "outline"}
                    className="rounded-full"
                    onClick={() => setGenderFilter(value as GenderFilter)}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {pageList.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("Никого не нашли")}</p>
              ) : (
                <ul className="grid max-h-[32rem] gap-1.5 overflow-y-auto pr-1">
                  {pageList.map((page) => {
                    const selected = selectedIds.includes(page.listId)
                    return (
                      <li key={page.listId}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-2",
                            selected
                              ? "border-primary bg-muted"
                              : "border-transparent hover:bg-muted/50",
                          )}
                        >
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) =>
                              toggleId(page.listId, checked === true)
                            }
                            aria-label={t("Выбрать {0}", page.displayName)}
                          />
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                              avatarTone(page.displayName),
                            )}
                          >
                            {initials(page.displayName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {page.displayName}
                            </span>
                            {page.synced ? (
                              <span
                                className={cn(
                                  "mt-1 inline-flex h-5 items-center rounded-full border px-1.5 text-[0.68rem] font-medium",
                                  fanGenderTone(page.gender),
                                )}
                              >
                                {t(fanGenderLabel(page.gender))}
                              </span>
                            ) : (
                              <span className="block text-xs text-muted-foreground">
                                {t("Имя AdsPower")}</span>
                            )}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </section>

      {showTaskBuilder ? (
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (enqueueing) return
          setConfirmOpen(open)
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg"
          showCloseButton={!enqueueing}
        >
          <DialogHeader className="pr-8">
            <DialogTitle>{t("Проверь задачу")}</DialogTitle>
            <DialogDescription>
              {t("Задача сразу попадёт в очередь и пойдёт в фоне. Можно сразу создавать следующую.")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto pr-2">
            <dl className="grid gap-3 text-sm">
              <ConfirmRow label={t("Действие")} value={t(actionLabel(action))} />
              <ConfirmRow
                label={t("Посты")}
                value={
                  <span className="grid gap-1">
                    {postUrls.map((url) => (
                      <span key={url} className="break-all">
                        {url}
                      </span>
                    ))}
                  </span>
                }
              />
              <ConfirmRow
                label={t("Страницы")}
                value={`${selectedPages.length}: ${selectedPages.map((page) => page.displayName).join(", ")}`}
              />
              {action === "likeonly" ? null : (
                <>
                  <ConfirmRow
                    label={t("Контент")}
                    value={
                      contentMode === "ai"
                        ? t("ChatGPT · сгенерирует при выполнении")
                        : splitPerPage
                          ? t("Разный текст на каждый пост и страницу")
                          : t("Один текст для всех")
                    }
                  />
                  {splitPerPage && splitPhotoCount > 0 ? (
                    <ConfirmRow
                      label={t("Вложение")}
                      value={`${splitPhotoCount} персонал.`}
                    />
                  ) : commentPhoto ? (
                    <ConfirmRow
                      label={t("Вложение")}
                      value={`${commentPhoto.name} · ${fileSizeLabel(commentPhoto.size)}`}
                    />
                  ) : null}
                  {contentMode === "ai" ? null : (
                    <ConfirmRow
                      label={t("Сообщение")}
                      value={
                        splitPerPage
                          ? postUrls.flatMap((url, postIndex) =>
                              selectedPages.map((page) => (
                                <span key={messageKey(postIndex, page.listId)} className="block">
                                  {postUrls.length > 1 ? `Пост ${postIndex + 1} · ` : ""}
                                  {page.displayName}: {(splitMessages[messageKey(postIndex, page.listId)] ?? "").trim() || "—"}
                                </span>
                              )),
                            )
                          : message.trim()
                      }
                    />
                  )}
                </>
              )}
            </dl>
          </div>
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              disabled={enqueueing}
              onClick={() => setConfirmOpen(false)}
            >
              {t("Назад")}</Button>
            <Button type="button" disabled={enqueueing} onClick={() => void onLaunch()}>
              {enqueueing ? <Loader2 className="animate-spin" /> : <Play />}
              {t("В очередь")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      ) : null}
    </div>
  )
}

function ConfirmRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">{value}</dd>
    </div>
  )
}

function CommentPhotoPicker({
  file,
  preview,
  error,
  onSelect,
  onRemove,
}: {
  file: File | null
  preview: string
  error: string
  onSelect: (file: File | undefined) => void
  onRemove: () => void
}) {
  const t = useTranslations()

  return (
    <div className="grid gap-2 rounded-xl border border-dashed bg-muted/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("Вложение к комментарию")}</p>
          <p className="text-xs text-muted-foreground">{t(COMMENT_MEDIA_HINT)}</p>
        </div>
        <div className="flex items-center gap-2">
          {file ? (
            <Button type="button" variant="ghost" size="icon" aria-label={t("Убрать вложение")} onClick={onRemove}>
              <Trash2 />
            </Button>
          ) : null}
          <label className="inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap transition-colors hover:bg-muted">
            <Paperclip className="size-3.5" />
            {t("Прикрепить")}<input
              type="file"
              accept={COMMENT_MEDIA_ACCEPT}
              className="hidden"
              onChange={(event) => {
                onSelect(event.target.files?.[0])
                event.currentTarget.value = ""
              }}
            />
          </label>
        </div>
      </div>
      {file ? (
        <div className="flex items-center gap-3 rounded-lg border bg-background p-2">
          {preview ? (
            <CommentMediaPreview src={preview} name={file.name} mime={file.type} controls className={isCommentVideo(file.name, file.type) ? "h-32 w-48 shrink-0 rounded-md bg-black object-contain" : "size-20 rounded-md object-cover"} />
          ) : null}
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{fileSizeLabel(file.size)}</p>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{t(error)}</p> : null}
    </div>
  )
}

function ActionTablet({
  selected,
  disabled,
  title,
  description,
  onSelect,
}: {
  selected: boolean
  disabled?: boolean
  title: ReactNode
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-24 items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
        selected ? "border-primary bg-muted" : "hover:bg-muted/60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-foreground" : "border-input",
        )}
      >
        {selected ? <span className="size-2 rounded-full bg-foreground" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
