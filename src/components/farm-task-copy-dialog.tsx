"use client"

import { CommentMediaPreview } from "@/components/comment-media-preview"
import { commentMediaLabel } from "@/lib/comment-media"
import { useEffect, useMemo, useState } from "react"
import { Copy, Loader2, Plus, Reply, Trash2 } from "lucide-react"
import { duplicateFarmTask, getFarmTaskCopyOptions } from "@/app/actions/farm-queue"
import { copyDraftFromJobs, type CopyDraft, type CopySourceJob } from "@/lib/farm-task-copy"
import type { CommentSetUnit, TargetGender } from "@/lib/comment-set"
import type { CountryInfo } from "@/app/(app)/constructor/farm-comments"
import { pushAppNotification } from "@/lib/app-notifications"
import { CommentSetPicker } from "@/components/comment-set-picker"
import { GeoMultiSelect, RangeField, SelectField } from "@/components/task-targeting-fields"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type CopyTask = { id: string; name: string; jobs: CopySourceJob[] }

export function FarmTaskCopyDialog({ task, onClose, onCreated }: {
  task: CopyTask
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const originalUrls = useMemo(() => [...new Set(task.jobs.map((job) => job.url).filter(Boolean))], [task.jobs])
  const [urls, setUrls] = useState(originalUrls.join("\n"))
  const [draft, setDraft] = useState<CopyDraft>(() => copyDraftFromJobs(task.jobs))
  const [catalog, setCatalog] = useState<{ geos: string[]; countries: Record<string, CountryInfo>; available: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [submitError, setSubmitError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    void getFarmTaskCopyOptions(task.id).then((result) => {
      if (cancelled) return
      if (result.error) setLoadError(result.error)
      else setCatalog({ geos: result.geos ?? [], countries: result.countries ?? {}, available: result.available ?? 0 })
      setLoading(false)
    }).catch(() => { if (!cancelled) { setLoadError("Не удалось загрузить настройки"); setLoading(false) } })
    return () => { cancelled = true }
  }, [task.id, attempt])

  function update(id: string, patch: Partial<CommentSetUnit>) {
    setDraft((current) => ({ ...current, comments: current.comments.map((unit) => unit.id === id ? { ...unit, ...patch } : unit) }))
  }
  function add(parentId: string | null = null) {
    setDraft((current) => ({ ...current, comments: [...current.comments, {
      id: crypto.randomUUID(), parentId, text: "", likes: 0, gender: "ANY", geos: [], aiComment: false,
    }] }))
  }
  function remove(id: string) {
    setDraft((current) => {
      const deleted = new Set([id])
      let size = 0
      while (size !== deleted.size) {
        size = deleted.size
        for (const unit of current.comments) if (unit.parentId && deleted.has(unit.parentId)) deleted.add(unit.id)
      }
      return { ...current, comments: current.comments.filter((unit) => !deleted.has(unit.id)) }
    })
  }
  async function submit() {
    if (busy || loading || !catalog) return
    setBusy(true); setSubmitError("")
    try {
      const result = await duplicateFarmTask({ taskId: task.id, urls: urls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean), draft })
      if (result.error) { setSubmitError(result.error); return }
      pushAppNotification("Задача скопирована", `В очередь · ${result.total ?? 0} действий${result.rewritten ? ` · AI перефразировал дублей: ${result.rewritten}` : ""}`, { href: "/queue?tab=work", tone: "queue" })
      await onCreated().catch(() => undefined)
      onClose()
    } catch { setSubmitError("Не удалось создать копию. Проверьте соединение и попробуйте снова.") }
    finally { setBusy(false) }
  }
  const total = draft.postLikes + draft.comments.reduce((sum, unit) => sum + 1 + unit.likes, 0)

  function editor(unit: CommentSetUnit, index: number, depth = 0) {
    const original = task.jobs.find((job) => job.id === draft.sources[unit.id])
    const children = draft.comments.filter((item) => item.parentId === unit.id)
    return (
      <div key={unit.id} className={`grid gap-3 rounded-xl border bg-background p-3 ${depth ? "sm:ml-4" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{unit.parentId ? "Ответ" : "Комментарий"} {index + 1}</span>
          <Button type="button" variant="ghost" size="icon" aria-label={unit.parentId ? "Удалить ответ" : "Удалить комментарий"} onClick={() => remove(unit.id)}><Trash2 /></Button>
        </div>
        <Textarea aria-label={unit.parentId ? `Текст ответа ${index + 1}` : `Текст комментария ${index + 1}`} value={unit.text} maxLength={8000} onChange={(event) => update(unit.id, { text: event.target.value })} rows={3} placeholder={unit.aiComment ? "AI-комментарий" : "Текст комментария"} />
        {original?.photoPath ? <a href={original.photoPath} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-2 text-xs text-muted-foreground"><CommentMediaPreview src={original.photoPath} width={48} height={48} className="size-12 rounded-md object-cover" />{commentMediaLabel(original.photoPath)} сохранится в копии</a> : null}
        <RangeField label={unit.parentId ? "Лайки к ответу" : "Лайки к комментарию"} value={unit.likes} min={0} max={Math.max(20, unit.likes)} onChange={(likes) => update(unit.id, { likes })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Пол комментатора и лайков" value={unit.gender} onChange={(gender) => update(unit.id, { gender: gender as TargetGender })}>
            <option value="ANY">Как в общих настройках</option><option value="MALE">Мужчины</option><option value="FEMALE">Женщины</option>
          </SelectField>
          <GeoMultiSelect label="Гео комментатора и лайков" value={unit.geos} geos={catalog?.geos ?? []} countries={catalog?.countries ?? {}} emptyLabel="Как в общих настройках" onChange={(geos) => update(unit.id, { geos })} />
        </div>
        {children.map((child, childIndex) => editor(child, childIndex, depth + 1))}
        {depth < 1 ? <Button type="button" variant="outline" className="w-fit" onClick={() => add(unit.id)}><Reply />Добавить ответ</Button> : null}
      </div>
    )
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[90svh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Скопировать задачу</DialogTitle>
          <DialogDescription>Тексты, ответы и вложения исходной задачи сохранены в форме. Можно изменить лайки, гео и пол или загрузить свой набор.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-1">
          <fieldset disabled={busy} className="grid min-w-0 gap-4 pb-4 disabled:opacity-60">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="truncate text-sm text-muted-foreground">{task.name || "Без названия"}</span><Badge variant="secondary">{total} действий</Badge></div>
            <label className="grid gap-1.5"><span className="text-sm font-medium">Ссылка на пост Facebook</span><Textarea value={urls} onChange={(event) => setUrls(event.target.value)} rows={2} placeholder="https://www.facebook.com/..." /><span className="text-xs text-muted-foreground">Исходных постов: {originalUrls.length}. Одна ссылка заменит все посты; для отдельных постов вставьте {originalUrls.length} ссылок по порядку.</span></label>
            {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Загружаем доступные гео и фанки…</p> : null}
            {loadError ? <div role="alert" className="grid gap-2"><p className="text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" className="w-fit" onClick={() => { setLoadError(""); setLoading(true); setAttempt((value) => value + 1) }}>Повторить загрузку</Button></div> : null}
            <div className="grid gap-3 rounded-xl border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">Таргетинг комментаторов</span>{catalog ? <Badge variant="outline">Доступно {catalog.available} фанок</Badge> : null}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Пол" value={draft.gender} onChange={(gender) => setDraft((current) => ({ ...current, gender: gender as TargetGender }))}><option value="ANY">Любой</option><option value="MALE">Мужчины</option><option value="FEMALE">Женщины</option></SelectField>
                <GeoMultiSelect label="Гео" value={draft.geos} geos={catalog?.geos ?? []} countries={catalog?.countries ?? {}} emptyLabel="Любое гео" onChange={(geos) => setDraft((current) => ({ ...current, geos }))} />
              </div>
              <RangeField label="Реакции на пост" value={draft.postLikes} min={0} max={Math.max(20, draft.postLikes)} onChange={(postLikes) => setDraft((current) => ({ ...current, postLikes }))} />
            </div>
            <CommentSetPicker getDraft={() => draft} onApply={(saved) => setDraft({ ...saved, sources: {} })} disabled={busy} />
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Комментарии и ответы · {draft.comments.length}</span><Button type="button" variant="outline" size="sm" onClick={() => add()}><Plus />Добавить комментарий</Button></div>
            {draft.comments.filter((unit) => !unit.parentId).map((unit, index) => editor(unit, index))}
          </fieldset>
        </div>
        <DialogFooter className="flex-col sm:flex-col">
          {submitError ? <p role="alert" className="w-full text-sm text-destructive">{submitError}</p> : null}
          <div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button><Button type="button" disabled={busy || loading || !catalog || !urls.trim() || !total} onClick={() => void submit()}>{busy ? <Loader2 className="animate-spin" /> : <Copy />}Создать копию</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
