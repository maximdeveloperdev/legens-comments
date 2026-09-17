import { listAdsPowerProfiles } from "@/lib/adspower"
import { prisma } from "@/lib/db"
import { listFacebookFansByProfile } from "@/lib/facebook-fans"
import { getActiveSession } from "@/lib/session"
import { ConstructorFarm } from "./constructor-farm"

export const maxDuration = 180

type ConstructorPageProps = {
  searchParams: Promise<{ tab?: string }>
}

function constructorTab(value: string | undefined) {
  if (value === "queue" || value === "vps") return value
  return "comments"
}

export default async function ConstructorPage({ searchParams }: ConstructorPageProps) {
  const user = await getActiveSession()
  const { tab } = await searchParams
  const result = await listAdsPowerProfiles()
  const fansByProfile = await listFacebookFansByProfile(result.profiles.map((profile) => profile.id))
  const profiles = result.profiles.map((profile) => ({
    ...profile,
    fans: fansByProfile.get(profile.id) ?? [],
  }))
  const codes = [
    ...new Set(profiles.map((profile) => profile.ipCountry).filter(Boolean)),
  ]
  const rows =
    codes.length > 0
      ? await prisma.country.findMany({
          where: { code: { in: codes } },
          select: { code: true, nameRu: true, flagSvg: true },
        })
      : []
  const countries = Object.fromEntries(
    rows.map((country) => [
      country.code,
      { name: country.nameRu, flagSvg: country.flagSvg },
    ]),
  )

  return (
    <ConstructorFarm
      profiles={profiles}
      countries={countries}
      error={result.ok ? undefined : result.message}
      canManage={user?.role === "ADMIN"}
      currentUserName={user?.name}
      initialTab={constructorTab(tab)}
    />
  )
}
