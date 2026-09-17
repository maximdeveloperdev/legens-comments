"use client"

import { usePathname } from "next/navigation"
import { NotificationsMenu } from "@/components/notifications-menu"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useSidebar } from "@/components/ui/sidebar"
import { getDashboardTitle } from "@/lib/nav"
import { PanelLeftIcon } from "lucide-react"

export function SiteHeader({ userKey }: { userKey: string }) {
  const { toggleSidebar } = useSidebar()
  const pathname = usePathname()
  const title = getDashboardTitle(pathname)

  return (
    <header className="sticky top-0 z-50 flex w-full items-center border-b bg-background">
      <div className="flex h-(--header-height) w-full items-center gap-2 px-4">
        <Button
          type="button"
          className="h-8 w-8"
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
        >
          <PanelLeftIcon />
        </Button>
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <Breadcrumb className="hidden sm:block">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-1">
          <NotificationsMenu userKey={userKey} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
