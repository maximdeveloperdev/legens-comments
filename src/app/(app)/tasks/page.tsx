import { listAdsPowerProfiles } from "@/lib/adspower"
import { prisma } from "@/lib/db"
import { listFacebookFansByProfile } from "@/lib/facebook-fans"
import { profileDisplayGeo, profileTeamMarkerFromName } from "@/lib/profile-geo"
import { getActiveSession } from "@/lib/session"
import { TasksWorkspace } from "./tasks-workspace"

export const maxDuration = 180

type TasksPageProps = {
  searchParams: Promise<Record<string, string | undefined>>
}

async function teamMarkersForUser(userId: string | undefined, role: string | undefined) {
  if (!userId || role === "ADMIN") return null

  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { teamLeadId: userId },
        { buyers: { some: { userId } } },
      ],
    },
    select: { marker: true },
  })

  return new Set(["ALL", ...teams.map((team) => team.marker.trim().toUpperCase()).filter(Boolean)])
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const user = await getActiveSession()
  await searchParams
  const canManage = user?.role === "ADMIN"
  const [result, countryRows, allowedMarkers] = await Promise.all([
    listAdsPowerProfiles({ includeOpen: canManage }),
    prisma.country.findMany({
      orderBy: { nameRu: "asc" },
      select: { code: true, nameRu: true, flagSvg: true },
    }),
    teamMarkersForUser(user?.id, user?.role),
  ])
  const filteredAdsPowerProfiles = allowedMarkers
    ? result.profiles.filter((profile) => {
        const marker = profileTeamMarkerFromName(profile.name)
        return marker ? allowedMarkers.has(marker) : false
      })
    : result.profiles
  const fansByProfile = await listFacebookFansByProfile(filteredAdsPowerProfiles.map((profile) => profile.id))
  const countryCodes = new Set(countryRows.map((country) => country.code.toUpperCase()))
  const profiles = filteredAdsPowerProfiles.map((profile) => ({
    ...profile,
    fans: fansByProfile.get(profile.id) ?? [],
  }))
  const codes = [
    ...new Set(profiles.map((profile) => profileDisplayGeo(profile, countryCodes)).filter(Boolean)),
  ]
  const rows = countryRows.filter((country) => codes.includes(country.code.toUpperCase()))
  const countries = Object.fromEntries(
    rows.map((country) => [
      country.code.toUpperCase(),
      { name: country.nameRu, flagSvg: country.flagSvg },
    ]),
  )

  return (
    <TasksWorkspace
      profiles={profiles}
      countries={countries}
      error={result.ok ? undefined : result.message}
    />
  )
}
