"use client"

import { useActionState, useState } from "react"
import type { ComponentProps } from "react"
import Image from "next/image"
import { Eye, EyeOff, ShieldCheck } from "lucide-react"
import { cn } from "cn"

import { login, type AuthState } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const initialState: AuthState = {}

export function LoginForm({
  className,
  ...props
}: ComponentProps<"div">) {
  const [state, action, pending] = useActionState(login, initialState)
  const [showPassword, setShowPassword] = useState(false)
  const showTwoFactor = Boolean(state.twoFactor)

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-0">
          <form action={action} className="flex flex-col justify-center p-6 md:p-8">
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <Image src="/icon.png" alt="" width={40} height={40} className="size-10" />
                <h1 className="text-2xl font-bold">Вход</h1>
                <p className="text-balance text-muted-foreground">
                  {showTwoFactor
                    ? "Введите 6-значный код из Google Authenticator"
                    : "Войдите в Legends Comments"}
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="m@example.com"
                  autoComplete="email"
                  readOnly={showTwoFactor}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Пароль</FieldLabel>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="pr-9"
                    readOnly={showTwoFactor}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </Field>
              {showTwoFactor ? (
                <Field>
                  <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                    <ShieldCheck className="mt-0.5 size-4 text-muted-foreground" />
                    <div className="grid w-full gap-2">
                      <FieldLabel htmlFor="code">Код Google Authenticator</FieldLabel>
                      <Input
                        id="code"
                        name="code"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        autoComplete="one-time-code"
                        placeholder="000000"
                        autoFocus
                        required
                      />
                    </div>
                  </div>
                </Field>
              ) : null}
              {state.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {state.error}
                </p>
              ) : null}
              <Field>
                <Button type="submit" disabled={pending}>
                  {pending
                    ? "Проверяем..."
                    : showTwoFactor
                      ? "Подтвердить код"
                      : "Войти"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
