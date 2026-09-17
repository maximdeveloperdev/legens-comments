"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import {
  BarChart3Icon,
  BlocksIcon,
  ListOrderedIcon,
  MessageSquareTextIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
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
import { dashboardNav } from "@/lib/nav"

const icons = {
  "/constructor": <BlocksIcon />,
  "/queue": <ListOrderedIcon />,
  "/users": <UsersIcon />,
  "/stats": <BarChart3Icon />,
  "/templates": <MessageSquareTextIcon />,
  "/settings": <Settings2Icon />,
}

export function AppSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: {
    name: string
    email: string
    avatar: string
    role: "ADMIN" | "USER"
  }
}) {
  const visibleNav = dashboardNav.filter((item) => {
    if (item.href === "/users" || item.href === "/settings") {
      return user.role === "ADMIN"
    }
    return true
  })

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
                <span className="truncate font-medium">Legends Comments</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={visibleNav.map((item) => ({
            title: item.title,
            url: item.href,
            icon: icons[item.href as keyof typeof icons],
            items: item.items?.map((sub) => ({
              title: sub.title,
              url: sub.href,
            })),
          }))}
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
