"use client"

import { useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import Image from "next/image"
import { ImagePlus, Loader2, MessageCircle, Plus, Reply, Trash2 } from "lucide-react"
import { enqueueFarmTaskForm } from "@/app/actions/farm-queue"
import type { AdsPowerProfile } from "@/lib/adspower"
import { pushAppNotification } from "@/lib/app-notifications"
import { profileDisplayGeo, profileTeamMarkerFromName } from "@/lib/profile-geo"
import type { CountryInfo } from "@/app/(app)/constructor/farm-comments"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "cn"

type GenderFilter = "ANY" | "MALE" | "FEMALE"

type TaskFan = {
  listId: string
  profileId: string
  name: string
  geo: string
  gender: GenderFilter
  teamMarker: string
  synced: boolean
}

type DraftUnit = {
  id: string
  text: string
  photo: File | null
  preview: string
  reactionCount: number
  gender: GenderFilter
  geo: string
}

type CommentDraft = DraftUnit & {
  replies: DraftUnit[]
}

const UNKNOWN_GEO = "ZZ"
const MAX_COMMENT_PHOTO_SIZE = 10 * 1024 * 1024
const MAX_POST_REACTIONS = 20

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyUnit(): DraftUnit {
  return {
    id: newId(),
    text: "",
    photo: null,
    preview: "",
    reactionCount: 0,
    gender: "ANY",
    geo: "ANY",
  }
}

function emptyComment(): CommentDraft {
  return {
    ...emptyUnit(),
    replies: [],
  }
}

function fileSizeLabel(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`
}

function pagesFromProfile(profile: AdsPowerProfile, countryCodes?: Iterable<string>): TaskFan[] {
  const geo = profileDisplayGeo(profile, countryCodes) || UNKNOWN_GEO
  const teamMarker = profileTeamMarkerFromName(profile.name)
  if (profile.fans.length > 0) {
    return profile.fans.map((fan) => ({
      listId: fan.id,
      profileId: profile.id,
      name: fan.name,
      geo,
      gender: fan.gender === "MALE" || fan.gender === "FEMALE" ? fan.gender : "ANY",
      teamMarker,
      synced: true,
    }))
  }
  return [
    {
      listId: profile.id,
      profileId: profile.id,
      name: profile.name,
      geo,
      gender: "ANY",
      teamMarker,
      synced: false,
    },
  ]
}

function matchesTarget(fan: TaskFan, gender: GenderFilter, geo: string) {
  if (gender !== "ANY" && fan.gender !== gender) return false
  if (geo !== "ANY" && fan.geo !== geo) return false
  return true
}

function pickFan(fans: TaskFan[], used: Set<string>, gender: GenderFilter, geo: string) {
  const matching = fans.filter((fan) => matchesTarget(fan, gender, geo))
  const fresh = matching.find((fan) => !used.has(fan.listId))
  if (!fresh) return null
  used.add(fresh.listId)
  return fresh
}

function normalizeFacebookUrl(value: string) {
  const raw = value.trim()
  if (!raw) return ""
  if (/^\d+$/.test(raw)) return `https://www.facebook.com/${raw}`
  if (raw.startsWith("/")) return `https://www.facebook.com${raw}`
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`
  return raw
}

function isFacebookUrl(value: string) {
  try {
    const url = new URL(normalizeFacebookUrl(value))
    return (
      /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.watch$/.test(url.hostname) ||
      /story_fbid|permalink\.php|\/posts\/|photo\.php/i.test(url.href)
    )
  } catch {
    return false
  }
}

function genderLabel(gender: GenderFilter) {
  if (gender === "MALE") return "Мужчины"
  if (gender === "FEMALE") return "Женщины"
  return "Любой"
}

function taskKey(prefix: string, id: string) {
  return `${prefix}:${id}`
}

export function TaskCreateForm({
  profiles,
  countries,
  error,
}: {
  profiles: AdsPowerProfile[]
  countries: Record<string, CountryInfo>
  error?: string
}) {
  const [taskName, setTaskName] = useState("")
  const [postUrl, setPostUrl] = useState("")
  const [globalGender, setGlobalGender] = useState<GenderFilter>("ANY")
  const [globalGeo, setGlobalGeo] = useState("ANY")
  const [postReactionCount, setPostReactionCount] = useState(0)
  const [comments, setComments] = useState<CommentDraft[]>([emptyComment()])
  const [submitting, setSubmitting] = useState(false)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const countryCodes = useMemo(() => Object.keys(countries), [countries])

  const fans = useMemo(
    () => profiles.flatMap((profile) => pagesFromProfile(profile, countryCodes)),
    [profiles, countryCodes],
  )
  const geos = useMemo(() => {
    const codes = [...new Set(fans.map((fan) => fan.geo || UNKNOWN_GEO))]
    return codes.sort((left, right) => {
      if (left === UNKNOWN_GEO) return 1
      if (right === UNKNOWN_GEO) return -1
      return (countries[left]?.name || left).localeCompare(countries[right]?.name || right, "ru")
    })
  }, [countries, fans])
  const matchingFans = useMemo(
    () => fans.filter((fan) => matchesTarget(fan, globalGender, globalGeo)),
    [fans, globalGender, globalGeo],
  )

  function updateComment(id: string, patch: Partial<CommentDraft>) {
    setComments((current) =>
      current.map((comment) => (comment.id === id ? { ...comment, ...patch } : comment)),
    )
  }

  function updateReply(commentId: string, replyId: string, patch: Partial<DraftUnit>) {
    setComments((current) =>
      current.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              replies: comment.replies.map((replyItem) =>
                replyItem.id === replyId ? { ...replyItem, ...patch } : replyItem,
              ),
            }
          : comment,
      ),
    )
  }

  function setUnitPhoto(unit: DraftUnit, file: File | undefined, apply: (patch: Partial<DraftUnit>) => void) {
    if (!file) {
      if (unit.preview) URL.revokeObjectURL(unit.preview)
      apply({ photo: null, preview: "" })
      return
    }
    if (!file.type.startsWith("image/")) {
      pushAppNotification("Фото", "Можно прикрепить только фото", { tone: "error" })
      return
    }
    if (file.size > MAX_COMMENT_PHOTO_SIZE) {
      pushAppNotification("Фото", "Фото должно быть до 10 МБ", { tone: "error" })
      return
    }
    if (unit.preview) URL.revokeObjectURL(unit.preview)
    apply({ photo: file, preview: URL.createObjectURL(file) })
  }

  function clearForm() {
    for (const comment of comments) {
      if (comment.preview) URL.revokeObjectURL(comment.preview)
      for (const replyItem of comment.replies) {
        if (replyItem.preview) URL.revokeObjectURL(replyItem.preview)
      }
    }
    setTaskName("")
    setPostUrl("")
    setGlobalGender("ANY")
    setGlobalGeo("ANY")
    setPostReactionCount(0)
    setComments([emptyComment()])
  }

  function buildJobs() {
    const url = normalizeFacebookUrl(postUrl)
    const used = new Set<string>()
    const jobs: Array<{
      action?: "comment" | "like" | "likeonly" | "subscribe"
      clientKey?: string
      replyToKey?: string
      profileId: string
      fanName?: string
      url: string
      message: string
      photoKey?: string
    }> = []
    const photos = new Map<string, File>()
    const skipped: string[] = []

    for (let index = 0; index < Math.min(postReactionCount, MAX_POST_REACTIONS); index += 1) {
      const fan = pickFan(fans, used, globalGender, globalGeo)
      if (!fan) break
      jobs.push({
        action: "likeonly",
        profileId: fan.profileId,
        fanName: fan.name,
        url,
        message: "",
      })
    }

    for (const [commentIndex, comment] of comments.entries()) {
      const commentText = comment.text.trim()
      const commentGender = comment.gender === "ANY" ? globalGender : comment.gender
      const commentGeo = comment.geo === "ANY" ? globalGeo : comment.geo
      let parentKey = ""

      if (commentText) {
        const fan = pickFan(fans, used, commentGender, commentGeo)
        if (fan) {
          parentKey = taskKey("comment", comment.id)
          jobs.push({
            action: "comment",
            clientKey: parentKey,
            profileId: fan.profileId,
            fanName: fan.name,
            url,
            message: commentText,
            photoKey: comment.photo ? parentKey : undefined,
          })
          if (comment.photo) photos.set(parentKey, comment.photo)
        } else {
          skipped.push(`Комментарий ${commentIndex + 1}`)
        }
      }

      for (let index = 0; index < comment.reactionCount; index += 1) {
        const fan = pickFan(fans, used, commentGender, commentGeo)
        if (!fan) break
        jobs.push({
          action: "likeonly",
          profileId: fan.profileId,
          fanName: fan.name,
          url,
          message: "",
        })
      }

      for (const [replyIndex, replyItem] of comment.replies.entries()) {
        const replyText = replyItem.text.trim()
        if (!replyText) continue
        if (!parentKey) {
          skipped.push(`Ответ ${replyIndex + 1} к комментарию ${commentIndex + 1}: нет текста родителя`)
          continue
        }
        const replyGender = replyItem.gender === "ANY" ? globalGender : replyItem.gender
        const replyGeo = replyItem.geo === "ANY" ? globalGeo : replyItem.geo
        const fan = pickFan(fans, used, replyGender, replyGeo)
        if (!fan) {
          skipped.push(`Ответ ${replyIndex + 1} к комментарию ${commentIndex + 1}`)
          continue
        }
        const replyKey = taskKey("reply", replyItem.id)
        jobs.push({
          action: "comment",
          clientKey: replyKey,
          replyToKey: parentKey,
          profileId: fan.profileId,
          fanName: fan.name,
          url,
          message: replyText,
          photoKey: replyItem.photo ? replyKey : undefined,
        })
        if (replyItem.photo) photos.set(replyKey, replyItem.photo)

        for (let index = 0; index < replyItem.reactionCount; index += 1) {
          const reactionFan = pickFan(fans, used, replyGender, replyGeo)
          if (!reactionFan) break
          jobs.push({
            action: "likeonly",
            profileId: reactionFan.profileId,
            fanName: reactionFan.name,
            url,
            message: "",
          })
        }
      }
    }

    return { jobs, photos, skipped }
  }

  async function submitTask() {
    const name = taskName.trim()
    const url = normalizeFacebookUrl(postUrl)
    if (!name) {
      pushAppNotification("Создание задачи", "Введи название задачи", { tone: "error" })
      return
    }
    if (!isFacebookUrl(url)) {
      pushAppNotification("Создание задачи", "Вставь корректную ссылку на пост Facebook", { tone: "error" })
      return
    }

    const { jobs, photos, skipped } = buildJobs()
    if (jobs.length === 0) {
      pushAppNotification("Создание задачи", "Нет действий для запуска", { tone: "error" })
      return
    }
    if (skipped.length > 0) {
      pushAppNotification("Создание задачи", `Не хватает фанок: ${skipped.slice(0, 3).join(", ")}`, { tone: "error" })
      return
    }

    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.set("payload", JSON.stringify({ name, action: "mixed", jobs }))
      for (const [key, file] of photos.entries()) {
        formData.set(`photo:${key}`, file)
      }
      const result = await enqueueFarmTaskForm(formData)
      if (result.error) {
        pushAppNotification("Создание задачи", result.error, { href: "/tasks/list?tab=work", tone: "error" })
        return
      }
      pushAppNotification(
        "Создание задачи",
        `${name} · ${result.total || jobs.length} действий в очереди${result.rewritten ? ` · AI перефразировал: ${result.rewritten}` : ""}`,
        { href: "/tasks/list?tab=work", tone: "queue" },
      )
      clearForm()
      void fetch("/api/farm-queue", { method: "POST" })
    } finally {
      setSubmitting(false)
    }
  }

  const totalDraftActions = useMemo(() => {
    const textJobs = comments.reduce(
      (sum, comment) =>
        sum +
        (comment.text.trim() ? 1 : 0) +
        comment.replies.filter((replyItem) => replyItem.text.trim()).length,
      0,
    )
    const reactions =
      postReactionCount +
      comments.reduce(
        (sum, comment) =>
          sum + comment.reactionCount + comment.replies.reduce((replySum, replyItem) => replySum + replyItem.reactionCount, 0),
        0,
      )
    return textJobs + reactions
  }, [comments, postReactionCount])

  return (
    <div className="grid gap-4">
      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="font-heading text-base font-medium">Создать новую задачу</h2>
            <p className="text-sm text-muted-foreground">Один пост, таргетинг фанок, комментарии, ответы и реакции.</p>
          </div>
          <Badge variant="secondary">{totalDraftActions} действий</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Название задачи</span>
            <Input value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="Название задачи..." />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Ссылка на пост Facebook</span>
            <Input
              value={postUrl}
              onChange={(event) => setPostUrl(event.target.value)}
              placeholder="https://www.facebook.com/..."
            />
          </label>
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-medium">Таргетинг комментаторов</h2>
          <Badge variant="outline">{matchingFans.length} фанок</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField label="Пол" value={globalGender} onChange={(value) => setGlobalGender(value as GenderFilter)}>
            <option value="ANY">Любой</option>
            <option value="MALE">Мужчины</option>
            <option value="FEMALE">Женщины</option>
          </SelectField>
          <SelectField label="Гео" value={globalGeo} onChange={setGlobalGeo}>
            <option value="ANY">Любое</option>
            {geos.map((geo) => (
              <option key={geo} value={geo}>
                {countries[geo]?.name || geo}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Пул</span>
            <div className="flex h-10 items-center rounded-lg border px-3 text-sm text-muted-foreground">
              {globalGender === "ANY" ? "Любой пол" : genderLabel(globalGender)} · {globalGeo === "ANY" ? "Любое гео" : globalGeo}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <h2 className="font-heading text-base font-medium">Настройки вовлечения поста</h2>
        <RangeField
          label="Реакции на пост"
          value={postReactionCount}
          min={0}
          max={MAX_POST_REACTIONS}
          onChange={(value) => setPostReactionCount(Math.min(value, MAX_POST_REACTIONS))}
        />
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-base font-medium">Комментарии</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => setComments((current) => [...current, emptyComment()])}>
            <Plus />
            Добавить комментарий
          </Button>
        </div>

        <div className="grid gap-3">
          {comments.map((comment, index) => (
            <CommentEditor
              key={comment.id}
              title={`Комментарий ${index + 1}`}
              unit={comment}
              countries={countries}
              geos={geos}
              onChange={(patch) => updateComment(comment.id, patch as Partial<CommentDraft>)}
              onDelete={comments.length > 1 ? () => setComments((current) => current.filter((item) => item.id !== comment.id)) : undefined}
              onPhoto={(file) => setUnitPhoto(comment, file, (patch) => updateComment(comment.id, patch as Partial<CommentDraft>))}
              fileInput={(node) => {
                fileInputs.current[comment.id] = node
              }}
              onPickFile={() => fileInputs.current[comment.id]?.click()}
            >
              <div className="grid gap-3 border-l-2 border-primary/50 pl-4">
                {comment.replies.map((replyItem, replyIndex) => (
                  <CommentEditor
                    key={replyItem.id}
                    title={`Ответ ${replyIndex + 1}`}
                    reply
                    unit={replyItem}
                    countries={countries}
                    geos={geos}
                    onChange={(patch) => updateReply(comment.id, replyItem.id, patch)}
                    onDelete={() =>
                      setComments((current) =>
                        current.map((item) =>
                          item.id === comment.id
                            ? { ...item, replies: item.replies.filter((reply) => reply.id !== replyItem.id) }
                            : item,
                        ),
                      )
                    }
                    onPhoto={(file) => setUnitPhoto(replyItem, file, (patch) => updateReply(comment.id, replyItem.id, patch))}
                    fileInput={(node) => {
                      fileInputs.current[replyItem.id] = node
                    }}
                    onPickFile={() => fileInputs.current[replyItem.id]?.click()}
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={() =>
                    setComments((current) =>
                      current.map((item) =>
                        item.id === comment.id ? { ...item, replies: [...item.replies, emptyUnit()] } : item,
                      ),
                    )
                  }
                >
                  <Reply />
                  Добавить ответ к комментарию
                </Button>
              </div>
            </CommentEditor>
          ))}
        </div>

        <Button type="button" size="lg" disabled={submitting} onClick={() => void submitTask()}>
          {submitting ? <Loader2 className="animate-spin" /> : <MessageCircle />}
          Создать задачу
        </Button>
      </section>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {children}
      </select>
    </label>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="grid gap-2 sm:grid-cols-[1fr_5rem] sm:items-center">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full accent-primary"
        />
        <Input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {min} - {max}, сейчас {value}
      </span>
    </label>
  )
}

function CommentEditor({
  title,
  reply,
  unit,
  countries,
  geos,
  children,
  onChange,
  onDelete,
  onPhoto,
  fileInput,
  onPickFile,
}: {
  title: string
  reply?: boolean
  unit: DraftUnit
  countries: Record<string, CountryInfo>
  geos: string[]
  children?: ReactNode
  onChange: (patch: Partial<DraftUnit>) => void
  onDelete?: () => void
  onPhoto: (file: File | undefined) => void
  fileInput: (node: HTMLInputElement | null) => void
  onPickFile: () => void
}) {
  return (
    <div className={cn("grid gap-4 rounded-2xl border p-3 md:p-4", reply ? "bg-muted/30" : "bg-background")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-base font-medium">{title}</h3>
        {onDelete ? (
          <Button type="button" variant="outline" size="sm" onClick={onDelete}>
            <Trash2 />
            Удалить
          </Button>
        ) : null}
      </div>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">Текст комментария</span>
        <Textarea value={unit.text} onChange={(event) => onChange({ text: event.target.value })} rows={5} />
      </label>
      <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="grid gap-2">
          <span className="text-sm font-medium">Картинка</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => onPhoto(event.target.files?.[0])}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={onPickFile}>
              <ImagePlus />
              Загрузить
            </Button>
            {unit.photo ? (
              <span className="text-xs text-muted-foreground">
                {unit.photo.name} · {fileSizeLabel(unit.photo.size)}
              </span>
            ) : null}
            {unit.photo ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onPhoto(undefined)}>
                <Trash2 />
                Убрать
              </Button>
            ) : null}
          </div>
          {unit.preview ? (
            <Image
              src={unit.preview}
              alt=""
              width={96}
              height={96}
              className="size-24 rounded-lg object-cover"
              unoptimized
            />
          ) : null}
        </div>
        <RangeField label="Реакции на пост" value={unit.reactionCount} min={0} max={50} onChange={(value) => onChange({ reactionCount: value })} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField label="Пол" value={unit.gender} onChange={(value) => onChange({ gender: value as GenderFilter })}>
          <option value="ANY">Любой</option>
          <option value="MALE">Мужчины</option>
          <option value="FEMALE">Женщины</option>
        </SelectField>
        <SelectField label="Гео" value={unit.geo} onChange={(value) => onChange({ geo: value })}>
          <option value="ANY">Любое</option>
          {geos.map((geo) => (
            <option key={geo} value={geo}>
              {countries[geo]?.name || geo}
            </option>
          ))}
        </SelectField>
      </div>
      {children}
    </div>
  )
}
