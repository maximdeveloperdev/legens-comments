"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2,
  Play,
  SearchIcon,
  Square,
  Trash2Icon,
} from "lucide-react"
import { deleteFarmTasks, startFarmTask, stopFarmTask } from "@/app/actions/farm-queue"
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
  error: string | null
  taskId: string
}

type QueueTask = {
  id: string
  createdAt: string
  createdBy: string
  action: string
  total: number
  counts: QueueStats
  jobs: QueueJob[]
}

type QueueTab = "work" | "completed"
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

function formatClock(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })
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

const emptyStats: QueueStats = { pending: 0, running: 0, done: 0, error: 0 }

type QueueSnapshot = { stats: QueueStats; tasks: QueueTask[] }

let cachedQueue: QueueSnapshot | null = null

function rememberQueue(stats: QueueStats, tasks: QueueTask[]) {
  cachedQueue = { stats, tasks }
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

function TasksTable({
  tasks,
  totalTasks,
  query,
  page,
  totalPages,
  pageSize,
  selectedIds,
  busyId,
  onStop,
  onStart,
  onDelete,
  onQueryChange,
  onPageChange,
  onPageSizeChange,
  onToggleSelected,
  onTogglePage,
  canManage,
  tools = false,
}: {
  tasks: QueueTask[]
  totalTasks: number
  query: string
  page: number
  totalPages: number
  pageSize: number
  selectedIds: string[]
  busyId: string | null
  onStop: (taskId: string) => void
  onStart: (taskId: string) => void
  onDelete: () => void
  onQueryChange: (value: string) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onToggleSelected: (taskId: string, checked: boolean) => void
  onTogglePage: (checked: boolean) => void
  canManage: boolean
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
              <TableHead>Юзер</TableHead>
              <TableHead>Задача</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Время</TableHead>
              {canManage ? <TableHead className="text-right">Действия</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const status = taskStatus(task)
              const busy = busyId === task.id || busyId === "all"
              return (
                <TableRow key={task.id}>
                  {tools && canManage ? (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.includes(task.id)}
                        onCheckedChange={(checked) => onToggleSelected(task.id, Boolean(checked))}
                        aria-label={`Выбрать задачу ${task.id}`}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="whitespace-nowrap font-medium">{task.createdBy}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {actionLabel[task.action] || task.action} · {task.total} шт.
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatWhen(task.createdAt)}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
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
                      </div>
                    </TableCell>
                  ) : null}
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
}) {
  const safeInitialPageSize = PAGE_SIZES.includes(initialPageSize as (typeof PAGE_SIZES)[number])
    ? initialPageSize
    : 50
  const [stats, setStats] = useState<QueueStats>(() => cachedQueue?.stats ?? emptyStats)
  const [tasks, setTasks] = useState<QueueTask[]>(() => cachedQueue?.tasks ?? [])
  const [loaded, setLoaded] = useState(() => cachedQueue !== null)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<QueueTab>(initialTab)
  const [query, setQuery] = useState(initialQuery)
  const [page, setPage] = useState(Math.max(1, initialPage))
  const [pageSize, setPageSize] = useState(safeInitialPageSize)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const previousTaskTabs = useRef<Map<string, QueueTab> | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false

    async function load() {
      try {
        const response = await fetch("/api/farm-queue", { cache: "no-store" })
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
        rememberQueue(nextStats, nextTasks)
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
  }, [active, currentUserName])

  const recentJobs = useMemo(
    () =>
      tasks
        .flatMap((task) => task.jobs)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 120),
    [tasks],
  )
  const workTasks = useMemo(() => tasks.filter((task) => taskTab(task) === "work"), [tasks])
  const completedTasks = useMemo(
    () => tasks.filter((task) => taskTab(task) === "completed"),
    [tasks],
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
          job.message,
          job.error || "",
          statusLabel[job.status],
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [query, tableTools, visibleTasks])
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
    if (data.stats && data.tasks) rememberQueue(data.stats, data.tasks)
  }

  async function refreshQueue() {
    const response = await fetch("/api/farm-queue", { cache: "no-store" })
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
      void fetch("/api/farm-queue", { cache: "no-store" })
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
          <TasksTable
            tasks={pagedTasks}
            totalTasks={filteredTasks.length}
            query={query}
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            selectedIds={selectedTaskIds}
            busyId={busyId}
            onStop={(taskId) => setConfirmAction({ kind: "stop", taskId })}
            onStart={(taskId) => setConfirmAction({ kind: "start", taskId })}
            onDelete={() => setConfirmAction({ kind: "delete", taskIds: selectedTaskIds })}
            onQueryChange={changeQuery}
            onPageChange={changePage}
            onPageSizeChange={changePageSize}
            onToggleSelected={toggleSelected}
            onTogglePage={togglePage}
            canManage={canManage}
            tools={tableTools}
          />
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
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex h-10 items-center justify-between gap-3 overflow-hidden rounded-xl border px-3"
                  >
                    <p className="min-w-0 truncate text-sm">
                      <span className="font-medium">
                        {actionLabel[task.action] || task.action} · {task.total} шт.
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {task.createdBy} · {formatClock(task.createdAt)}
                      </span>
                    </p>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      ждёт {task.counts.pending} · идёт {task.counts.running} · ок {task.counts.done} ·
                      ошибки {task.counts.error}
                    </p>
                  </li>
                ))}
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
