export type AppNotification = {
  id: string
  title: string
  body: string
  createdAt: string
  readAt?: string
  href?: string
  tone?: "info" | "success" | "error" | "queue"
}

const DEFAULT_USER_KEY = "global"
export const APP_NOTIFICATIONS_KEY = "lc_notifications"
export const APP_NOTIFICATIONS_EVENT = "lc-notifications"

let activeUserKey = DEFAULT_USER_KEY

function storageKey(userKey = activeUserKey) {
  return `${APP_NOTIFICATIONS_KEY}:${userKey || DEFAULT_USER_KEY}`
}

export function setAppNotificationsUser(userKey: string) {
  activeUserKey = userKey || DEFAULT_USER_KEY
}

export function loadAppNotifications(userKey = activeUserKey): AppNotification[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(storageKey(userKey))
    if (!raw) return []
    const parsed = JSON.parse(raw) as AppNotification[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.body === "string" &&
        typeof item.createdAt === "string",
    )
  } catch {
    return []
  }
}

function persist(items: AppNotification[], userKey = activeUserKey) {
  localStorage.setItem(storageKey(userKey), JSON.stringify(items))
  window.dispatchEvent(new Event(APP_NOTIFICATIONS_EVENT))
}

export function pushAppNotification(
  title: string,
  body: string,
  options: Pick<AppNotification, "href" | "tone"> = {},
) {
  if (typeof window === "undefined") return
  const item: AppNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    body,
    createdAt: new Date().toISOString(),
    ...options,
  }
  persist([item, ...loadAppNotifications()].slice(0, 80))
}

export function markAppNotificationsRead(userKey = activeUserKey) {
  if (typeof window === "undefined") return
  const now = new Date().toISOString()
  persist(
    loadAppNotifications(userKey).map((item) =>
      item.readAt ? item : { ...item, readAt: now },
    ),
    userKey,
  )
}

export function clearAppNotifications(userKey = activeUserKey) {
  if (typeof window === "undefined") return
  persist([], userKey)
}
