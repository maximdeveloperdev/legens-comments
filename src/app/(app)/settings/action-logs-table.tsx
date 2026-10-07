"use client"

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { clearActionLogs } from "@/app/actions/action-logs"
import type { ActionLogSource } from "@/lib/action-log"
import { pushAppNotification } from "@/lib/app-notifications"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { ACTION_LOG_PAGE_SIZES } from "./action-logs-params"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type ActionLogRow = {
  date: string
  user: string
  action: string
  detail: string
}

type DebugImage = {
  filename: string
  url: string
}

const DEBUG_SCREENSHOT_RE = /(?:\/app)?\/\.debug\/facebook-errors\/([a-zA-Z0-9_.-]+\.png)\b/

function getDebugImage(detail: string): DebugImage | null {
  const match = detail.match(DEBUG_SCREENSHOT_RE)
  const filename = match?.[1]
  if (!filename) return null
  return {
    filename,
    url: `/api/facebook-debug/${encodeURIComponent(filename)}`,
  }
}

export function ActionLogsTable({
  emptyText,
  rows = [],
  clearSource,
  initialQuery = "",
  initialPage = 1,
  initialPageSize = 50,
}: {
  emptyText: string
  rows?: ActionLogRow[]
  clearSource?: ActionLogSource
  initialQuery?: string
  initialPage?: number
  initialPageSize?: number
}) {
  const router = useRouter()
  const safeInitialPageSize = ACTION_LOG_PAGE_SIZES.includes(
    initialPageSize as (typeof ACTION_LOG_PAGE_SIZES)[number],
  )
    ? initialPageSize
    : 50
  const [query, setQuery] = useState(initialQuery)
  const [page, setPage] = useState(Math.max(1, initialPage))
  const [pageSize, setPageSize] = useState(safeInitialPageSize)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState<DebugImage | null>(null)
  const [isClearing, startClear] = useTransition()
  const [isRefreshing, startRefresh] = useTransition()

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) =>
      [row.date, row.user, row.action, row.detail]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
  }, [query, rows])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const visibleRows = filteredRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )

  function syncUrl(next: { query?: string; page?: number; pageSize?: number }) {
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    const nextQuery = next.query ?? query
    const nextPage = next.page ?? page
    const nextPageSize = next.pageSize ?? pageSize

    if (nextQuery.trim()) url.searchParams.set("q", nextQuery.trim())
    else url.searchParams.delete("q")
    url.searchParams.set("page", String(nextPage))
    url.searchParams.set("size", String(nextPageSize))
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`)
  }

  function changeQuery(value: string) {
    setQuery(value)
    setPage(1)
    syncUrl({ query: value, page: 1 })
  }

  function changePageSize(value: number) {
    setPageSize(value)
    setPage(1)
    syncUrl({ page: 1, pageSize: value })
  }

  function changePage(value: number) {
    const nextPage = Math.max(1, Math.min(value, totalPages))
    setPage(nextPage)
    syncUrl({ page: nextPage })
  }

  function handleClearLogs() {
    if (!clearSource) return
    startClear(async () => {
      const result = await clearActionLogs(clearSource)
      if (result.error) {
        pushAppNotification("Очистка логов", result.error, { tone: "error" })
        return
      }
      setConfirmOpen(false)
      pushAppNotification("Логи очищены", `Удалено ${result.deleted ?? 0} записей`, {
        tone: "success",
      })
      router.refresh()
    })
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Поиск по дате, юзеру, действию или деталям"
            className="pl-8"
            aria-label="Поиск по логам"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {filteredRows.length} из {rows.length}
          </Badge>
          <select
            value={pageSize}
            onChange={(event) => changePageSize(Number(event.target.value))}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            aria-label="Строк на странице"
          >
            {ACTION_LOG_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / стр.
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isRefreshing}
            title="Обновить"
            aria-label="Обновить логи"
            onClick={() => startRefresh(() => router.refresh())}
          >
            <RefreshCwIcon className={isRefreshing ? "animate-spin" : undefined} />
          </Button>
          {clearSource ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              disabled={rows.length === 0 || isClearing}
              title="Очистить"
              aria-label="Очистить логи"
              onClick={() => setConfirmOpen(true)}
            >
              {isClearing ? <Trash2Icon className="animate-pulse" /> : <Trash2Icon />}
            </Button>
          ) : null}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Дата</TableHead>
            <TableHead>Пользователь</TableHead>
            <TableHead>Действие</TableHead>
            <TableHead>Детали</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                {rows.length === 0 ? emptyText : "По этому поиску ничего не найдено"}
              </TableCell>
            </TableRow>
          ) : (
            visibleRows.map((row, index) => {
              const debugImage = getDebugImage(row.detail)

              return (
                <TableRow key={`${row.date}-${row.user}-${currentPage}-${index}`}>
                  <TableCell className="whitespace-nowrap">{row.date}</TableCell>
                  <TableCell className="font-medium">{row.user}</TableCell>
                  <TableCell>{row.action}</TableCell>
                  <TableCell className="max-w-[560px] whitespace-normal text-muted-foreground">
                    <div className="grid gap-2">
                      <span className="break-words">{row.detail}</span>
                      {debugImage ? (
                        <button
                          type="button"
                          className="group flex w-fit max-w-full items-center gap-3 rounded-md border bg-background p-1 pr-3 text-left text-foreground shadow-sm transition hover:border-primary/50"
                          onClick={() => setPreviewImage(debugImage)}
                        >
                          <img
                            src={debugImage.url}
                            alt="Debug screenshot"
                            className="h-16 w-24 rounded object-cover"
                            loading="lazy"
                          />
                          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                            <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">Открыть debug-скрин</span>
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Страница {currentPage} из {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={currentPage <= 1}
            onClick={() => changePage(currentPage - 1)}
          >
            <ChevronLeftIcon />
            Назад
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={currentPage >= totalPages}
            onClick={() => changePage(currentPage + 1)}
          >
            Вперёд
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Очистить логи?</DialogTitle>
            <DialogDescription>
              Будут удалены все записи этого раздела. Действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isClearing} />}>
              Отмена
            </DialogClose>
            <Button type="button" variant="destructive" disabled={isClearing} onClick={handleClearLogs}>
              <Trash2Icon />
              Очистить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Debug-скрин Facebook</DialogTitle>
            <DialogDescription className="break-all">{previewImage?.filename}</DialogDescription>
          </DialogHeader>
          {previewImage ? (
            <div className="overflow-hidden rounded-lg border bg-muted">
              <img src={previewImage.url} alt={previewImage.filename} className="max-h-[75vh] w-full object-contain" />
            </div>
          ) : null}
          <DialogFooter>
            {previewImage ? (
              <Button type="button" variant="outline" render={<a href={previewImage.url} target="_blank" rel="noreferrer" />}>
                Открыть в новой вкладке
              </Button>
            ) : null}
            <DialogClose render={<Button type="button" />}>Закрыть</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
