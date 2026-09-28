"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { CheckCheck, Heart, Loader2, Paperclip, Play, Plus, RefreshCw, Sparkles, Trash2, UserPlus, X } from "lucide-react"
import { enqueueFarmTaskForm } from "@/app/actions/farm-queue"
import type { AdsPowerProfile } from "@/lib/adspower"
import { pushAppNotification } from "@/lib/app-notifications"
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

export type CountryInfo = {
  name: string
  flagSvg: string
}

type FarmPage = AdsPowerProfile & {
  listId: string
  displayName: string
  browserId: string
  synced: boolean
}

type FarmAction = "comment" | "like" | "likeonly" | "subscribe"
type ContentMode = "same" | "split" | "ai"

const UNKNOWN_GEO = "ZZ"
const MAX_COMMENT_PHOTO_SIZE = 10 * 1024 * 1024
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

function groupKey(profile: AdsPowerProfile) {
  return profile.groupName.trim() || profile.name.trim() || profile.id
}

function messageKey(postIndex: number, listId: string) {
  return `${postIndex}:${listId}`
}

function pagesFromProfile(profile: AdsPowerProfile): FarmPage[] {
  if (profile.fans.length > 0) {
    return profile.fans.map((fan) => ({
      ...profile,
      listId: fan.id,
      displayName: fan.name,
      browserId: profile.id,
      synced: true,
    }))
  }
  return [
    {
      ...profile,
      listId: profile.id,
      displayName: profile.name,
      browserId: profile.id,
      synced: false,
    },
  ]
}

const ACTION_OPTIONS: {
  id: FarmAction
  title: ReactNode
  description: string
}[] = [
  {
    id: "comment",
    title: "Комментарий",
    description: "Комментарий от фанки через браузер, как от страницы.",
  },
  {
    id: "likeonly",
    title: (
      <span className="inline-flex items-center gap-1.5">
        <Heart className="size-4 fill-current" />
        Просто лайк
      </span>
    ),
    description: "Фанка ставит Like или Love, комментарий не пишем.",
  },
  {
    id: "like",
    title: (
      <span className="inline-flex items-center gap-1.5">
        <Heart className="size-4 fill-current" />
        Лайк вместе с комментарием
      </span>
    ),
    description: "Комментарий, затем наводим на лайк и ставим Like или Love.",
  },
  {
    id: "subscribe",
    title: (
      <span className="inline-flex items-center gap-1.5">
        <UserPlus className="size-4" />
        Подписка + лайк + комментарий
      </span>
    ),
    description:
      "Комментарий, лайк и подписка на автора: Follow на карточке или в профиле. Если Follow не выйдет — комментарий и лайк всё равно уйдут.",
  },
]

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
  onEvent: (event: { type: string; level?: "info" | "ok" | "error"; text?: string; ok?: boolean; message?: string }) => void,
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
      })
    }
  }
}

export function FarmComments({
  profiles,
  countries = {},
  canSyncFans,
}: {
  profiles: AdsPowerProfile[]
  countries: Record<string, CountryInfo>
  canSyncFans: boolean
}) {
  const router = useRouter()
  const [posts, setPosts] = useState<string[]>([""])
  const [action, setAction] = useState<FarmAction>("comment")
  const [contentMode, setContentMode] = useState<ContentMode>("same")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [message, setMessage] = useState("")
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
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [syncPending, setSyncPending] = useState(false)
  const [enqueueing, setEnqueueing] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

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
    const codes = [...new Set(activeProfiles.map((profile) => profile.ipCountry || UNKNOWN_GEO))]
    return codes.sort((left, right) => {
      if (left === UNKNOWN_GEO) return 1
      if (right === UNKNOWN_GEO) return -1
      return (countries[left]?.name || left).localeCompare(countries[right]?.name || right, "ru")
    })
  }, [activeProfiles, countries])

  const pageList = useMemo(() => {
    const needle = pageQuery.trim().toLowerCase()
    return activeProfiles
      .flatMap(pagesFromProfile)
      .filter((page) => {
        if (geoFilter && (page.ipCountry || UNKNOWN_GEO) !== geoFilter) return false
        if (!needle) return true
        return [page.displayName, page.name, page.serial, page.username, page.ipCountry, page.id]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ru"))
  }, [activeProfiles, geoFilter, pageQuery])

  const visibleIds = pageList.map((page) => page.listId)
  const selectedPages = pageList.filter((page) => selectedIds.includes(page.listId))
  const postUrls = posts.map((value) => value.trim()).filter(Boolean)
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
    if (!file.type.startsWith("image/")) {
      return { file: null, error: "Можно прикрепить только фото" }
    }
    if (file.size > MAX_COMMENT_PHOTO_SIZE) {
      return { file: null, error: "Фото должно быть до 10 МБ" }
    }
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
      formData.set("payload", JSON.stringify(payload))
      if (splitPerPage) {
        for (const [key, file] of Object.entries(splitPhotos)) {
          formData.set(`photo:${key}`, file)
        }
      } else if (commentPhoto) {
        formData.set("photo", commentPhoto)
      }
      const result = await enqueueFarmTaskForm(formData)
      if (result.error) {
        pushAppNotification("Очередь", result.error, {
          href: "/queue?tab=work",
          tone: "error",
        })
        return
      }
      setConfirmOpen(false)
      clearForm()
      pushAppNotification(
        "Задача в очереди",
        `${actionLabel(action)} · ${result.total || jobs.length} шт. Можно создавать следующую.`,
        { href: "/queue?tab=work", tone: "queue" },
      )
      void fetch("/api/farm-queue", { method: "POST" })
    } catch (error) {
      pushAppNotification(
        "Очередь",
        error instanceof Error ? error.message : "Не удалось поставить в очередь",
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
      "Синхронизация фанок",
      `Запущена · ${ids.length} профил.`,
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
        failCount === 0 ? "Синхронизация фанок" : "Синхронизация фанок · ошибка",
        failCount === 0
          ? `Готово · ${okCount} профил.`
          : `${okCount} ок, ${failCount} с ошибкой`,
        { tone: failCount === 0 ? "success" : "error" },
      )
      setSyncPending(false)
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

  return (
    <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)]">
      <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="grid gap-1">
          <h2 className="font-heading text-base font-medium">Пост и действия</h2>
          <p className="text-sm text-muted-foreground">
            Вставь ссылку на пост и выбери комментарий или лайк.
          </p>
        </div>

        <div className="mt-5 grid gap-2">
          <p className="text-sm font-medium">Ссылки на посты (или числовые id)</p>
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
                placeholder="Ссылка на пост Facebook или числовой id"
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
            Добавить ещё пост
          </Button>
        </div>

        <div className="mt-6 grid gap-2">
          <p className="text-sm font-medium">Действия</p>
          <div role="radiogroup" aria-label="Действие" className="grid gap-2">
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
              Для простого лайка текст не нужен — фанка только поставит реакцию на пост.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">Текст комментария</p>
          <div className="grid h-9 grid-cols-3 items-center gap-1 rounded-full bg-muted p-1">
            {(
              [
                { id: "same", label: "Один текст" },
                { id: "split", label: "Разные" },
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
                Выбери страницы справа — появится поле на каждую.
              </p>
            ) : (
              <div className="grid gap-3">
                {postUrls.map((url, postIndex) => (
                  <div key={`${postIndex}-${url}`} className="grid gap-2">
                    {postUrls.length > 1 ? (
                      <p className="truncate text-xs font-medium text-muted-foreground">
                        Пост {postIndex + 1}: {url}
                      </p>
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
                              placeholder="Текст комментария"
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
              <span className="text-sm font-medium">Сообщение</span>
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Текст комментария"
                rows={4}
              />
            </label>
          )}
          {!splitPerPage ? (
            <div className="grid gap-2 rounded-xl border border-dashed bg-muted/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Фото к комментарию</p>
                  <p className="text-xs text-muted-foreground">1 фото, максимум 10 МБ</p>
                </div>
                <div className="flex items-center gap-2">
                  {commentPhoto ? (
                    <Button type="button" variant="ghost" size="icon" aria-label="Убрать фото" onClick={removePhoto}>
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
                    Прикрепить
                  </Button>
                </div>
              </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => onPhotoSelected(event.target.files?.[0])}
            />
            {commentPhoto ? (
              <div className="flex items-center gap-3 rounded-lg border bg-background p-2">
                {commentPhotoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={commentPhotoPreview}
                    alt=""
                    className="size-12 rounded-md object-cover"
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
          {`Создать задачу (${selectedPages.length * postUrls.length})`}
        </Button>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading shrink-0 text-sm font-medium">
            Страницы ({selectedIds.length} выбрано)
          </h2>
          <div className="flex shrink-0 items-center gap-0.5">
            {canSyncFans ? (
              <PagesIconButton
                label="Синхронизировать фанки"
                disabled={syncPending || activeProfiles.length === 0}
                onClick={() => void onSyncFans()}
              >
                {syncPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </PagesIconButton>
            ) : null}
            <PagesIconButton
              label="Выбрать видимые"
              disabled={visibleIds.length === 0}
              onClick={() =>
                setSelectedIds((current) => [...new Set([...current, ...visibleIds])])
              }
            >
              <CheckCheck className="size-4" />
            </PagesIconButton>
            <PagesIconButton
              label="Сбросить"
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
            placeholder="Поиск профиля..."
            aria-label="Поиск профиля"
          />
          {visibleGroups.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Профилей нет
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {visibleGroups.map((group) => {
                const groupPages = group.items.flatMap(pagesFromProfile)
                const selectedCount = groupPages.filter((page) =>
                  selectedIds.includes(page.listId),
                ).length
                const fanCount = group.items.reduce(
                  (count, item) => count + Math.max(item.fans.length, 1),
                  0,
                )
                const active = activeGroups.includes(group.key)
                const groupGeos = [
                  ...new Set(group.items.map((item) => item.ipCountry).filter(Boolean)),
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
            placeholder="Поиск страниц или гео..."
            aria-label="Поиск страниц или гео"
            disabled={activeGroups.length === 0}
          />

          {activeGroups.length === 0 ? (
            <div className="grid gap-6 py-8 text-center text-sm text-muted-foreground">
              <p>
                Сначала выбери профиль выше — тогда появится фильтр гео и список фанок.
              </p>
              <p>Выбери профиль выше.</p>
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
                  Все гео
                </Button>
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

              {pageList.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Никого не нашли</p>
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
                            aria-label={`Выбрать ${page.displayName}`}
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
                            {page.synced ? null : (
                              <span className="block text-xs text-muted-foreground">
                                Имя AdsPower
                              </span>
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

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (enqueueing) return
          setConfirmOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton={!enqueueing}>
          <DialogHeader>
            <DialogTitle>Проверь задачу</DialogTitle>
            <DialogDescription>
              Задача сразу попадёт в очередь и пойдёт в фоне. Можно сразу создавать следующую.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-3 text-sm">
            <ConfirmRow label="Действие" value={actionLabel(action)} />
            <ConfirmRow
              label="Посты"
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
              label="Страницы"
              value={`${selectedPages.length}: ${selectedPages.map((page) => page.displayName).join(", ")}`}
            />
            {action === "likeonly" ? null : (
              <>
            <ConfirmRow
              label="Контент"
              value={
                contentMode === "ai"
                  ? "ChatGPT · сгенерирует при выполнении"
                  : splitPerPage
                    ? "Разный текст на каждый пост и страницу"
                    : "Один текст для всех"
              }
            />
            {splitPerPage && splitPhotoCount > 0 ? (
              <ConfirmRow
                label="Фото"
                value={`${splitPhotoCount} персонал.`}
              />
            ) : commentPhoto ? (
              <ConfirmRow
                label="Фото"
                value={`${commentPhoto.name} · ${fileSizeLabel(commentPhoto.size)}`}
              />
            ) : null}
            {contentMode === "ai" ? null : (
              <ConfirmRow
                label="Сообщение"
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={enqueueing}
              onClick={() => setConfirmOpen(false)}
            >
              Назад
            </Button>
            <Button type="button" disabled={enqueueing} onClick={() => void onLaunch()}>
              {enqueueing ? <Loader2 className="animate-spin" /> : <Play />}
              В очередь
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  return (
    <div className="grid gap-2 rounded-xl border border-dashed bg-muted/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Фото к комментарию</p>
          <p className="text-xs text-muted-foreground">1 фото, максимум 10 МБ</p>
        </div>
        <div className="flex items-center gap-2">
          {file ? (
            <Button type="button" variant="ghost" size="icon" aria-label="Убрать фото" onClick={onRemove}>
              <Trash2 />
            </Button>
          ) : null}
          <label className="inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap transition-colors hover:bg-muted">
            <Paperclip className="size-3.5" />
            Прикрепить
            <input
              type="file"
              accept="image/*"
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
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-12 rounded-md object-cover" />
          ) : null}
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{fileSizeLabel(file.size)}</p>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
