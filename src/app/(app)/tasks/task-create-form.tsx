"use client"

import { useTranslations, useLocalizedCountries } from "@/components/language-provider"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Paperclip, Loader2, MessageCircle, Plus, Reply, Trash2 } from "lucide-react"
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
import { GeoMultiSelect, RangeField, SelectField } from "@/components/task-targeting-fields"
import { CommentMediaPreview } from "@/components/comment-media-preview"
import { COMMENT_MEDIA_ACCEPT, COMMENT_MEDIA_HINT, MAX_COMMENT_MEDIA_TOTAL_SIZE, commentMediaError, isCommentVideo } from "@/lib/comment-media"
import { CommentSetPicker } from "@/components/comment-set-picker"
import type { CommentSetDraft } from "@/lib/comment-set"

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
  aiComment: boolean
  photo: File | null
  preview: string
  reactionCount: number
  gender: GenderFilter
  geos: string[]
}

type CommentDraft = DraftUnit & {
  replies: DraftUnit[]
}

type GenerateMode = "text" | "library"

const UNKNOWN_GEO = "ZZ"
const MAX_POST_REACTIONS = 20
const MAX_COMMENT_REACTIONS = 20

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyUnit(): DraftUnit {
  return {
    id: newId(),
    text: "",
    aiComment: false,
    photo: null,
    preview: "",
    reactionCount: 0,
    gender: "ANY",
    geos: [],
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

function matchesTarget(fan: TaskFan, gender: GenderFilter, geos: string[]) {
  if (gender !== "ANY" && fan.gender !== gender) return false
  if (geos.length > 0 && !geos.includes(fan.geo)) return false
  return true
}

function pickFan(fans: TaskFan[], used: Set<string>, gender: GenderFilter, geos: string[]) {
  const matching = fans.filter((fan) => matchesTarget(fan, gender, geos))
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

function taskKey(prefix: string, id: string) {
  return `${prefix}:${id}`
}

function commentsFromBulkText(value: string) {
  const generated: CommentDraft[] = []
  let currentComment: CommentDraft | null = null

  for (const rawLine of value.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    const isReply = /^\t| {4}/.test(rawLine)
    const text = rawLine.trim()

    if (isReply && currentComment) {
      currentComment.replies.push({
        ...emptyUnit(),
        text,
      })
      continue
    }

    currentComment = {
      ...emptyComment(),
      text,
    }
    generated.push(currentComment)
  }

  return generated
}

export function TaskCreateForm({
  profiles,
  countries: sourceCountries,
  error,
}: {
  profiles: AdsPowerProfile[]
  countries: Record<string, CountryInfo>
  error?: string
}) {
  const t = useTranslations()
  const countries = useLocalizedCountries(sourceCountries)

  const [taskName, setTaskName] = useState("")
  const [postUrl, setPostUrl] = useState("")
  const [globalGender, setGlobalGender] = useState<GenderFilter>("ANY")
  const [globalGeos, setGlobalGeos] = useState<string[]>([])
  const [postReactionCount, setPostReactionCount] = useState(0)
  const [comments, setComments] = useState<CommentDraft[]>([emptyComment()])
  const [generateMode, setGenerateMode] = useState<GenerateMode>("text")
  const [bulkCommentsText, setBulkCommentsText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const attachmentPreviews = useRef(new Set<string>())
  useEffect(() => {
    const previews = attachmentPreviews.current
    return () => { for (const url of previews) URL.revokeObjectURL(url) }
  }, [])
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
    () => fans.filter((fan) => matchesTarget(fan, globalGender, globalGeos)),
    [fans, globalGender, globalGeos],
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
    const error = commentMediaError(file)
    if (error) {
      pushAppNotification(t("Вложение"), error, { tone: "error" })
      return
    }
    if (unit.preview) URL.revokeObjectURL(unit.preview)
    const preview = URL.createObjectURL(file)
    attachmentPreviews.current.add(preview)
    apply({ photo: file, preview })
  }

  function clearForm() {
    revokeCommentPreviews(comments)
    setTaskName("")
    setPostUrl("")
    setGlobalGender("ANY")
    setGlobalGeos([])
    setPostReactionCount(0)
    setBulkCommentsText("")
    setGenerateMode("text")
    setComments([emptyComment()])
  }

  function revokeCommentPreviews(items: CommentDraft[]) {
    for (const comment of items) {
      if (comment.preview) URL.revokeObjectURL(comment.preview)
      for (const replyItem of comment.replies) {
        if (replyItem.preview) URL.revokeObjectURL(replyItem.preview)
      }
    }
  }

  function generateCommentsFromText() {
    const generated = commentsFromBulkText(bulkCommentsText)
    if (generated.length === 0) {
      pushAppNotification(t("Комментарии"), t("Вставь текст комментариев"), { tone: "error" })
      return
    }
    revokeCommentPreviews(comments)
    setComments(generated)
    pushAppNotification(t("Комментарии"), t("Сгенерировано: {0} комментариев", generated.length), { tone: "success" })
  }

  function getCommentSet(): CommentSetDraft {
    return {
      gender: globalGender, geos: globalGeos, postLikes: postReactionCount,
      comments: comments.flatMap((comment) => [
        { id: comment.id, parentId: null, text: comment.text, aiComment: comment.aiComment, likes: comment.reactionCount, gender: comment.gender, geos: comment.geos },
        ...comment.replies.map((reply) => ({ id: reply.id, parentId: comment.id, text: reply.text, aiComment: reply.aiComment, likes: reply.reactionCount, gender: reply.gender, geos: reply.geos })),
      ]),
    }
  }

  function applyCommentSet(draft: CommentSetDraft) {
    const roots = new Set(draft.comments.filter((unit) => !unit.parentId).map((unit) => unit.id))
    if (draft.comments.some((unit) => unit.parentId && !roots.has(unit.parentId))) {
      pushAppNotification(t("Наборы"), t("Набор с вложенными ответами можно применить в окне копирования задачи"), { tone: "error" })
      return false
    }
    const toUnit = (unit: CommentSetDraft["comments"][number]): DraftUnit => ({
      ...emptyUnit(), id: unit.id, text: unit.text, aiComment: unit.aiComment,
      reactionCount: unit.likes, gender: unit.gender, geos: unit.geos,
    })
    revokeCommentPreviews(comments)
    setComments(draft.comments.filter((unit) => !unit.parentId).map((unit) => ({
      ...toUnit(unit), replies: draft.comments.filter((reply) => reply.parentId === unit.id).map(toUnit),
    })))
    setGlobalGender(draft.gender); setGlobalGeos(draft.geos); setPostReactionCount(draft.postLikes)
  }

  function buildJobs() {
    const url = normalizeFacebookUrl(postUrl)
    const used = new Set<string>()
    const jobs: Array<{
      action?: "comment" | "like" | "likeonly" | "subscribe" | "comment_like"
      clientKey?: string
      replyToKey?: string
      profileId: string
      fanName?: string
      url: string
      message: string
      aiComment?: boolean
      photoKey?: string
    }> = []
    const photos = new Map<string, File>()
    const skipped: string[] = []

    for (let index = 0; index < Math.min(postReactionCount, MAX_POST_REACTIONS); index += 1) {
      const fan = pickFan(fans, used, globalGender, globalGeos)
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
      const commentGeos = comment.geos.length === 0 ? globalGeos : comment.geos
      let parentKey = ""

      if (commentText || comment.aiComment) {
        const fan = pickFan(fans, used, commentGender, commentGeos)
        if (fan) {
          parentKey = taskKey("comment", comment.id)
          jobs.push({
            action: "comment",
            clientKey: parentKey,
            profileId: fan.profileId,
            fanName: fan.name,
            url,
            message: commentText,
          aiComment: comment.aiComment && !commentText,
            photoKey: comment.photo ? parentKey : undefined,
          })
          if (comment.photo) photos.set(parentKey, comment.photo)
        } else {
          skipped.push(t("Комментарий {0}", commentIndex + 1))
        }
      }

      if (comment.reactionCount > 0 && !parentKey) {
        skipped.push(t("Лайки к комментарию {0}: нет текста родителя", commentIndex + 1))
      } else {
        for (let index = 0; index < comment.reactionCount; index += 1) {
          const fan = pickFan(fans, used, commentGender, commentGeos)
          if (!fan) {
            skipped.push(t("Лайк {0} к комментарию {1}", index + 1, commentIndex + 1))
            break
          }
          jobs.push({
            action: "comment_like",
            replyToKey: parentKey,
            profileId: fan.profileId,
            fanName: fan.name,
            url,
            message: "",
          })
        }
      }

      for (const [replyIndex, replyItem] of comment.replies.entries()) {
        const replyText = replyItem.text.trim()
        if (!replyText && !replyItem.aiComment) continue
        if (!parentKey) {
          skipped.push(t("Ответ {0} к комментарию {1}: нет текста родителя", replyIndex + 1, commentIndex + 1))
          continue
        }
        const replyGender = replyItem.gender === "ANY" ? globalGender : replyItem.gender
        const replyGeos = replyItem.geos.length === 0 ? globalGeos : replyItem.geos
        const fan = pickFan(fans, used, replyGender, replyGeos)
        if (!fan) {
          skipped.push(t("Ответ {0} к комментарию {1}", replyIndex + 1, commentIndex + 1))
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
          aiComment: replyItem.aiComment && !replyText,
          photoKey: replyItem.photo ? replyKey : undefined,
        })
        if (replyItem.photo) photos.set(replyKey, replyItem.photo)

        for (let index = 0; index < replyItem.reactionCount; index += 1) {
          const reactionFan = pickFan(fans, used, replyGender, replyGeos)
          if (!reactionFan) {
            skipped.push(t("Лайк {0} к ответу {1}", index + 1, replyIndex + 1))
            break
          }
          jobs.push({
            action: "comment_like",
            replyToKey: replyKey,
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
      pushAppNotification(t("Создание задачи"), t("Введи название задачи"), { tone: "error" })
      return
    }
    if (!isFacebookUrl(url)) {
      pushAppNotification(t("Создание задачи"), t("Вставь корректную ссылку на пост Facebook"), { tone: "error" })
      return
    }

    const { jobs, photos, skipped } = buildJobs()
    if (jobs.length === 0) {
      pushAppNotification(t("Создание задачи"), t("Нет действий для запуска"), { tone: "error" })
      return
    }
    if (skipped.length > 0) {
      pushAppNotification(t("Создание задачи"), t("Не хватает фанок: {0}", skipped.slice(0, 3).join(", ")), { tone: "error" })
      return
    }

    setSubmitting(true)
    try {
      const formData = new FormData()
      const payload = JSON.stringify({ name, action: "mixed", jobs })
      if ([...photos.values()].reduce((sum, file) => sum + file.size, new Blob([payload]).size) > MAX_COMMENT_MEDIA_TOTAL_SIZE) {
        pushAppNotification(t("Вложения"), t("Общий размер вложений и задачи должен быть до 70 МБ"), { tone: "error" })
        return
      }
      formData.set("payload", payload)
      for (const [key, file] of photos.entries()) {
        formData.set(`photo:${key}`, file)
      }
      const result = await enqueueFarmTaskForm(formData)
      if (result.error) {
        pushAppNotification(t("Создание задачи"), result.error, { href: "/tasks/list?tab=work", tone: "error" })
        return
      }
      pushAppNotification(
        t("Создание задачи"),
        t("{0} · {1} действий в очереди{2}", name, result.total || jobs.length, result.rewritten ? t(" · AI перефразировал: {0}", result.rewritten) : ""),
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
        (comment.text.trim() || comment.aiComment ? 1 : 0) +
        comment.replies.filter((replyItem) => replyItem.text.trim() || replyItem.aiComment).length,
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
          {t(error)}
        </div>
      ) : null}

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="font-heading text-base font-medium">{t("Создать новую задачу")}</h2>
            <p className="text-sm text-muted-foreground">{t("Один пост, таргетинг фанок, комментарии, ответы и реакции.")}</p>
          </div>
          <Badge variant="secondary">{totalDraftActions} {t(" действий")}</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("Название задачи")}</span>
            <Input value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder={t("Название задачи...")} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("Ссылка на пост Facebook")}</span>
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
          <h2 className="font-heading text-base font-medium">{t("Таргетинг комментаторов")}</h2>
          <Badge variant="outline">{matchingFans.length} {t(" фанок")}</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField label={t("Пол")} value={globalGender} onChange={(value) => setGlobalGender(value as GenderFilter)}>
            <option value="ANY">{t("Любой")}</option>
            <option value="MALE">{t("Мужчины")}</option>
            <option value="FEMALE">{t("Женщины")}</option>
          </SelectField>
          <GeoMultiSelect
            label={t("Гео")}
            value={globalGeos}
            geos={geos}
            countries={countries}
            emptyLabel={t("Выберите гео")}
            onChange={setGlobalGeos}
          />
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <h2 className="font-heading text-base font-medium">{t("Настройки вовлечения поста")}</h2>
        <RangeField
          label={t("Реакции на пост")}
          value={postReactionCount}
          min={0}
          max={MAX_POST_REACTIONS}
          onChange={(value) => setPostReactionCount(Math.min(value, MAX_POST_REACTIONS))}
        />
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <h2 className="font-heading text-base font-medium">{t("Генерация комментариев")}</h2>
        <div className="grid gap-3">
          <div className="grid h-10 grid-cols-2 rounded-lg border bg-background p-1">
            {(
              [
                { id: "text", label: t("Из текста") },
                { id: "library", label: t("Из библиотеки") },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setGenerateMode(option.id)}
                className={cn(
                  "inline-flex items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
                  generateMode === option.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {generateMode === "text" ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("Один комментарий на строку. Начни строку с Tab или 4 пробелов, чтобы сделать reply к комментарию выше.")}</p>
              <Textarea
                value={bulkCommentsText}
                onChange={(event) => setBulkCommentsText(event.target.value)}
                placeholder={t("Первый комментарий\n    Ответ к первому\nВторой комментарий")}
                rows={7}
              />
              <Button
                type="button"
                disabled={bulkCommentsText.trim().length === 0}
                onClick={generateCommentsFromText}
              >
                {t("Сгенерировать")}
              </Button>
            </>
          ) : (
            <CommentSetPicker getDraft={getCommentSet} onApply={applyCommentSet} disabled={submitting} />
          )}
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-base font-medium">{t("Комментарии")}</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => setComments((current) => [...current, emptyComment()])}>
            <Plus />
            {t("Добавить комментарий")}</Button>
        </div>

        <div className="grid gap-3">
          {generateMode !== "library" ? <CommentSetPicker getDraft={getCommentSet} onApply={applyCommentSet} disabled={submitting} /> : null}
          {comments.map((comment, index) => (
            <CommentEditor
              key={comment.id}
              title={t("Комментарий {0}", index + 1)}
              unit={comment}
              countries={countries}
              geos={geos}
              onChange={(patch) => updateComment(comment.id, patch as Partial<CommentDraft>)}
              onDelete={comments.length > 1 ? () => {
                revokeCommentPreviews([comment])
                setComments((current) => current.filter((item) => item.id !== comment.id))
              } : undefined}
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
                    title={t("Ответ {0}", replyIndex + 1)}
                    reply
                    unit={replyItem}
                    countries={countries}
                    geos={geos}
                    onChange={(patch) => updateReply(comment.id, replyItem.id, patch)}
                    onDelete={() => {
                      if (replyItem.preview) URL.revokeObjectURL(replyItem.preview)
                      setComments((current) =>
                        current.map((item) =>
                          item.id === comment.id
                            ? { ...item, replies: item.replies.filter((reply) => reply.id !== replyItem.id) }
                            : item,
                        ),
                      )
                    }}
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
                  {t("Добавить ответ к комментарию")}</Button>
              </div>
            </CommentEditor>
          ))}
        </div>

        <Button type="button" size="lg" disabled={submitting} onClick={() => void submitTask()}>
          {submitting ? <Loader2 className="animate-spin" /> : <MessageCircle />}
          {t("Создать задачу")}</Button>
      </section>
    </div>
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
  const t = useTranslations()

  return (
    <div className={cn("grid gap-4 rounded-2xl border p-3 md:p-4", reply ? "bg-muted/30" : "bg-background")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-base font-medium">{title}</h3>
        {onDelete ? (
          <Button type="button" variant="outline" size="sm" onClick={onDelete}>
            <Trash2 />
            {t("Удалить")}</Button>
        ) : null}
      </div>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{t("Текст комментария")}</span>
        <Textarea value={unit.text} placeholder={unit.aiComment ? t("AI-комментарий будет сгенерирован при запуске") : t("Текст комментария")} onChange={(event) => onChange({ text: event.target.value })} rows={5} />
      </label>
      <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t("Фото, GIF или MP4")}</span>
          <p className="text-xs text-muted-foreground">{t(COMMENT_MEDIA_HINT)}</p>
          <input
            ref={fileInput}
            type="file"
            aria-label={reply ? t("Вложение ответа") : t("Вложение комментария")}
            accept={COMMENT_MEDIA_ACCEPT}
            className="hidden"
            onChange={(event) => {
              onPhoto(event.target.files?.[0])
              event.currentTarget.value = ""
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={onPickFile}>
              <Paperclip />
              {t("Загрузить")}</Button>
            {unit.photo ? (
              <span className="text-xs text-muted-foreground">
                {unit.photo.name} · {fileSizeLabel(unit.photo.size)}
              </span>
            ) : null}
            {unit.photo ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onPhoto(undefined)}>
                <Trash2 />
                {t("Убрать")}</Button>
            ) : null}
          </div>
          {unit.preview ? (
            <CommentMediaPreview
              src={unit.preview}
              name={unit.photo?.name}
              mime={unit.photo?.type}
              controls
              width={96}
              height={96}
              className={isCommentVideo(unit.photo?.name ?? "", unit.photo?.type) ? "h-40 w-64 max-w-full rounded-lg bg-black object-contain" : "size-24 rounded-lg object-cover"}
            />
          ) : null}
        </div>
        <RangeField
          label={reply ? t("Лайки к ответу") : t("Лайки к комментарию")}
          value={unit.reactionCount}
          min={0}
          max={MAX_COMMENT_REACTIONS}
          onChange={(value) => onChange({ reactionCount: Math.min(value, MAX_COMMENT_REACTIONS) })}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField label={t("Пол")} value={unit.gender} onChange={(value) => onChange({ gender: value as GenderFilter })}>
          <option value="ANY">{t("Любой")}</option>
          <option value="MALE">{t("Мужчины")}</option>
          <option value="FEMALE">{t("Женщины")}</option>
        </SelectField>
        <GeoMultiSelect
          label={t("Гео")}
          value={unit.geos}
          geos={geos}
          countries={countries}
          emptyLabel={t("Выберите гео")}
          onChange={(value) => onChange({ geos: value })}
        />
      </div>
      {children}
    </div>
  )
}
