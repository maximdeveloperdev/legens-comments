"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import {
  BarChart3Icon,
  BlocksIcon,
  CloudUploadIcon,
  ClockIcon,
  CircleUserRoundIcon,
  FolderIcon,
  ImagesIcon,
  Link2Icon,
  ListOrderedIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  PanelsTopLeftIcon,
  Settings2Icon,
  ServerIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react"

import { NavMain, type NavMainItem } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { dashboardNav, type NavItem } from "@/lib/nav"

const icons = {
  "/constructor": <BlocksIcon />,
  "/queue": <ListOrderedIcon />,
  "/teams": <UsersIcon />,
  "/fan-page-library": <ImagesIcon />,
  "/accounts": <CircleUserRoundIcon />,
  "/accounts/ad-cabinets": <MegaphoneIcon />,
  "/accounts/pages": <PanelsTopLeftIcon />,
  "/accounts/proxies": <ServerIcon />,
  "/accounts/groups": <FolderIcon />,
  "/fb-autoupload": <CloudUploadIcon />,
  "/fb-autoupload/bindings": <Link2Icon />,
  "/fb-autoupload/binding-groups": <FolderIcon />,
  "/fb-autoupload/uploads": <UploadIcon />,
  "/users": <UsersIcon />,
  "/stats": <BarChart3Icon />,
  "/auto-rules": <ClockIcon />,
  "/templates": <MessageSquareTextIcon />,
  "/settings": <Settings2Icon />,
}

function filterNavItems(items: NavItem[], role: "ADMIN" | "TEAM_LEAD" | "USER"): NavItem[] {
  return items
    .filter((item) => {
      if (item.adminOnly && role !== "ADMIN") return false
      if (role === "ADMIN") return true
      return (
        item.href !== "/users" &&
        item.href !== "/teams" &&
        !item.href.startsWith("/settings")
      )
    })
    .map((item) => ({
      ...item,
      items: item.items ? filterNavItems(item.items, role) : undefined,
    }))
}

function addNavIcons(items: NavItem[]): NavMainItem[] {
  return items.map((item) => ({
    title: item.title,
    url: item.href,
    badge: item.badge,
    icon:
      item.title === "Фарм комментариев"
        ? <MessageSquareTextIcon />
        : icons[item.href as keyof typeof icons],
    items: item.items ? addNavIcons(item.items) : undefined,
  }))
}

export function AppSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: {
    name: string
    email: string
    avatar: string
    role: "ADMIN" | "TEAM_LEAD" | "USER"
  }
}) {
  const visibleNav = filterNavItems(dashboardNav, user.role)

  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/constructor" />}>
              <Image
                src="/icon.png"
                alt=""
                width={32}
                height={32}
                className="size-8 rounded-lg object-cover"
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Legends Tools</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={addNavIcons(visibleNav)} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
