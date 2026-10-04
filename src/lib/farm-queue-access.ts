import { UserRole, type Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import type { ActiveSessionUser } from "@/lib/session"

export type FarmQueueAccess =
  | { kind: "all" }
  | {
      kind: "restricted"
      createdByNames: string[]
      createdByUserIds: string[]
    }

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export async function getFarmQueueAccess(
  session: ActiveSessionUser,
  scope: "auto" | "own" = "auto",
): Promise<FarmQueueAccess> {
  if (scope !== "own" && session.role === UserRole.ADMIN) {
    return { kind: "all" }
  }

  const names = [session.name]
  const ids = [session.id]

  if (scope !== "own" && session.role === UserRole.TEAM_LEAD) {
    const teams = await prisma.team.findMany({
      where: { teamLeadId: session.id },
      include: {
        buyers: {
          include: {
            user: {
              select: { id: true, name: true, active: true },
            },
          },
        },
      },
    })

    for (const team of teams) {
      for (const buyer of team.buyers) {
        if (!buyer.user.active) continue
        ids.push(buyer.user.id)
        names.push(buyer.user.name)
      }
    }
  }

  return {
    kind: "restricted",
    createdByNames: unique(names),
    createdByUserIds: unique(ids),
  }
}

export function farmTaskAccessWhere(
  access: FarmQueueAccess,
): Prisma.FarmTaskWhereInput | undefined {
  if (access.kind === "all") return undefined

  const filters: Prisma.FarmTaskWhereInput[] = []
  if (access.createdByUserIds.length) {
    filters.push({ createdByUserId: { in: access.createdByUserIds } })
  }
  if (access.createdByNames.length) {
    filters.push({ createdBy: { in: access.createdByNames } })
  }

  return filters.length > 1 ? { OR: filters } : filters[0] ?? { id: "__none__" }
}
