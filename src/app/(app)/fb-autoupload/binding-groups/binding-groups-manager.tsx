"use client"

import { useMemo, useState, useTransition } from "react"
import {
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"

import {
  createFbAutouploadBindingGroup,
  deleteFbAutouploadBindingGroup,
  updateFbAutouploadBindingGroup,
} from "@/app/actions/fb-autoupload"
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
  DialogTrigger,
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

import { autouploadPrimaryButtonClass } from "../ui"

export type BindingGroupRow = {
  id: number
  name: string
  bindingsCount: number
}

export function BindingGroupsManager({ groups }: { groups: BindingGroupRow[] }) {
  const [query, setQuery] = useState("")
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [editGroup, setEditGroup] = useState<BindingGroupRow | null>(null)
  const [deleteGroupTarget, setDeleteGroupTarget] =
    useState<BindingGroupRow | null>(null)
  const [name, setName] = useState("")
  const [editName, setEditName] = useState("")
  const [message, setMessage] = useState("")
  const [isPending, startTransition] = useTransition()

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return groups
    return groups.filter((group) =>
      `${group.id} ${group.name}`.toLowerCase().includes(needle),
    )
  }, [groups, query])

  const allSelected =
    filteredGroups.length > 0 &&
    filteredGroups.every((group) => selectedIds.includes(group.id))

  function toggleAll() {
    if (allSelected) {
      setSelectedIds((current) =>
        current.filter((id) => !filteredGroups.some((group) => group.id === id)),
      )
      return
    }

    setSelectedIds((current) => [
      ...current,
      ...filteredGroups
        .map((group) => group.id)
        .filter((id) => !current.includes(id)),
    ])
  }

  function toggleGroup(id: number) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id],
    )
  }

  function createGroup() {
    const formData = new FormData()
    formData.set("name", name)
    setMessage("")

    startTransition(async () => {
      const result = await createFbAutouploadBindingGroup(formData)
      if (result.error) {
        setMessage(result.error)
        return
      }
      setName("")
      setCreateOpen(false)
      setMessage("Группа создана")
    })
  }

  function openEditGroup(group: BindingGroupRow) {
    setEditGroup(group)
    setEditName(group.name)
    setMessage("")
  }

  function updateGroup() {
    if (!editGroup) return

    const formData = new FormData()
    formData.set("id", String(editGroup.id))
    formData.set("name", editName)
    setMessage("")

    startTransition(async () => {
      const result = await updateFbAutouploadBindingGroup(formData)
      if (result.error) {
        setMessage(result.error)
        return
      }
      setEditGroup(null)
      setEditName("")
      setMessage("Группа обновлена")
    })
  }

  function deleteGroup(id: number) {
    const formData = new FormData()
    formData.set("id", String(id))
    setMessage("")

    startTransition(async () => {
      const result = await deleteFbAutouploadBindingGroup(formData)
      if (result.error) {
        setMessage(result.error)
        return
      }
      setSelectedIds((current) => current.filter((currentId) => currentId !== id))
      setDeleteGroupTarget(null)
      setMessage("Группа удалена")
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-5 p-4 md:p-6">
      <h1 className="text-3xl font-normal tracking-normal text-foreground">
        Группы связок
      </h1>

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open)
            if (!open) setName("")
          }}
        >
          <DialogTrigger
            render={
              <Button type="button" className={autouploadPrimaryButtonClass}>
                Создать группу
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Создать группу</DialogTitle>
              <DialogDescription>
                Укажите название группы связок.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Название группы
              </label>
              <Input
                className="h-10 rounded-sm bg-white"
                value={name}
                autoFocus
                placeholder="Например, тест"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    createGroup()
                  }
                }}
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Отмена
              </DialogClose>
              <Button
                type="button"
                className={autouploadPrimaryButtonClass}
                disabled={isPending}
                onClick={createGroup}
              >
                Создать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <label className="flex items-center gap-3 self-end text-sm text-muted-foreground">
          Поиск:
          <Input
            className="h-10 w-56 rounded-sm bg-white"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <div className="mt-6 overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-transparent hover:bg-transparent">
              <TableHead className="w-12 px-0 text-center">
                <Checkbox
                  aria-label="Выбрать все группы"
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="w-28 text-center text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                <span className="inline-flex items-center gap-6">
                  ID
                  <ArrowUpDownIcon className="size-4 text-muted-foreground/40" />
                </span>
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                Название группы
              </TableHead>
              <TableHead className="w-36 text-center text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                <span className="inline-flex items-center gap-7">
                  <ArrowUpDownIcon className="size-4 text-muted-foreground/40" />
                  Связок
                  <ArrowUpDownIcon className="size-4 text-muted-foreground/40" />
                </span>
              </TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredGroups.length ? (
              filteredGroups.map((group) => (
                <TableRow
                  key={group.id}
                  className="h-24 border-b hover:bg-transparent"
                >
                  <TableCell className="px-0 text-center">
                    <Checkbox
                      aria-label={`Выбрать группу ${group.name}`}
                      checked={selectedIds.includes(group.id)}
                      onCheckedChange={() => toggleGroup(group.id)}
                    />
                  </TableCell>
                  <TableCell className="text-center text-base text-muted-foreground">
                    {group.id}
                  </TableCell>
                  <TableCell className="text-base text-muted-foreground">
                    {group.name}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="inline-flex items-center gap-1 text-primary">
                      <span className="text-base">{group.bindingsCount}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-primary hover:text-primary/80"
                        aria-label="Открыть связки в этой группе"
                      >
                        <ExternalLinkIcon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1 text-primary">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-primary hover:text-primary/80"
                        aria-label="Редактировать группу"
                        onClick={() => openEditGroup(group)}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-primary hover:text-primary/80"
                        aria-label="Удалить группу"
                        disabled={isPending}
                        onClick={() => setDeleteGroupTarget(group)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="h-24 border-b hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="text-center text-sm text-muted-foreground"
                >
                  Групп пока нет
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="grid items-center gap-4 text-sm text-muted-foreground md:grid-cols-3">
        <div className="flex items-center gap-3">
          <span>Показывать</span>
          <Input
            className="h-10 w-20 rounded-sm bg-white text-base text-foreground"
            defaultValue="100"
          />
          <span>на странице</span>
        </div>

        <p className="text-center">
          {filteredGroups.length
            ? `Группы с 1 до ${filteredGroups.length} из ${groups.length}`
            : "Группы с 0 до 0 из 0"}
        </p>

        <div className="flex items-center justify-end gap-4">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground/40"
            aria-label="Предыдущая страница"
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="font-medium text-muted-foreground">1</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground/40"
            aria-label="Следующая страница"
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog
        open={Boolean(editGroup)}
        onOpenChange={(open) => {
          if (!open) {
            setEditGroup(null)
            setEditName("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Редактировать группу</DialogTitle>
            <DialogDescription>
              Измените название группы связок.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Название группы
            </label>
            <Input
              className="h-10 rounded-sm bg-white"
              value={editName}
              autoFocus
              onChange={(event) => setEditName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  updateGroup()
                }
              }}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Отмена
            </DialogClose>
            <Button
              type="button"
              className={autouploadPrimaryButtonClass}
              disabled={isPending}
              onClick={updateGroup}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteGroupTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteGroupTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить группу?</DialogTitle>
            <DialogDescription>
              Группа {deleteGroupTarget?.name ?? ""} будет удалена. Это действие
              нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Отмена
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              className="h-10 rounded-lg px-5 text-sm"
              disabled={isPending || !deleteGroupTarget}
              onClick={() => {
                if (deleteGroupTarget) deleteGroup(deleteGroupTarget.id)
              }}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
