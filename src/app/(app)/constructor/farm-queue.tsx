"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  EyeIcon,
  Loader2,
  Play,
  SearchIcon,
  Square,
  Trash2Icon,
} from "lucide-react"
import { deleteFarmTasks, duplicateFarmTask, startFarmTask, stopFarmTask } from "@/app/actions/farm-queue"
import { pushAppNotification } from "@/lib/app-notifications"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type QueueStats = {
  pending: number
  running: number
  done: number
  error: number
  maxParallel?: number
}

type QueueJob = {
  id: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  status: "PENDING" | "RUNNING" | "DONE" | "ERROR"
  action: string
  fanName: string
  profileId: string
  url: string
  message: string
  aiComment: boolean
  photoPath: string
  error: string | null
  taskId: string
}

type QueueTask = {
  id: string
  createdAt: string
  finishedAt: string | null
  durationMs: number | null
  createdBy: string
  teamName: string
  lastLoginAt: string | null
  action: string
  total: number
  counts: QueueStats
  jobs: QueueJob[]
}

type QueueTab = "work" | "completed"
type QueueScope = "all" | "team" | "own"
type ConfirmAction =
  | { kind: "start"; taskId: string }
  | { kind: "stop"; taskId: string }
  | { kind: "delete"; taskIds: string[] }

const PAGE_SIZES = [20, 50, 100, 200, 500] as const

const actionLabel: Record<string, string> = {
  comment: "Комментарий",
  like: "Комментарий + лайк",
  likeonly: "Лайк",
  subscribe: "Комментарий + лайк + подписка",
}

const statusLabel: Record<QueueJob["status"], string> = {
  PENDING: "В очереди",
  RUNNING: "Идёт",
  DONE: "Готово",
  ERROR: "Ошибка",
}

const statusVariant: Record<
  QueueJob["status"],
  "secondary" | "default" | "outline" | "destructive"
> = {
  PENDING: "secondary",
  RUNNING: "default",
  DONE: "outline",
  ERROR: "destructive",
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

function formatDuration(ms: number | null) {
  if (ms === null) return "—"
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours > 0) return `${hours}ч ${minutes}м ${rest}с`
  if (minutes > 0) return `${minutes}м ${rest}с`
  return `${rest}с`
}

function TaskMetaList({ task, compact = false }: { task: QueueTask; compact?: boolean }) {
  const rows = [
    ["Team", task.teamName || "—"],
    ["Owner", task.createdBy || "—"],
    ["Last login", task.lastLoginAt ? formatWhen(task.lastLoginAt) : "—"],
    ["Created", formatWhen(task.createdAt)],
    ["Finished", task.finishedAt ? formatWhen(task.finishedAt) : "—"],
    ["Duration", formatDuration(task.durationMs)],
  ] as const

  return (
    <dl className={compact ? "grid gap-0.5 text-xs" : "grid gap-1 text-sm"}>
      {rows.map(([label, value]) => (
        <div key={label} className={compact ? "flex min-w-0 gap-1" : "flex min-w-0 gap-1.5"}>
          <dt className="shrink-0 font-medium text-foreground">{label}:</dt>
          <dd className="min-w-0 truncate text-muted-foreground" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function shortUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`.replace(/\/$/, "") || url
  } catch {
    return url
  }
}

function JobTable({ jobs }: { jobs: QueueJob[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Фанка</TableHead>
          <TableHead>Пост</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Когда</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
              Пока нет заданий
            </TableCell>
          </TableRow>
        ) : (
          jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell className="font-medium">{job.fanName || job.profileId}</TableCell>
              <TableCell className="max-w-xs truncate text-muted-foreground" title={job.url}>
                {shortUrl(job.url)}
              </TableCell>
              <TableCell>
                <div className="grid gap-1">
                  <Badge variant={statusVariant[job.status]}>{statusLabel[job.status]}</Badge>
                  {job.error ? (
                    <span className="max-w-xs truncate text-xs text-destructive">{job.error}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>{formatWhen(job.createdAt)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function TaskDetailsDialog({
  task,
  onOpenChange,
}: {
  task: QueueTask | null
  onOpenChange: (open: boolean) => void
}) {
  const errors = task ? taskErrorLog(task) : []
  const serviceMessage = task ? taskServiceMessage(task) : ""

  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        {task ? (
          <>
            <DialogHeader>
              <DialogTitle>Задача · {actionLabel[task.action] || task.action}</DialogTitle>
              <DialogDescription>
                {task.createdBy} · {formatWhen(task.createdAt)} · {task.total} коммент.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <TaskCommentStatus task={task} />
                <Badge variant={errors.length > 0 ? "destructive" : "outline"}>
                  Ошибок: {errors.length}
                </Badge>
              </div>
              <div className="rounded-xl border bg-muted/20 p-3">
                <TaskMetaList task={task} />
              </div>
              <ServiceMessage message={serviceMessage} />
              {errors.length > 0 ? (
                <div className="grid gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">Лог ошибок</p>
                  <div className="grid max-h-36 gap-1 overflow-y-auto text-sm">
                    {errors.map((job) => (
                      <p key={job.id} className="text-destructive">
                        {job.fanName || job.profileId}: {job.error}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="max-h-[28rem] overflow-y-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Фанка</TableHead>
                      <TableHead>Пост</TableHead>
                      <TableHead>Комментарий</TableHead>
                      <TableHead>Фото</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {task.jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-medium">{job.fanName || job.profileId}</TableCell>
                        <TableCell className="max-w-[13rem] truncate text-muted-foreground" title={job.url}>
                          {shortUrl(job.url)}
                        </TableCell>
                        <TableCell className="max-w-sm">
                          <div className="grid gap-1">
                            <span className="line-clamp-2 text-sm">
                              {job.aiComment ? "ChatGPT" : job.message || "—"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {job.photoPath ? (
                            <a
                              href={job.photoPath}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-primary hover:underline"
                            >
                              Фото
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="grid gap-1">
                            <Badge variant={statusVariant[job.status]}>{statusLabel[job.status]}</Badge>
                            {job.error ? (
                              <span className="max-w-xs text-xs text-destructive">{job.error}</span>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

const emptyStats: QueueStats = { pending: 0, running: 0, done: 0, error: 0 }

type QueueSnapshot = { stats: QueueStats; tasks: QueueTask[] }
type OwnerStats = {
  name: string
  tasks: number
  comments: number
  likes: number
  photos: number
  ai: number
  pending: number
  running: number
  done: number
  error: number
  lastAt: string
}

const cachedQueues = new Map<QueueScope, QueueSnapshot>()

function getRememberedQueue(scope: QueueScope) {
  return cachedQueues.get(scope) ?? null
}

function rememberQueue(scope: QueueScope, stats: QueueStats, tasks: QueueTask[]) {
  cachedQueues.set(scope, { stats, tasks })
}

function QueueLoading() {
  return <p className="py-6 text-center text-sm text-muted-foreground">Загружаем очередь…</p>
}

function taskStatus(task: QueueTask): QueueJob["status"] {
  if (task.counts.running > 0) return "RUNNING"
  if (task.counts.pending > 0) return "PENDING"
  if (task.counts.error > 0) return "ERROR"
  return "DONE"
}

function taskTab(task: QueueTask): QueueTab {
  return task.counts.pending > 0 || task.counts.running > 0 ? "work" : "completed"
}

function TaskCommentStatus({ task }: { task: QueueTask }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline">ok {task.counts.done}</Badge>
      {task.counts.error > 0 ? <Badge variant="destructive">err {task.counts.error}</Badge> : null}
      {task.counts.running > 0 ? <Badge>run {task.counts.running}</Badge> : null}
      {task.counts.pending > 0 ? <Badge variant="secondary">wait {task.counts.pending}</Badge> : null}
    </div>
  )
}

function cleanFanName(value: string) {
  return value.replace(/^(?:\[[^\]]+\]\s*)+/, "").trim()
}

function taskServiceMessage(task: QueueTask) {
  const errors = task.jobs.filter((job) => job.error)
  const first = errors[0]
  if (!first?.error) return ""

  const name = cleanFanName(first.fanName || "")
  const prefix = name ? `${name}: ` : ""
  const suffix = errors.length > 1 ? ` Ещё ошибок: ${errors.length - 1}.` : ""
  return `${prefix}${first.error}${suffix}`
}

function ServiceMessage({ message, compact = false }: { message: string; compact?: boolean }) {
  if (!message) return null

  return (
    <div
      className={
        compact
          ? "rounded-lg border border-destructive/25 bg-destructive/5 px-2 py-1 text-xs text-destructive"
          : "rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      }
    >
      <span className="font-medium text-foreground">Service message:</span>{" "}
      <span>{message}</span>
    </div>
  )
}

function uniqueTaskUrls(task: QueueTask) {
  return [...new Set(task.jobs.map((job) => job.url).filter(Boolean))]
}

function taskErrorLog(task: QueueTask) {
  return task.jobs.filter((job) => job.error)
}

function buildOwnerStats(tasks: QueueTask[]) {
  const rows = new Map<string, OwnerStats>()
  for (const task of tasks) {
    const name = task.createdBy || "Без имени"
    const current =
      rows.get(name) ??
      {
        name,
        tasks: 0,
        comments: 0,
        likes: 0,
        photos: 0,
        ai: 0,
        pending: 0,
        running: 0,
        done: 0,
        error: 0,
        lastAt: task.createdAt,
      }
    const jobsCount = task.jobs.length || task.total
    current.tasks += 1
    if (task.action !== "likeonly") current.comments += jobsCount
    if (task.action === "like" || task.action === "likeonly" || task.action === "subscribe") {
      current.likes += jobsCount
    }
    current.photos += task.jobs.filter((job) => Boolean(job.photoPath)).length
    current.ai += task.jobs.filter((job) => job.aiComment).length
    current.pending += task.counts.pending
    current.running += task.counts.running
    current.done += task.counts.done
    current.error += task.counts.error
    if (task.createdAt > current.lastAt) current.lastAt = task.createdAt
    rows.set(name, current)
  }

  return [...rows.values()].sort(
    (left, right) => right.tasks - left.tasks || right.comments - left.comments || left.name.localeCompare(right.name),
  )
}

function OwnerStatsTable({ stats }: { stats: OwnerStats[] }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
      <div className="mb-4 grid gap-1">
        <h2 className="font-heading text-base font-medium">Статистика байеров</h2>
        <p className="text-sm text-muted-foreground">
          Задачи и результаты по тем пользователям, которые доступны текущей роли.
        </p>
      </div>
      {stats.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Пока нет задач</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Байер</TableHead>
              <TableHead>Задач</TableHead>
              <TableHead>Комментов</TableHead>
              <TableHead>Лайков</TableHead>
              <TableHead>Фото</TableHead>
              <TableHead>ChatGPT</TableHead>
              <TableHead>Готово</TableHead>
              <TableHead>Ошибки</TableHead>
              <TableHead>В работе</TableHead>
              <TableHead>Последняя задача</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="whitespace-nowrap font-medium">{row.name}</TableCell>
                <TableCell className="tabular-nums">{row.tasks}</TableCell>
                <TableCell className="tabular-nums">{row.comments}</TableCell>
                <TableCell className="tabular-nums">{row.likes}</TableCell>
                <TableCell className="tabular-nums">{row.photos}</TableCell>
                <TableCell className="tabular-nums">{row.ai}</TableCell>
                <TableCell className="tabular-nums">{row.done}</TableCell>
                <TableCell className="tabular-nums">{row.error}</TableCell>
                <TableCell className="tabular-nums">{row.pending + row.running}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatWhen(row.lastAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

function TasksTable({
  tasks,
  totalTasks,
  queuePositions,
  query,
  page,
  totalPages,
  pageSize,
  selectedIds,
  busyId,
  onStop,
  onStart,
  onDetails,
  onDuplicate,
  onDelete,
  onQueryChange,
  onPageChange,
  onPageSizeChange,
  onToggleSelected,
  onTogglePage,
  canManage,
  currentUserName,
  tools = false,
}: {
  tasks: QueueTask[]
  totalTasks: number
  queuePositions: Map<string, number>
  query: string
  page: number
  totalPages: number
  pageSize: number
  selectedIds: string[]
  busyId: string | null
  onStop: (taskId: string) => void
  onStart: (taskId: string) => void
  onDetails: (task: QueueTask) => void
  onDuplicate: (task: QueueTask) => void
  onDelete: () => void
  onQueryChange: (value: string) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onToggleSelected: (taskId: string, checked: boolean) => void
  onTogglePage: (checked: boolean) => void
  canManage: boolean
  currentUserName?: string
  tools?: boolean
}) {
  const busy = busyId !== null
  const selectedOnPage = tasks.filter((task) => selectedIds.includes(task.id)).length
  const pageChecked = tasks.length > 0 && selectedOnPage === tasks.length

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
      {tools ? (
        <div className="mb-4 grid gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Поиск по юзеру, фанке, посту, статусу или ошибке"
                className="pl-8"
                aria-label="Поиск по задачам"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {totalTasks} найдено
              </Badge>
              <select
                value={pageSize}
                onChange={(event) => onPageSizeChange(Number(event.target.value))}
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                aria-label="Задач на странице"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} / стр.
                  </option>
                ))}
              </select>
              {canManage ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || selectedIds.length === 0}
                  onClick={onDelete}
                >
                  {busyId === "delete" ? <Loader2 className="animate-spin" /> : <Trash2Icon />}
                  Удалить {selectedIds.length > 0 ? selectedIds.length : ""}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {query ? "По этому поиску ничего не найдено" : "Очередь пустая"}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {tools && canManage ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={pageChecked}
                    onCheckedChange={(checked) => onTogglePage(Boolean(checked))}
                    aria-label="Выбрать задачи на странице"
                  />
                </TableHead>
              ) : null}
              <TableHead>Очередь</TableHead>
              <TableHead>Информация</TableHead>
              <TableHead>Задача</TableHead>
              <TableHead>Комментарии</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const status = taskStatus(task)
              const busy = busyId === task.id || busyId === "all"
              const mine = Boolean(currentUserName && task.createdBy === currentUserName)
              const position = queuePositions.get(task.id)
              const serviceMessage = taskServiceMessage(task)
              return (
                <TableRow key={task.id} className={mine ? "bg-primary/5" : undefined}>
                  {tools && canManage ? (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.includes(task.id)}
                        onCheckedChange={(checked) => onToggleSelected(task.id, Boolean(checked))}
                        aria-label={`Выбрать задачу ${task.id}`}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="whitespace-nowrap font-medium">
                    {position ? `#${position}` : "—"}
                  </TableCell>
                  <TableCell className="min-w-56">
                    <div className="grid gap-1">
                      {mine ? <Badge variant="secondary" className="w-fit">Моя</Badge> : null}
                      <TaskMetaList task={task} compact />
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {actionLabel[task.action] || task.action} · {task.total} шт.
                  </TableCell>
                  <TableCell>
                    <TaskCommentStatus task={task} />
                  </TableCell>
                  <TableCell>
                    <div className="grid min-w-48 gap-1.5">
                      <Badge variant={statusVariant[status]} className="w-fit">
                        {statusLabel[status]}
                      </Badge>
                      <ServiceMessage message={serviceMessage} compact />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onDetails(task)}
                      >
                        <EyeIcon />
                        Детали
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onDuplicate(task)}
                      >
                        <CopyIcon />
                        Копия
                      </Button>
                      {canManage ? (
                        <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onStop(task.id)}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <Square />}
                          Стоп
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => onStart(task.id)}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <Play />}
                          Старт
                        </Button>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      {tools && totalTasks > 0 ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Страница {page} из {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeftIcon />
              Назад
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Вперёд
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function QueueTabs({
  value,
  workCount,
  completedCount,
  onChange,
}: {
  value: QueueTab
  workCount: number
  completedCount: number
  onChange: (value: QueueTab) => void
}) {
  return (
    <div className="flex w-fit flex-wrap items-center gap-1 rounded-full bg-muted p-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={value === "work" ? "rounded-full bg-background shadow-sm hover:bg-background" : "rounded-full text-muted-foreground"}
        onClick={() => onChange("work")}
      >
        В работе
        <Badge variant="secondary">{workCount}</Badge>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={value === "completed" ? "rounded-full bg-background shadow-sm hover:bg-background" : "rounded-full text-muted-foreground"}
        onClick={() => onChange("completed")}
      >
        Завершено
        <Badge variant="secondary">{completedCount}</Badge>
      </Button>
    </div>
  )
}

export function FarmQueue({
  full = false,
  cards = false,
  active = true,
  canManage = true,
  showTabs = false,
  tableTools = false,
  initialTab = "work",
  initialQuery = "",
  initialPage = 1,
  initialPageSize = 50,
  currentUserName,
  queueScope = "all",
}: {
  full?: boolean
  cards?: boolean
  active?: boolean
  canManage?: boolean
  showTabs?: boolean
  tableTools?: boolean
  initialTab?: QueueTab
  initialQuery?: string
  initialPage?: number
  initialPageSize?: number
  currentUserName?: string
  queueScope?: QueueScope
}) {
  const initialQueue = getRememberedQueue(queueScope)
  const queueApiUrl = queueScope === "own" ? "/api/farm-queue?scope=own" : "/api/farm-queue"
  const safeInitialPageSize = PAGE_SIZES.includes(initialPageSize as (typeof PAGE_SIZES)[number])
    ? initialPageSize
    : 50
  const [stats, setStats] = useState<QueueStats>(() => initialQueue?.stats ?? emptyStats)
  const [tasks, setTasks] = useState<QueueTask[]>(() => initialQueue?.tasks ?? [])
  const [loaded, setLoaded] = useState(() => initialQueue !== null)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<QueueTab>(initialTab)
  const [query, setQuery] = useState(initialQuery)
  const [page, setPage] = useState(Math.max(1, initialPage))
  const [pageSize, setPageSize] = useState(safeInitialPageSize)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [detailsTask, setDetailsTask] = useState<QueueTask | null>(null)
  const [duplicateTask, setDuplicateTask] = useState<QueueTask | null>(null)
  const [duplicateUrls, setDuplicateUrls] = useState("")
  const previousTaskTabs = useRef<Map<string, QueueTab> | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false

    async function load() {
      try {
        const response = await fetch(queueApiUrl, { cache: "no-store" })
        const data = (await response.json()) as {
          error?: string
          stats?: QueueStats
          tasks?: QueueTask[]
        }
        if (cancelled) return
        if (!response.ok || data.error) {
          setError(data.error || "Не удалось загрузить очередь")
          setLoaded(true)
          return
        }
        const nextStats = data.stats || emptyStats
        const nextTasks = data.tasks || []
        const nextTaskTabs = new Map(nextTasks.map((task) => [task.id, taskTab(task)]))
        if (currentUserName && previousTaskTabs.current) {
          for (const task of nextTasks) {
            if (task.createdBy !== currentUserName) continue
            const nextTab = taskTab(task)
            const previousTab = previousTaskTabs.current.get(task.id)
            if (previousTab !== "work" || nextTab !== "completed") continue
            const status = taskStatus(task)
            pushAppNotification(
              status === "ERROR" ? "Задача завершилась с ошибкой" : "Задача готова",
              `${actionLabel[task.action] || task.action} · ${task.total} шт.`,
              {
                href: "/queue?tab=completed",
                tone: status === "ERROR" ? "error" : "success",
              },
            )
          }
        }
        previousTaskTabs.current = nextTaskTabs
        setError("")
        setStats(nextStats)
        setTasks(nextTasks)
        rememberQueue(queueScope, nextStats, nextTasks)
        setLoaded(true)
      } catch {
        if (!cancelled) {
          setError("Не удалось загрузить очередь")
          setLoaded(true)
        }
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active, currentUserName, queueApiUrl, queueScope])

  const recentJobs = useMemo(
    () =>
      tasks
        .flatMap((task) => task.jobs)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 120),
    [tasks],
  )
  const workTasks = useMemo(
    () =>
      tasks
        .filter((task) => taskTab(task) === "work")
        .sort((left, right) => {
          const leftStatus = taskStatus(left)
          const rightStatus = taskStatus(right)
          const leftRank = leftStatus === "RUNNING" ? 0 : 1
          const rightRank = rightStatus === "RUNNING" ? 0 : 1
          return leftRank - rightRank || left.createdAt.localeCompare(right.createdAt)
        }),
    [tasks],
  )
  const completedTasks = useMemo(
    () =>
      tasks
        .filter((task) => taskTab(task) === "completed")
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [tasks],
  )
  const queuePositions = useMemo(
    () => new Map(workTasks.map((task, index) => [task.id, index + 1])),
    [workTasks],
  )
  const taskStats = useMemo(() => {
    const next = { ...emptyStats }
    for (const task of tasks) {
      const status = taskStatus(task)
      if (status === "PENDING") next.pending += 1
      else if (status === "RUNNING") next.running += 1
      else if (status === "DONE") next.done += 1
      else next.error += 1
    }
    return next
  }, [tasks])
  const cardStats = tableTools ? taskStats : stats
  const visibleTasks = showTabs ? (tab === "work" ? workTasks : completedTasks) : tasks
  const filteredTasks = useMemo(() => {
    if (!tableTools) return visibleTasks
    const needle = query.trim().toLowerCase()
    if (!needle) return visibleTasks
    return visibleTasks.filter((task) => {
      const status = statusLabel[taskStatus(task)]
      const action = actionLabel[task.action] || task.action
      return [
        task.createdBy,
        action,
        status,
        String(task.total),
        formatWhen(task.createdAt),
        ...task.jobs.flatMap((job) => [
          job.fanName,
          job.profileId,
          job.url,
          job.aiComment ? "ChatGPT" : job.message,
          job.photoPath ? "фото" : "",
          job.error || "",
          statusLabel[job.status],
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [query, tableTools, visibleTasks])
  const ownerStats = useMemo(() => buildOwnerStats(filteredTasks), [filteredTasks])
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedTasks = tableTools
    ? filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : visibleTasks

  function selectTab(nextTab: QueueTab) {
    setTab(nextTab)
    if (!showTabs || typeof window === "undefined") return
    const url = new URL(window.location.href)
    url.searchParams.set("tab", nextTab)
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`)
  }

  function syncUrl(next: { query?: string; page?: number; pageSize?: number }) {
    if (!tableTools || typeof window === "undefined") return
    const url = new URL(window.location.href)
    const nextQuery = next.query ?? query
    const nextPage = next.page ?? page
    const nextPageSize = next.pageSize ?? pageSize

    if (nextQuery.trim()) url.searchParams.set("q", nextQuery.trim())
    else url.searchParams.delete("q")
    url.searchParams.set("page", String(nextPage))
    url.searchParams.set("size", String(nextPageSize))
    const search = url.searchParams.toString()
    window.history.replaceState(null, "", `${url.pathname}${search ? `?${search}` : ""}`)
  }

  function changeQuery(value: string) {
    setQuery(value)
    setPage(1)
    syncUrl({ query: value, page: 1 })
  }

  function changePageSize(value: number) {
    const safeSize = PAGE_SIZES.includes(value as (typeof PAGE_SIZES)[number]) ? value : 50
    setPageSize(safeSize)
    setPage(1)
    syncUrl({ page: 1, pageSize: safeSize })
  }

  function changePage(value: number) {
    const nextPage = Math.max(1, Math.min(value, totalPages))
    setPage(nextPage)
    syncUrl({ page: nextPage })
  }

  function toggleSelected(taskId: string, checked: boolean) {
    setSelectedTaskIds((current) =>
      checked ? [...new Set([...current, taskId])] : current.filter((id) => id !== taskId),
    )
  }

  function togglePage(checked: boolean) {
    const pageIds = pagedTasks.map((task) => task.id)
    setSelectedTaskIds((current) =>
      checked
        ? [...new Set([...current, ...pageIds])]
        : current.filter((id) => !pageIds.includes(id)),
    )
  }

  function applyQueueSnapshot(data: { stats?: QueueStats; tasks?: QueueTask[] }) {
    if (data.stats) setStats(data.stats)
    if (data.tasks) {
      setTasks(data.tasks)
      setSelectedTaskIds((current) =>
        current.filter((id) => data.tasks?.some((task) => task.id === id)),
      )
    }
    if (data.stats && data.tasks) rememberQueue(queueScope, data.stats, data.tasks)
  }

  async function refreshQueue() {
    const response = await fetch(queueApiUrl, { cache: "no-store" })
    const data = (await response.json()) as { stats?: QueueStats; tasks?: QueueTask[] }
    applyQueueSnapshot(data)
  }

  async function handleStop(taskId: string) {
    setBusyId(taskId || "all")
    const result = await stopFarmTask(taskId)
    if (result.error) {
      pushAppNotification("Стоп · ошибка", result.error, {
        href: "/queue?tab=work",
        tone: "error",
      })
    } else {
      pushAppNotification("Остановлено", `Закрыли AdsPower · заданий ${result.stopped ?? 0}`, {
        href: "/queue?tab=completed",
        tone: "queue",
      })
      void fetch(queueApiUrl, { cache: "no-store" })
        .then((response) => response.json())
        .then((data: { stats?: QueueStats; tasks?: QueueTask[] }) => applyQueueSnapshot(data))
        .catch(() => undefined)
    }
    setBusyId(null)
  }

  async function handleStart(taskId: string) {
    setBusyId(taskId || "all")
    const result = await startFarmTask(taskId)
    if (result.error) {
      pushAppNotification("Старт · ошибка", result.error, {
        href: "/queue?tab=work",
        tone: "error",
      })
    } else {
      pushAppNotification("Запущено", `В очередь · ${result.started ?? 0} шт.`, {
        href: "/queue?tab=work",
        tone: "queue",
      })
      void fetch("/api/farm-queue", { method: "POST" })
    }
    setBusyId(null)
  }

  async function handleDelete(taskIds: string[]) {
    if (taskIds.length === 0) return
    setBusyId("delete")
    const result = await deleteFarmTasks(taskIds)
    if (result.error) {
      pushAppNotification("Удаление · ошибка", result.error, {
        href: "/stats",
        tone: "error",
      })
    } else {
      pushAppNotification("Удалено", `Задач ${result.deleted ?? 0}`, {
        href: "/stats",
        tone: "success",
      })
      setSelectedTaskIds([])
      await refreshQueue().catch(() => undefined)
    }
    setBusyId(null)
  }

  function openDuplicateTask(task: QueueTask) {
    setDuplicateTask(task)
    setDuplicateUrls(uniqueTaskUrls(task).slice(0, 1).join("\n"))
  }

  async function handleDuplicateTask() {
    if (!duplicateTask) return
    const urls = duplicateUrls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)
    setBusyId(duplicateTask.id)
    const result = await duplicateFarmTask({ taskId: duplicateTask.id, urls })
    if (result.error) {
      pushAppNotification("Копия задачи · ошибка", result.error, {
        href: "/queue?tab=work",
        tone: "error",
      })
    } else {
      pushAppNotification("Задача скопирована", `В очередь · ${result.total ?? 0} шт.`, {
        href: "/queue?tab=work",
        tone: "queue",
      })
      setDuplicateTask(null)
      setDuplicateUrls("")
      await refreshQueue().catch(() => undefined)
      void fetch("/api/farm-queue", { method: "POST" })
    }
    setBusyId(null)
  }

  async function runConfirmedAction() {
    const action = confirmAction
    if (!action) return
    setConfirmAction(null)
    if (action.kind === "start") {
      await handleStart(action.taskId)
    } else if (action.kind === "stop") {
      await handleStop(action.taskId)
    } else {
      await handleDelete(action.taskIds)
    }
  }

  const confirmTitle =
    confirmAction?.kind === "start"
      ? "Запустить задачу?"
      : confirmAction?.kind === "stop"
        ? "Остановить задачу?"
        : "Удалить задачи?"
  const confirmDescription =
    confirmAction?.kind === "start"
      ? "Задания этой задачи будут возвращены в работу. Связанные AdsPower-профили перед запуском остановятся и откроются заново."
      : confirmAction?.kind === "stop"
        ? "Активные и ожидающие задания станут ошибкой «Остановлено», связанные AdsPower-профили будут закрыты."
        : `Будет удалено ${confirmAction?.taskIds.length ?? 0} задач вместе с заданиями. Связанные AdsPower-профили будут остановлены.`
  const confirmButton =
    confirmAction?.kind === "start"
      ? "Запустить"
      : confirmAction?.kind === "stop"
        ? "Остановить"
        : "Удалить"

  return (
    <section className="grid gap-4">
      {cards ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">В очереди</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{cardStats.pending}</p>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Идёт</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {cardStats.running}
              {tableTools ? null : stats.maxParallel ? (
                <span className="text-base text-muted-foreground"> / {stats.maxParallel}</span>
              ) : null}
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Готово</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{cardStats.done}</p>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Ошибки</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{cardStats.error}</p>
          </div>
        </div>
      ) : full ? null : (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">В очереди {stats.pending}</Badge>
          <Badge>Идёт {stats.running}{stats.maxParallel ? ` / ${stats.maxParallel}` : ""}</Badge>
          <Badge variant="outline">Готово {stats.done}</Badge>
          <Badge variant={stats.error > 0 ? "destructive" : "outline"}>Ошибки {stats.error}</Badge>
        </div>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {showTabs ? (
        <QueueTabs
          value={tab}
          workCount={workTasks.length}
          completedCount={completedTasks.length}
          onChange={selectTab}
        />
      ) : null}

      {full ? (
        loaded ? (
          <>
            {cards && tableTools ? <OwnerStatsTable stats={ownerStats} /> : null}
            <TasksTable
              tasks={pagedTasks}
              totalTasks={filteredTasks.length}
              queuePositions={queuePositions}
              query={query}
              page={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              selectedIds={selectedTaskIds}
              busyId={busyId}
              onStop={(taskId) => setConfirmAction({ kind: "stop", taskId })}
              onStart={(taskId) => setConfirmAction({ kind: "start", taskId })}
              onDetails={setDetailsTask}
              onDuplicate={openDuplicateTask}
              onDelete={() => setConfirmAction({ kind: "delete", taskIds: selectedTaskIds })}
              onQueryChange={changeQuery}
              onPageChange={changePage}
              onPageSizeChange={changePageSize}
              onToggleSelected={toggleSelected}
              onTogglePage={togglePage}
              canManage={canManage}
              currentUserName={currentUserName}
              tools={tableTools}
            />
          </>
        ) : (
          <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
            <QueueLoading />
          </section>
        )
      ) : (
        <>
          <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
            <div className="mb-4 grid gap-1">
              <h2 className="font-heading text-base font-medium">Задачи</h2>
              <p className="text-sm text-muted-foreground">
                Новые задачи сразу попадают сюда и крутятся в фоне. Полный список — в разделе «Очередь».
              </p>
            </div>
            {!loaded ? (
              <QueueLoading />
            ) : tasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Очередь пустая</p>
            ) : (
              <ul className="grid gap-2">
                {tasks.map((task) => {
                  const serviceMessage = taskServiceMessage(task)
                  return (
                    <li
                      key={task.id}
                      className="grid gap-2 rounded-xl border px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {actionLabel[task.action] || task.action} · {task.total} шт.
                        </p>
                        <TaskMetaList task={task} compact />
                      </div>
                      <div className="flex flex-wrap gap-1.5 md:justify-end">
                        <TaskCommentStatus task={task} />
                      </div>
                      <div className="md:col-span-2">
                        <ServiceMessage message={serviceMessage} compact />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
            <div className="mb-4 grid gap-1">
              <h2 className="font-heading text-base font-medium">Последние задания</h2>
            </div>
            {!loaded ? <QueueLoading /> : <JobTable jobs={recentJobs} />}
          </section>
        </>
      )}
      <TaskDetailsDialog task={detailsTask} onOpenChange={(open) => !open && setDetailsTask(null)} />
      <Dialog
        open={Boolean(duplicateTask)}
        onOpenChange={(open) => {
          if (!open) {
            setDuplicateTask(null)
            setDuplicateUrls("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Скопировать задачу</DialogTitle>
            <DialogDescription>
              Комментарии, фанки и вложения сохранятся. Замени только ссылку на дубль поста.
            </DialogDescription>
          </DialogHeader>
          {duplicateTask ? (
            <div className="grid gap-4">
              <div className="grid gap-2 rounded-xl border bg-muted/25 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{actionLabel[duplicateTask.action] || duplicateTask.action}</Badge>
                  <Badge variant="secondary">{duplicateTask.total} коммент.</Badge>
                </div>
                <p className="text-muted-foreground">
                  Старых постов: {uniqueTaskUrls(duplicateTask).length}. Если вставить одну ссылку, она заменит пост во всех комментариях.
                </p>
              </div>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Новая ссылка на пост</span>
                <Textarea
                  value={duplicateUrls}
                  onChange={(event) => setDuplicateUrls(event.target.value)}
                  placeholder="https://www.facebook.com/..."
                  rows={4}
                />
                <span className="text-xs text-muted-foreground">
                  Для задачи с несколькими постами можно вставить несколько ссылок, каждая с новой строки.
                </span>
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Отмена
            </DialogClose>
            <Button
              type="button"
              disabled={!duplicateUrls.trim() || busyId === duplicateTask?.id}
              onClick={() => void handleDuplicateTask()}
            >
              {busyId === duplicateTask?.id ? <Loader2 className="animate-spin" /> : <CopyIcon />}
              Создать копию
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Отмена
            </DialogClose>
            <Button
              type="button"
              variant={confirmAction?.kind === "start" ? "default" : "destructive"}
              onClick={() => void runConfirmedAction()}
            >
              {confirmAction?.kind === "start" ? <Play /> : confirmAction?.kind === "stop" ? <Square /> : <Trash2Icon />}
              {confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
