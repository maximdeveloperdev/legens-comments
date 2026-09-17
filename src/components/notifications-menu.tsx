"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  BellIcon,
  CheckCheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  ListChecksIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  APP_NOTIFICATIONS_EVENT,
  clearAppNotifications,
  loadAppNotifications,
  markAppNotificationsRead,
  setAppNotificationsUser,
  type AppNotification,
} from "@/lib/app-notifications"
import { cn } from "cn"

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function notificationIcon(tone: AppNotification["tone"]) {
  if (tone === "success") return <CircleCheckIcon className="size-4" />
  if (tone === "error") return <CircleAlertIcon className="size-4" />
  if (tone === "queue") return <ListChecksIcon className="size-4" />
  return <InfoIcon className="size-4" />
}

function notificationTone(tone: AppNotification["tone"]) {
  if (tone === "success") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
  if (tone === "error") return "bg-destructive/10 text-destructive dark:bg-destructive/20"
  if (tone === "queue") return "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
  return "bg-muted text-muted-foreground"
}

export function NotificationsMenu({ userKey }: { userKey: string }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const unread = items.filter((item) => !item.readAt).length

  useEffect(() => {
    setAppNotificationsUser(userKey)
    function refresh() {
      setItems(loadAppNotifications(userKey))
    }
    refresh()
    window.addEventListener(APP_NOTIFICATIONS_EVENT, refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener(APP_NOTIFICATIONS_EVENT, refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [userKey])

  function markRead() {
    markAppNotificationsRead(userKey)
    setItems(loadAppNotifications(userKey))
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-8 gap-1.5 px-2"
        onClick={() => {
          setOpen(true)
          markRead()
        }}
        aria-label="Уведомления"
      >
        <span className="relative">
          <BellIcon />
          {unread > 0 ? (
            <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary" />
          ) : null}
        </span>
        <span className="min-w-4 tabular-nums">{unread}</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>Уведомления</SheetTitle>
            <SheetDescription>
              {items.length > 0
                ? `${items.length} всего, ${unread} новых`
                : "Новых событий пока нет"}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Сообщений нет
              </p>
            ) : (
              <ul className="divide-y">
                {items.map((item) => (
                  <li key={item.id} className={cn("px-4 py-3", !item.readAt && "bg-muted/35")}>
                    <div className="flex gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                          notificationTone(item.tone),
                        )}
                      >
                        {notificationIcon(item.tone)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium">{item.title}</p>
                          {!item.readAt ? <span className="mt-1 size-2 rounded-full bg-primary" /> : null}
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {formatWhen(item.createdAt)}
                          </span>
                          {item.href ? (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              render={<Link href={item.href} onClick={() => setOpen(false)} />}
                            >
                              Открыть
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <SheetFooter className="border-t">
            <div className="flex w-full gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={items.length === 0}
                onClick={markRead}
              >
                <CheckCheckIcon />
                Прочитано
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={items.length === 0}
                onClick={() => clearAppNotifications(userKey)}
              >
                Очистить
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
