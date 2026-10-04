"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { UserRole } from "@prisma/client"
import { Pencil, Plus, SearchIcon, Trash2, UsersRound } from "lucide-react"
import { createTeam, deleteTeam, updateTeam } from "@/app/actions/teams"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type UserOption = {
  id: string
  name: string
  email: string
  role: UserRole
}

export type TeamRow = {
  id: string
  name: string
  marker: string
  teamLeadId: string | null
  teamLead: (UserOption & { active: boolean }) | null
  buyers: {
    userId: string
    user: UserOption & { active: boolean }
  }[]
}

type TeamForm = {
  id?: string
  name: string
  marker: string
  teamLeadId: string
  buyerIds: string[]
}

const emptyForm: TeamForm = {
  name: "",
  marker: "",
  teamLeadId: "",
  buyerIds: [],
}

function userLine(user: Pick<UserOption, "name" | "email">) {
  return `${user.name} · ${user.email}`
}

function matchesUser(user: Pick<UserOption, "name" | "email">, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return userLine(user).toLowerCase().includes(needle)
}

export function TeamsManager({
  teams,
  teamLeads,
  buyers,
}: {
  teams: TeamRow[]
  teamLeads: UserOption[]
  buyers: UserOption[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [buyerQuery, setBuyerQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<TeamForm>(emptyForm)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()

  const filteredTeams = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return teams
    return teams.filter((team) => {
      const buyerNames = team.buyers.map(({ user }) => userLine(user)).join(" ")
      return `${team.name} ${team.marker} ${team.teamLead?.name ?? ""} ${buyerNames}`
        .toLowerCase()
        .includes(needle)
    })
  }, [teams, query])

  const filteredBuyers = useMemo(
    () => buyers.filter((buyer) => matchesUser(buyer, buyerQuery)),
    [buyers, buyerQuery],
  )
  const selectedTeamLead = useMemo(
    () => teamLeads.find((teamLead) => teamLead.id === form.teamLeadId) ?? null,
    [form.teamLeadId, teamLeads],
  )

  function resetDialog() {
    setForm(emptyForm)
    setBuyerQuery("")
    setError("")
  }

  function openCreate() {
    setForm({
      ...emptyForm,
      teamLeadId: teamLeads[0]?.id ?? "",
    })
    setBuyerQuery("")
    setError("")
    setMessage("")
    setOpen(true)
  }

  function openEdit(team: TeamRow) {
    setForm({
      id: team.id,
      name: team.name,
      marker: team.marker,
      teamLeadId: team.teamLeadId ?? "",
      buyerIds: team.buyers.map((buyer) => buyer.userId),
    })
    setBuyerQuery("")
    setError("")
    setMessage("")
    setOpen(true)
  }

  function toggleBuyer(id: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      buyerIds: checked
        ? [...new Set([...current.buyerIds, id])]
        : current.buyerIds.filter((value) => value !== id),
    }))
  }

  function submitTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setMessage("")

    const data = new FormData()
    if (form.id) data.set("id", form.id)
    data.set("name", form.name)
    data.set("marker", form.marker)
    data.set("teamLeadId", form.teamLeadId)
    for (const buyerId of form.buyerIds) {
      data.append("buyerIds", buyerId)
    }

    startTransition(async () => {
      const result = form.id ? await updateTeam(data) : await createTeam(data)
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
      resetDialog()
      setMessage(form.id ? "Команда обновлена" : "Команда создана")
      router.refresh()
    })
  }

  function removeTeam(team: TeamRow) {
    if (!confirm(`Удалить команду «${team.name}»?`)) return
    const data = new FormData()
    data.set("id", team.id)
    setError("")
    setMessage("")
    startTransition(async () => {
      const result = await deleteTeam(data)
      if (result.error) {
        setMessage(result.error)
        return
      }
      setMessage("Команда удалена")
      router.refresh()
    })
  }

  return (
    <>
      <div className="mb-4 grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по команде, маркеру, тимлиду или байеру"
              className="pl-8"
              aria-label="Поиск команд"
            />
          </div>
          <Button
            type="button"
            onClick={openCreate}
            disabled={teamLeads.length === 0 || isPending}
            className="sm:w-auto"
          >
            <Plus />
            Добавить
          </Button>
        </div>
        {teamLeads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Сначала создайте пользователя с ролью «Тимлид» в разделе «Юзеры».
          </p>
        ) : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Команда</TableHead>
            <TableHead>Маркер</TableHead>
            <TableHead>Тимлид</TableHead>
            <TableHead>Байеры</TableHead>
            <TableHead className="text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredTeams.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                Команд пока нет
              </TableCell>
            </TableRow>
          ) : (
            filteredTeams.map((team) => (
              <TableRow key={team.id}>
                <TableCell>
                  <div className="font-medium">{team.name}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{team.marker}</Badge>
                </TableCell>
                <TableCell>
                  {team.teamLead ? (
                    <div className="grid gap-0.5">
                      <span className="font-medium">{team.teamLead.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {team.teamLead.email}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Не назначен</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {team.buyers.slice(0, 3).map(({ user }) => (
                      <Badge key={user.id} variant="secondary">
                        {user.name}
                      </Badge>
                    ))}
                    {team.buyers.length > 3 ? (
                      <Badge variant="outline">+{team.buyers.length - 3}</Badge>
                    ) : null}
                    {team.buyers.length === 0 ? (
                      <span className="text-muted-foreground">Нет байеров</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(team)}
                      aria-label="Редактировать"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeTeam(team)}
                      disabled={isPending}
                      aria-label="Удалить"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) resetDialog()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submitTeam}>
            <DialogHeader>
              <DialogTitle>
                {form.id ? "Редактировать команду" : "Новая команда"}
              </DialogTitle>
              <DialogDescription>
                Укажите название, маркер, тимлида и байеров команды.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="mt-4">
              <Field>
                <FieldLabel htmlFor="team-name">Название команды</FieldLabel>
                <Input
                  id="team-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="team-marker">Маркер</FieldLabel>
                <Input
                  id="team-marker"
                  value={form.marker}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, marker: event.target.value }))
                  }
                  placeholder="Например, team-1"
                  required
                />
              </Field>
              <Field>
                <FieldLabel>Тимлид</FieldLabel>
                <Select
                  value={form.teamLeadId}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, teamLeadId: value ?? "" }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <span className="min-w-0 truncate text-left">
                      {selectedTeamLead
                        ? userLine(selectedTeamLead)
                        : "Выберите тимлида"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {teamLeads.map((teamLead) => (
                      <SelectItem key={teamLead.id} value={teamLead.id}>
                        {userLine(teamLead)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>Байеры</FieldLabel>
                  <span className="text-xs text-muted-foreground">
                    {form.buyerIds.length} выбрано
                  </span>
                </div>
                <div className="rounded-lg border">
                  <div className="relative border-b">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={buyerQuery}
                      onChange={(event) => setBuyerQuery(event.target.value)}
                      placeholder="Поиск байера"
                      className="border-0 pl-8 focus-visible:ring-0"
                      aria-label="Поиск байеров"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto p-2">
                    {filteredBuyers.length === 0 ? (
                      <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                        <UsersRound className="size-4" />
                        Байеров не нашли
                      </div>
                    ) : (
                      filteredBuyers.map((buyer) => (
                        <label
                          key={buyer.id}
                          className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
                        >
                          <Checkbox
                            checked={form.buyerIds.includes(buyer.id)}
                            onCheckedChange={(checked) =>
                              toggleBuyer(buyer.id, checked === true)
                            }
                            aria-label={`Выбрать ${buyer.name}`}
                          />
                          <span className="grid min-w-0">
                            <span className="truncate font-medium">{buyer.name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {buyer.email}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </Field>
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Сохранение…" : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
