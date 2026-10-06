import { UserRole } from "@prisma/client"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { getActiveSession } from "@/lib/session"
import { FanPageLibraryManager } from "./fan-page-library-manager"

export default async function FanPageLibraryPage() {
  const session = await getActiveSession()
  if (!session) {
    redirect("/")
  }

  const teamWhere =
    session.role === UserRole.ADMIN
      ? undefined
      : {
          OR: [
            { teamLeadId: session.id },
            { buyers: { some: { userId: session.id } } },
          ],
        }

  const [teams, countries] = await Promise.all([
    prisma.team.findMany({
      where: teamWhere,
      orderBy: { name: "asc" },
      select: { id: true, name: true, marker: true },
    }),
    prisma.country.findMany({
      orderBy: { nameRu: "asc" },
      select: { code: true, nameRu: true, flagSvg: true },
    }),
  ])

  const assets = await prisma.fanPageAsset.findMany({
    where:
      session.role === UserRole.ADMIN
        ? undefined
        : teams.length > 0
          ? { teamId: { in: teams.map((team) => team.id) } }
          : { id: "__none__" },
    orderBy: { createdAt: "desc" },
    include: {
      team: { select: { id: true, name: true, marker: true } },
      createdByUser: { select: { name: true } },
    },
  })

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="grid gap-1">
        <h1 className="font-heading text-lg font-medium">Библиотека Fan Page</h1>
        <p className="text-sm text-muted-foreground">
          Галерея аватарок и обложек, привязанная к командам и гео.
        </p>
      </div>
      <FanPageLibraryManager
        assets={assets.map((asset) => ({
          id: asset.id,
          createdAt: asset.createdAt.toISOString(),
          type: asset.type,
          gender: asset.gender,
          geoCode: asset.geoCode,
          url: asset.url,
          originalName: asset.originalName,
          size: asset.size,
          team: asset.team,
          createdByName: asset.createdByUser?.name ?? null,
        }))}
        teams={teams}
        countries={countries.map((country) => ({
          code: country.code,
          name: country.nameRu,
          flagSvg: country.flagSvg,
        }))}
        canDelete={session.role !== UserRole.USER}
      />
    </div>
  )
}
