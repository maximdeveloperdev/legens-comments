"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export type NavMainItem = {
  title: string
  url: string
  badge?: string
  icon?: ReactNode
  items?: NavMainItem[]
}

function pathMatches(pathname: string, url: string) {
  return pathname === url || pathname.startsWith(`${url}/`)
}

function itemIsActive(pathname: string, item: NavMainItem): boolean {
  return (
    pathMatches(pathname, item.url) ||
    Boolean(item.items?.some((sub) => itemIsActive(pathname, sub)))
  )
}

function NavCollapsibleItem({ item }: { item: NavMainItem }) {
  const pathname = usePathname()
  const active = itemIsActive(pathname, item)
  const [open, setOpen] = useState(active)

  return (
    <Collapsible
      className="group/collapsible"
      open={open}
      onOpenChange={setOpen}
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={
          <SidebarMenuButton tooltip={item.title} isActive={active} />
        }
      >
        {item.icon}
        <span>{item.title}</span>
        {item.badge ? (
          <Badge
            variant="secondary"
            className="ml-auto h-4 px-1.5 text-[10px] uppercase"
          >
            {item.badge}
          </Badge>
        ) : null}
        <ChevronRightIcon
          className={
            item.badge
              ? "ml-1 transition-transform duration-200 group-data-[open]/collapsible:rotate-90"
              : "ml-auto transition-transform duration-200 group-data-[open]/collapsible:rotate-90"
          }
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub className="gap-2 py-1.5">
          {item.items?.map((sub) => <NavSubItem key={sub.url} item={sub} />)}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

function NavSubItem({ item }: { item: NavMainItem }) {
  const pathname = usePathname()
  const active = itemIsActive(pathname, item)
  const [open, setOpen] = useState(active)

  if (item.items?.length) {
    return (
      <Collapsible
        className="group/sub-collapsible"
        open={open}
        onOpenChange={setOpen}
        render={<SidebarMenuSubItem />}
      >
        <CollapsibleTrigger
          render={
            <SidebarMenuSubButton
              isActive={active}
              render={<button type="button" />}
            />
          }
        >
          {item.icon}
          <span>{item.title}</span>
          {item.badge ? (
            <Badge
              variant="secondary"
              className="ml-auto h-4 px-1.5 text-[10px] uppercase"
            >
              {item.badge}
            </Badge>
          ) : null}
          <ChevronRightIcon
            className={
              item.badge
                ? "ml-1 transition-transform duration-200 group-data-[open]/sub-collapsible:rotate-90"
                : "ml-auto transition-transform duration-200 group-data-[open]/sub-collapsible:rotate-90"
            }
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mx-2 gap-1 py-1">
            {item.items.map((sub) => (
              <NavSubItem key={sub.url} item={sub} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={pathMatches(pathname, item.url)}
        render={<Link href={item.url} />}
      >
        {item.icon}
        <span>{item.title}</span>
        {item.badge ? (
          <Badge
            variant="secondary"
            className="ml-auto h-4 px-1.5 text-[10px] uppercase"
          >
            {item.badge}
          </Badge>
        ) : null}
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

export function NavMain({
  items,
}: {
  items: NavMainItem[]
}) {
  const pathname = usePathname()

  return (
    <SidebarGroup>
      <SidebarMenu className="gap-1.5">
        {items.map((item) =>
          item.items?.length ? (
            <NavCollapsibleItem key={item.title} item={item} />
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                isActive={pathname === item.url}
                tooltip={item.title}
                render={<Link href={item.url} />}
              >
                {item.icon}
                <span>{item.title}</span>
                {item.badge ? (
                  <Badge
                    variant="secondary"
                    className="ml-auto h-4 px-1.5 text-[10px] uppercase"
                  >
                    {item.badge}
                  </Badge>
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ),
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
