export type NavItem = {
  title: string
  href: string
  items?: {
    title: string
    href: string
  }[]
}

export const dashboardNav: NavItem[] = [
  {
    title: "Конструктор",
    href: "/constructor",
  },
  {
    title: "Очередь",
    href: "/queue",
  },
  {
    title: "Юзеры",
    href: "/users",
  },
  {
    title: "Статистика",
    href: "/stats",
  },
  {
    title: "Настройки",
    href: "/settings",
    items: [
      { title: "Подписки", href: "/settings/subscription" },
      { title: "Логи действий в трекере", href: "/settings/tracker" },
      { title: "Логи действий Ads Power", href: "/settings/adspower" },
      { title: "Мониторинг сервера", href: "/settings/server" },
    ],
  },
]

function pathMatches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function getDashboardTitle(pathname: string) {
  if (pathMatches(pathname, "/profile")) {
    return "Профиль"
  }

  for (const item of dashboardNav) {
    const sub = item.items?.find((entry) => pathMatches(pathname, entry.href))
    if (sub) return sub.title
    if (pathMatches(pathname, item.href)) return item.title
  }

  return "Legends Comments"
}

export function isAppPath(pathname: string) {
  if (pathMatches(pathname, "/profile")) {
    return true
  }
  return dashboardNav.some(
    (item) =>
      pathMatches(pathname, item.href) ||
      item.items?.some((entry) => pathMatches(pathname, entry.href)),
  )
}
