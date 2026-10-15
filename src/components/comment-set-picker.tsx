"use client"

import { useEffect, useState } from "react"
import { BookmarkPlus, Loader2, Trash2 } from "lucide-react"
import { deleteCommentSet, listCommentSets, saveCommentSet } from "@/app/actions/comment-sets"
import type { CommentSetDraft } from "@/lib/comment-set"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function CommentSetPicker({ getDraft, onApply, disabled = false }: {
  getDraft: () => CommentSetDraft
  onApply: (draft: CommentSetDraft) => void | boolean
  disabled?: boolean
}) {
  const [sets, setSets] = useState<Array<{ id: string; name: string; draft: CommentSetDraft }>>([])
  const [selected, setSelected] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    void listCommentSets().then((result) => {
      if (cancelled) return
      if (result.error) setError(result.error)
      else setSets(result.sets ?? [])
    }).catch(() => { if (!cancelled) setError("Не удалось загрузить наборы") })
    return () => { cancelled = true }
  }, [])

  async function save() {
    setBusy(true); setError(""); setMessage("")
    try {
      const result = await saveCommentSet({ name, draft: getDraft() })
      if (result.error) { setError(result.error); return }
      const refreshed = await listCommentSets()
      if (refreshed.error) { setError(refreshed.error); return }
      setSets(refreshed.sets ?? []); setSelected(result.id ?? ""); setMessage("Набор сохранён")
    } catch { setError("Не удалось сохранить набор") }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!selected) return
    setBusy(true); setError(""); setMessage("")
    try {
      const result = await deleteCommentSet(selected)
      if (result.error) { setError(result.error); return }
      setSets((current) => current.filter((set) => set.id !== selected)); setSelected(""); setMessage("Набор удалён")
    } catch { setError("Не удалось удалить набор") }
    finally { setBusy(false) }
  }
  return (
    <div className="grid gap-3 rounded-xl border bg-muted/15 p-3">
      <div className="grid gap-1">
        <span className="text-sm font-medium">Мои наборы комментариев</span>
        <p className="text-xs text-muted-foreground">Сохраняются тексты, ответы, лайки, гео и пол. Вложения остаются в исходной задаче. Наборы доступны только вам.</p>
      </div>
      <fieldset disabled={disabled || busy} className="grid min-w-0 gap-3 disabled:opacity-60">
        <div className="flex flex-wrap gap-2">
          <select aria-label="Сохранённый набор" value={selected} onChange={(event) => { setSelected(event.target.value); setMessage("") }} className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm">
            <option value="">Выберите набор</option>
            {sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
          </select>
          <Button type="button" variant="outline" disabled={!selected} onClick={() => {
            const set = sets.find((item) => item.id === selected)
            if (set && onApply(structuredClone(set.draft)) !== false) { setMessage("Набор загружен в форму"); setError("") }
          }}>Применить набор</Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Удалить набор" disabled={!selected} onClick={() => void remove()}><Trash2 /></Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Название набора" placeholder="Название набора" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="min-w-40 flex-1" />
          <Button type="button" variant="outline" disabled={!name.trim()} onClick={() => void save()}>{busy ? <Loader2 className="animate-spin" /> : <BookmarkPlus />}Сохранить набор</Button>
        </div>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  )
}
