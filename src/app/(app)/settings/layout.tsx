import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { requireAdminSession } from "@/lib/session"

export default async function SettingsLayout({
  children,
}: {
  children: ReactNode
}) {
  const user = await requireAdminSession()
  if (!user) {
    redirect("/constructor")
  }

  return children
}
