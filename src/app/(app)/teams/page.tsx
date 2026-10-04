import { UserRole } from "@prisma/client"
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
import { TeamsManager } from "./teams-manager"

export default async function TeamsPage() {
  const session = await requireAdminSession()
  if (!session) {
    redirect("/constructor")
  }

  const [teams, users] = await Promise.all([
    prisma.team.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        teamLead: {
          select: { id: true, name: true, email: true, role: true, active: true },
        },
        buyers: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true, active: true },
            },
          },
          orderBy: { user: { name: "asc" } },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        role: { in: [UserRole.TEAM_LEAD, UserRole.USER] },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    }),
  ])

  const teamLeads = users.filter((user) => user.role === UserRole.TEAM_LEAD)
  const buyers = users.filter((user) => user.role === UserRole.USER)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Команды</CardTitle>
          <CardDescription>
            Название команды, маркер, тимлид и байеры.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TeamsManager teams={teams} teamLeads={teamLeads} buyers={buyers} />
        </CardContent>
      </Card>
    </div>
  )
}
