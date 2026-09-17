import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getActiveSession } from "@/lib/session"

export default async function AppLayout({
  children,
}: {
  children: ReactNode
}) {
  const user = await getActiveSession()
  if (!user) {
    redirect("/")
  }

  return (
    <div className="min-h-svh bg-background [--header-height:calc(--spacing(14))]">
      <SidebarProvider className="flex min-h-svh flex-col">
        <SiteHeader userKey={user.id} />
        <div className="flex flex-1">
          <AppSidebar
            user={{
              name: user.name,
              email: user.email,
              avatar: user.avatarUrl ?? "",
              role: user.role,
            }}
          />
          <SidebarInset className="bg-background">{children}</SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  )
}
