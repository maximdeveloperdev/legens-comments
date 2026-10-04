export type NavItem = {
  title: string
  href: string
  adminOnly?: boolean
  badge?: string
  items?: NavItem[]
}

export const dashboardNav: NavItem[] = [
  {
    title: "Фарм комментариев",
    href: "/constructor",
    items: [
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
        title: "Команды",
        href: "/teams",
      },
      {
        title: "Библиотека Fan Page",
        href: "/fan-page-library",
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
    ],
  },
  {
    title: "Аккаунты",
    href: "/accounts",
    adminOnly: true,
    badge: "soon",
    items: [
      {
        title: "Аккаунты",
        href: "/accounts",
      },
      {
        title: "Рекламные кабинеты",
        href: "/accounts/ad-cabinets",
      },
      {
        title: "Страницы",
        href: "/accounts/pages",
      },
      {
        title: "Управление прокси",
        href: "/accounts/proxies",
      },
      {
        title: "Управление группами",
        href: "/accounts/groups",
      },
    ],
  },
  {
    title: "Автозалив",
    href: "/fb-autoupload",
    adminOnly: true,
    badge: "soon",
    items: [
      {
        title: "Связки",
        href: "/fb-autoupload/bindings",
      },
      {
        title: "Группы связок",
        href: "/fb-autoupload/binding-groups",
      },
      {
        title: "Заливы",
        href: "/fb-autoupload/uploads",
      },
    ],
  },
  {
    title: "Автоправила",
    href: "/auto-rules",
    adminOnly: true,
    badge: "soon",
  },
]

function pathMatches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function getDashboardTitle(pathname: string) {
  if (pathMatches(pathname, "/profile")) {
    return "Профиль"
  }

  const title = findDashboardTitle(dashboardNav, pathname)
  if (title) return title

  return "Legends Tools"
}

export function isAppPath(pathname: string) {
  if (pathMatches(pathname, "/profile")) {
    return true
  }
  return hasMatchingPath(dashboardNav, pathname)
}

function findDashboardTitle(items: NavItem[], pathname: string): string | null {
  for (const item of items) {
    const childTitle = item.items ? findDashboardTitle(item.items, pathname) : null
    if (childTitle) return childTitle
    if (pathMatches(pathname, item.href)) return item.title
  }

  return null
}

function hasMatchingPath(items: NavItem[], pathname: string): boolean {
  return items.some(
    (item) =>
      pathMatches(pathname, item.href) ||
      (item.items ? hasMatchingPath(item.items, pathname) : false),
  )
}
