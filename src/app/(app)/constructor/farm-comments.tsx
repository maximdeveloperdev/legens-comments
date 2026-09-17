"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { CheckCheck, Heart, Loader2, Play, Plus, RefreshCw, Sparkles, UserPlus, X } from "lucide-react"
import { generateAiComments } from "@/app/actions/ai-comments"
import { enqueueFarmTask } from "@/app/actions/farm-queue"
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
type PostKind = "text" | "image" | "image_text" | "unknown"

type LiveLog = {
  id: string
  time: string
  level: "info" | "ok" | "error"
  text: string
}

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

function logTime() {
  return new Date().toLocaleTimeString("ru-RU", { hour12: false })
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
  onEvent: (event: { type: string; level?: LiveLog["level"]; text?: string; ok?: boolean; message?: string }) => void,
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
        level?: LiveLog["level"]
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
}: {
  profiles: AdsPowerProfile[]
  countries: Record<string, CountryInfo>
}) {
  const router = useRouter()
  const [posts, setPosts] = useState<string[]>([""])
  const [action, setAction] = useState<FarmAction>("comment")
  const [contentMode, setContentMode] = useState<ContentMode>("same")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [splitMessages, setSplitMessages] = useState<Record<string, string>>({})
  const [aiSummary, setAiSummary] = useState("")
  const [aiKind, setAiKind] = useState<PostKind | "">("")
  const [aiVia, setAiVia] = useState<"browser" | "preview" | "">("")
  const [aiError, setAiError] = useState("")
  const [aiPending, setAiPending] = useState(false)
  const [profileQuery, setProfileQuery] = useState("")
  const [pageQuery, setPageQuery] = useState("")
  const [activeGroups, setActiveGroups] = useState<string[]>([])
  const [geoFilter, setGeoFilter] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [syncPending, setSyncPending] = useState(false)
  const [enqueueing, setEnqueueing] = useState(false)
  const [liveLogs, setLiveLogs] = useState<LiveLog[]>([])
  const liveLogRef = useRef<HTMLOListElement>(null)
  const aiLock = useRef(false)

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
  const activeProfileId = activeProfiles[0]?.id
  const postUrlsKey = postUrls.join("\n")
  const selectedPagesKey = selectedPages
    .map((page) => `${page.listId}:${page.displayName}`)
    .join("|")
  const splitPerPage =
    contentMode === "split" || (contentMode === "ai" && selectedPages.length > 1)

  useEffect(() => {
    liveLogRef.current?.scrollTo({ top: liveLogRef.current.scrollHeight })
  }, [liveLogs])

  function appendLiveLog(level: LiveLog["level"], text: string) {
    setLiveLogs((current) => [
      ...current,
      { id: `${Date.now()}-${current.length}`, time: logTime(), level, text },
    ])
  }

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
    setSelectedIds([])
    setAiSummary("")
    setAiKind("")
    setAiVia("")
    setAiError("")
  }

  async function onGenerateAi() {
    if (aiLock.current || postUrls.length === 0) return
    aiLock.current = true
    setAiError("")
    setAiPending(true)
    try {
      const authors = selectedPages.map((page) => ({
        name: page.displayName,
        country: page.ipCountry || undefined,
      }))
      const result = await generateAiComments({
        urls: postUrls,
        authors,
        profileId: selectedPages[0]?.browserId || activeProfileId,
      })
      if (result.error || !result.comments?.length) {
        setAiError(result.error || "ChatGPT не вернул комментарии")
        return
      }
      setAiSummary(result.postSummary || "")
      setAiKind(result.postKind || "")
      setAiVia(result.via || "")
      if (selectedPages.length > 0) {
        const next: Record<string, string> = {}
        postUrls.forEach((_, postIndex) => {
          selectedPages.forEach((page, pageIndex) => {
            const index = postIndex * selectedPages.length + pageIndex
            next[messageKey(postIndex, page.listId)] =
              result.comments?.[index] || result.comments?.[pageIndex] || result.comments?.[0] || ""
          })
        })
        setSplitMessages((current) => ({ ...current, ...next }))
      } else {
        setMessage(result.comments[0] || "")
      }
      pushAppNotification(
        "ChatGPT",
        `Готово · ${result.comments.length} комментар.`,
        { tone: "success" },
      )
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "ChatGPT не ответил")
    } finally {
      aiLock.current = false
      setAiPending(false)
    }
  }

  useEffect(() => {
    if (contentMode !== "ai" || action === "likeonly") return
    if (postUrls.length === 0) return
    const timer = window.setTimeout(() => {
      void onGenerateAi()
    }, 700)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generate from the latest form state after debounce
  }, [
    contentMode,
    action,
    postUrlsKey,
    selectedPagesKey,
    activeProfileId,
  ])

  async function onLaunch() {
    const jobs = selectedPages.flatMap((page) =>
      postUrls.map((url, postIndex) => ({
        profileId: page.browserId,
        fanName: page.displayName,
        url,
        message: messageFor(page.listId, postIndex),
      })),
    )

    if (jobs.length === 0) return

    setEnqueueing(true)
    try {
      const result = await enqueueFarmTask({
        action,
        jobs,
      })
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
    setLiveLogs([
      {
        id: "start",
        time: logTime(),
        level: "info",
        text: `Синхронизация фанок · ${ids.length} профил.`,
      },
    ])
    pushAppNotification(
      "Синхронизация фанок",
      `Запущена · ${ids.length} профил.`,
      { tone: "queue" },
    )

    let okCount = 0
    let failCount = 0
    try {
      for (const profileId of ids) {
        const profile = activeProfiles.find((item) => item.id === profileId)
        appendLiveLog("info", `Читаем меню «${profile?.name || profileId}»`)
        const response = await fetch("/api/sync-fans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId }),
        })
        let profileOk = false
        await readSwitchEvents(response, (event) => {
          if (event.type === "log" && event.text) {
            appendLiveLog(event.level || "info", event.text)
          }
          if (event.type === "done") {
            profileOk = event.ok === true
            if (event.message) {
              appendLiveLog(event.ok ? "ok" : "error", event.message)
            }
          }
        })
        if (profileOk) okCount += 1
        else failCount += 1
      }
    } catch (error) {
      failCount += 1
      appendLiveLog("error", error instanceof Error ? error.message : "Синхронизация не запустилась")
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
    !aiPending &&
    selectedPages.length > 0 &&
    postUrls.length > 0 &&
    (!needsMessage ||
      (splitPerPage
        ? postUrls.every((_, postIndex) =>
            selectedPages.every((page) => (splitMessages[messageKey(postIndex, page.listId)] ?? "").trim()),
          )
        : message.trim().length > 0))

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
                { id: "split", label: "Разный" },
                { id: "ai", label: "ChatGPT" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={aiPending}
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

          {contentMode === "ai" ? (
            <div className="grid gap-3">
            <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Заходим на пост, смотрим текст и картинки (в том числе надписи на фото) и пишем
                комментарий от каждой выбранной фанки: имя, пол, не только хвала — ещё вопросы по теме.
              </p>
              {aiKind ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {aiKind === "image_text"
                      ? "Картинка и текст"
                      : aiKind === "image"
                        ? "Картинка"
                        : aiKind === "text"
                          ? "Только текст"
                          : "Не разобрали"}
                  </Badge>
                  {aiVia ? (
                    <Badge variant="secondary">
                      {aiVia === "browser" ? "Зашли на пост" : "Превью (очередь занята)"}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
              {aiSummary ? (
                <p className="text-xs text-muted-foreground">Пост: {aiSummary}</p>
              ) : null}
              {aiError ? <p className="text-sm text-destructive">{aiError}</p> : null}
              <Button
                type="button"
                variant="outline"
                disabled={aiPending || postUrls.length === 0}
                onClick={() => void onGenerateAi()}
              >
                {aiPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {aiPending
                  ? "Заходим на пост…"
                  : postUrls.length === 0
                    ? "Сначала вставь ссылку"
                    : "Сгенерировать ещё раз"}
              </Button>
            </div>
            {splitPerPage ? (
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
                    {selectedPages.map((page) => (
                      <label key={messageKey(postIndex, page.listId)} className="grid gap-1.5">
                        <span className="text-sm font-medium">{page.displayName}</span>
                        <Textarea
                          value={splitMessages[messageKey(postIndex, page.listId)] ?? ""}
                          onChange={(event) =>
                            setSplitMessages((current) => ({
                              ...current,
                              [messageKey(postIndex, page.listId)]: event.target.value,
                            }))
                          }
                          placeholder={aiPending ? "Пишем комментарий…" : "Текст комментария"}
                          rows={3}
                        />
                      </label>
                    ))}
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
                placeholder={aiPending ? "Пишем комментарий…" : "Комментарий появится здесь"}
                rows={4}
              />
            </label>
            )}
            </div>
          ) : splitPerPage ? (
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
                    {selectedPages.map((page) => (
                      <label key={messageKey(postIndex, page.listId)} className="grid gap-1.5">
                        <span className="text-sm font-medium">{page.displayName}</span>
                        <Textarea
                          value={splitMessages[messageKey(postIndex, page.listId)] ?? ""}
                          onChange={(event) =>
                            setSplitMessages((current) => ({
                              ...current,
                              [messageKey(postIndex, page.listId)]: event.target.value,
                            }))
                          }
                          placeholder="Текст комментария"
                          rows={3}
                        />
                      </label>
                    ))}
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
                placeholder="Привет! 🔥"
                rows={4}
              />
            </label>
          )}
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
            <PagesIconButton
              label="Синхронизировать фанки"
              disabled={syncPending || activeProfiles.length === 0}
              onClick={() => void onSyncFans()}
            >
              {syncPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </PagesIconButton>
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
                                Имя AdsPower · синхронизируй фанки
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
              {liveLogs.length > 0 ? (
                <ol
                  className="max-h-40 overflow-y-auto rounded-xl border bg-muted/40 p-3 font-mono text-xs leading-5"
                  ref={liveLogRef}
                >
                  {liveLogs.map((log) => (
                    <li
                      key={`page-${log.id}`}
                      className={
                        log.level === "error"
                          ? "text-destructive"
                          : log.level === "ok"
                            ? "text-emerald-700 dark:text-emerald-300"
                            : "text-muted-foreground"
                      }
                    >
                      <span className="text-muted-foreground">{log.time}</span> {log.text}
                    </li>
                  ))}
                </ol>
              ) : null}
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
                  ? splitPerPage
                    ? "ChatGPT · разный текст на каждый пост и страницу"
                    : "ChatGPT · один текст"
                  : splitPerPage
                    ? "Разный текст на каждый пост и страницу"
                    : "Один текст для всех"
              }
            />
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
