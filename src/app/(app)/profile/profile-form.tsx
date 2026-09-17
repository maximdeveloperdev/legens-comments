"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Camera, ShieldCheck, ShieldOff } from "lucide-react"
import {
  cancelTwoFactorSetup,
  confirmTwoFactor,
  disableTwoFactor,
  startTwoFactor,
  updateProfileName,
  uploadAvatar,
} from "@/app/actions/profile"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "LC"
}

export function ProfileForm({
  user,
  setup,
}: {
  user: {
    name: string
    email: string
    role: "ADMIN" | "USER"
    twoFactorEnabled: boolean
    avatarUrl: string | null
  }
  setup: { qrDataUrl: string; secret: string } | null
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user.name)
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [qr, setQr] = useState(setup)
  const [code, setCode] = useState("")
  const [disableCode, setDisableCode] = useState("")

  async function saveName(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    const data = new FormData()
    data.set("name", name)
    const result = await updateProfileName(data)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  async function onAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setPending(true)
    setError(undefined)
    const data = new FormData()
    data.set("avatar", file)
    const result = await uploadAvatar(data)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.avatarUrl) setAvatarUrl(result.avatarUrl)
    router.refresh()
  }

  async function enableTwoFactor() {
    setPending(true)
    setError(undefined)
    const result = await startTwoFactor()
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.qrDataUrl && result.secret) {
      setQr({ qrDataUrl: result.qrDataUrl, secret: result.secret })
    }
  }

  async function confirmEnable(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    const data = new FormData()
    data.set("code", code)
    const result = await confirmTwoFactor(data)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setQr(null)
    setCode("")
    router.refresh()
  }

  async function cancelSetup() {
    setPending(true)
    await cancelTwoFactorSetup()
    setPending(false)
    setQr(null)
  }

  async function confirmDisable(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    const data = new FormData()
    data.set("code", disableCode)
    const result = await disableTwoFactor(data)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setDisableCode("")
    router.refresh()
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="justify-items-center text-center">
        <button
          type="button"
          className="relative"
          onClick={() => fileRef.current?.click()}
          aria-label="Загрузить фото"
        >
          <Avatar className="size-32 overflow-hidden after:rounded-full">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
            <AvatarFallback className="text-2xl">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="absolute right-0.5 bottom-0.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
            <Camera className="size-3" />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onAvatar}
        />
        <CardTitle>Профиль</CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={saveName}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="profile-name">Имя</FieldLabel>
              <Input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Роль</FieldLabel>
              <p className="text-sm font-medium">
                {user.role === "ADMIN" ? "Админ" : "Юзер"}
              </p>
            </Field>
            <Button type="submit" disabled={pending}>
              Сохранить имя
            </Button>
          </FieldGroup>
        </form>

        <div className="mt-8 grid gap-3 border-t pt-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">Google Authenticator</p>
              <p className="text-sm text-muted-foreground">Вход по коду из приложения</p>
            </div>
            <Badge variant={user.twoFactorEnabled ? "default" : "outline"}>
              {user.twoFactorEnabled ? "Включена" : "Выключена"}
            </Badge>
          </div>

          {!user.twoFactorEnabled && !qr ? (
            <Button type="button" variant="outline" disabled={pending} onClick={enableTwoFactor}>
              <ShieldCheck />
              Включить 2FA
            </Button>
          ) : null}

          {qr ? (
            <form onSubmit={confirmEnable} className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                Отсканируйте QR в Google Authenticator и введите код.
              </p>
              <Image
                src={qr.qrDataUrl}
                alt="QR-код Google Authenticator"
                width={176}
                height={176}
                unoptimized
                className="mx-auto size-44 rounded-lg bg-white p-2"
              />
              <p className="break-all text-center text-xs text-muted-foreground">
                Ключ: {qr.secret}
              </p>
              <Field>
                <FieldLabel htmlFor="totp-enable">Код из приложения</FieldLabel>
                <Input
                  id="totp-enable"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </Field>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={cancelSetup} disabled={pending}>
                  Отмена
                </Button>
                <Button type="submit" disabled={pending} className="flex-1">
                  Подтвердить
                </Button>
              </div>
            </form>
          ) : null}

          {user.twoFactorEnabled ? (
            <form onSubmit={confirmDisable} className="grid gap-3">
              <Field>
                <FieldLabel htmlFor="totp-disable">Код для выключения</FieldLabel>
                <Input
                  id="totp-disable"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={disableCode}
                  onChange={(event) => setDisableCode(event.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="outline" disabled={pending}>
                <ShieldOff />
                Выключить 2FA
              </Button>
            </form>
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
