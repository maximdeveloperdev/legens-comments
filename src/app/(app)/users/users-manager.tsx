"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { UserRole } from "@prisma/client"
import { Camera, Eye, EyeOff, Pencil, Plus, RefreshCw, SearchIcon, ShieldOff, Trash2, UserX } from "lucide-react"
import {
  bulkUpdateUsers,
  createUser,
  deleteUser,
  updateUser,
} from "@/app/actions/users"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type UserRow = {
  id: string
  name: string
  email: string
  role: UserRole
  twoFactorEnabled: boolean
  active: boolean
  avatarUrl: string | null
}

type FormValues = {
  id?: string
  name: string
  email: string
  password: string
  role: UserRole
  twoFactorEnabled: boolean
  active: boolean
  avatarUrl: string | null
  avatarFile: File | null
}

const emptyForm: FormValues = {
  name: "",
  email: "",
  password: "",
  role: UserRole.USER,
  twoFactorEnabled: false,
  active: true,
  avatarUrl: null,
  avatarFile: null,
}

const passwordAlphabet =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"

function generatePassword(length = 12) {
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => passwordAlphabet[byte % passwordAlphabet.length]).join("")
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "LC"
}

export function UsersManager({
  users,
  currentUserId,
}: {
  users: UserRow[]
  currentUserId: string
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormValues>(emptyForm)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkError, setBulkError] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)

  const isEdit = Boolean(form.id)
  const avatarPreviewUrl = useMemo(
    () =>
      form.avatarFile
        ? URL.createObjectURL(form.avatarFile)
        : form.avatarUrl ?? "",
    [form.avatarFile, form.avatarUrl],
  )

  useEffect(() => {
    if (!form.avatarFile || !avatarPreviewUrl) return
    return () => URL.revokeObjectURL(avatarPreviewUrl)
  }, [avatarPreviewUrl, form.avatarFile])

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return users
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle),
    )
  }, [users, query])

  const selectedInView = selectedIds.filter((id) =>
    filteredUsers.some((user) => user.id === id),
  )
  const allVisibleSelected =
    filteredUsers.length > 0 && selectedInView.length === filteredUsers.length

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
    )
  }

  function toggleAllVisible(checked: boolean) {
    const visibleIds = filteredUsers.map((user) => user.id)
    setSelectedIds((current) => {
      if (checked) {
        return [...new Set([...current, ...visibleIds])]
      }
      return current.filter((id) => !visibleIds.includes(id))
    })
  }

  async function onBulk(action: "twoFactor" | "active") {
    if (!selectedInView.length) return
    setBulkPending(true)
    setBulkError(undefined)
    const data = new FormData()
    for (const id of selectedInView) {
      data.append("ids", id)
    }
    if (action === "twoFactor") data.set("disableTwoFactor", "true")
    if (action === "active") data.set("disableActive", "true")
    const result = await bulkUpdateUsers(data)
    setBulkPending(false)
    if (result.error) {
      setBulkError(result.error)
      return
    }
    setSelectedIds([])
  }

  function openCreate() {
    setForm({ ...emptyForm, password: generatePassword() })
    setError(undefined)
    setShowPassword(true)
    setOpen(true)
  }

  function openEdit(user: UserRow) {
    setForm({
      id: user.id,
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
      active: user.active,
      avatarUrl: user.avatarUrl,
      avatarFile: null,
    })
    setError(undefined)
    setShowPassword(false)
    setOpen(true)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(undefined)

    const data = new FormData()
    if (form.id) data.set("id", form.id)
    data.set("name", form.name)
    data.set("email", form.email)
    data.set("password", form.password)
    data.set("role", form.role)
    if (form.id) data.set("twoFactorEnabled", String(form.twoFactorEnabled))
    data.set("active", String(form.active))
    if (form.avatarFile) data.set("avatar", form.avatarFile)

    const result = form.id ? await updateUser(data) : await createUser(data)
    setPending(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setOpen(false)
  }

  async function onDelete(id: string) {
    if (!confirm("Удалить пользователя?")) return
    const data = new FormData()
    data.set("id", id)
    const result = await deleteUser(data)
    if (result.error) {
      alert(result.error)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по имени или почте"
              className="pl-8"
              aria-label="Поиск юзеров"
            />
          </div>
          <Button type="button" onClick={openCreate} className="sm:w-auto">
            <Plus />
            Добавить
          </Button>
        </div>
        {selectedInView.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2">
            <span className="px-2 text-sm text-muted-foreground">
              Выбрано: {selectedInView.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bulkPending}
              onClick={() => onBulk("twoFactor")}
            >
              <ShieldOff />
              Выключить 2FA
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bulkPending}
              onClick={() => onBulk("active")}
            >
              <UserX />
              Выключить активность
            </Button>
            {bulkError ? (
              <p className="text-sm text-destructive" role="alert">
                {bulkError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={!allVisibleSelected && selectedInView.length > 0}
                onCheckedChange={(checked) => toggleAllVisible(checked)}
                aria-label="Выбрать всех"
              />
            </TableHead>
            <TableHead>Имя</TableHead>
            <TableHead>Почта</TableHead>
            <TableHead>Роль</TableHead>
            <TableHead>2FA</TableHead>
            <TableHead>Активность</TableHead>
            <TableHead className="text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredUsers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                Никого не нашли
              </TableCell>
            </TableRow>
          ) : (
            filteredUsers.map((user) => (
              <TableRow
                key={user.id}
                data-state={selectedIds.includes(user.id) ? "selected" : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.includes(user.id)}
                    onCheckedChange={(checked) => toggleSelected(user.id, checked)}
                    aria-label={`Выбрать ${user.name}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar>
                      {user.avatarUrl ? (
                        <AvatarImage src={user.avatarUrl} alt={user.name} />
                      ) : null}
                      <AvatarFallback>{initials(user.name)}</AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{user.name}</span>
                  </div>
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge variant={user.role === UserRole.ADMIN ? "default" : "secondary"}>
                    {user.role === UserRole.ADMIN ? "Админ" : "Юзер"}
                  </Badge>
                </TableCell>
                <TableCell>{user.twoFactorEnabled ? "Да" : "Нет"}</TableCell>
                <TableCell>
                  <Badge variant={user.active ? "default" : "outline"}>
                    {user.active ? "Активен" : "Выключен"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(user)}
                      aria-label="Редактировать"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDelete(user.id)}
                      disabled={user.id === currentUserId}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{isEdit ? "Редактировать юзера" : "Новый юзер"}</DialogTitle>
              <DialogDescription>
                Имя, фото, почта, пароль, роль, 2FA и активность.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="mt-4">
              <Field>
                <FieldLabel>Фото</FieldLabel>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="relative"
                    onClick={() => fileRef.current?.click()}
                    aria-label="Загрузить фото"
                  >
                    <Avatar className="size-14 after:rounded-full" size="lg">
                      {avatarPreviewUrl ? (
                        <AvatarImage src={avatarPreviewUrl} alt={form.name || "Фото"} />
                      ) : null}
                      <AvatarFallback>{initials(form.name)}</AvatarFallback>
                    </Avatar>
                    <span className="absolute right-0 bottom-0 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                      <Camera className="size-3" />
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                  >
                    Выбрать фото
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null
                      setForm((current) => ({ ...current, avatarFile: file }))
                    }}
                  />
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="user-name">Имя</FieldLabel>
                <Input
                  id="user-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-email">Почта</FieldLabel>
                <Input
                  id="user-email"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, email: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-password">Пароль</FieldLabel>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      id="user-password"
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                      placeholder={isEdit ? "Оставьте пустым, чтобы не менять" : ""}
                      className="pr-9"
                      required={!isEdit}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setForm((current) => ({
                        ...current,
                        password: generatePassword(),
                      }))
                      setShowPassword(true)
                    }}
                  >
                    <RefreshCw />
                    Сгенерировать
                  </Button>
                </div>
              </Field>
              <Field>
                <FieldLabel>Роль</FieldLabel>
                <Select
                  value={form.role}
                  onValueChange={(value) => {
                    if (value === UserRole.ADMIN || value === UserRole.USER) {
                      setForm((current) => ({ ...current, role: value }))
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UserRole.ADMIN}>Админ</SelectItem>
                    <SelectItem value={UserRole.USER}>Юзер</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {isEdit ? (
                <Field orientation="horizontal" className="items-center justify-between">
                  <div className="grid gap-1">
                    <FieldLabel htmlFor="user-2fa">2FA</FieldLabel>
                    {!form.twoFactorEnabled ? (
                      <p className="text-xs text-muted-foreground">
                        Включается пользователем в профиле
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    id="user-2fa"
                    checked={form.twoFactorEnabled}
                    disabled={!form.twoFactorEnabled}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({ ...current, twoFactorEnabled: checked }))
                    }
                  />
                </Field>
              ) : null}
              <Field orientation="horizontal" className="items-center justify-between">
                <FieldLabel htmlFor="user-active">Активность</FieldLabel>
                <Switch
                  id="user-active"
                  checked={form.active}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({ ...current, active: checked }))
                  }
                />
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
              <Button type="submit" disabled={pending}>
                {pending ? "Сохранение…" : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
