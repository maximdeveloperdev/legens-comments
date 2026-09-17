import { redirect } from "next/navigation"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { prisma } from "@/lib/db"
import { requireAdminSession } from "@/lib/session"
import { UsersManager } from "./users-manager"

export default async function UsersPage() {
  const session = await requireAdminSession()
  if (!session) {
    redirect("/constructor")
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      twoFactorEnabled: true,
      active: true,
      avatarUrl: true,
    },
  })

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Юзеры</CardTitle>
          <CardDescription>
            Имя, фото, почта, пароль, роль, 2FA и активность.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsersManager users={users} currentUserId={session?.id ?? ""} />
        </CardContent>
      </Card>
    </div>
  )
}
