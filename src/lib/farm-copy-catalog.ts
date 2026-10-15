import { listAdsPowerProfiles } from "@/lib/adspower"
import { getAllowedProfileTeamMarkers, isAdsPowerProfileAllowed } from "@/lib/adspower-profile-access"
import { prisma } from "@/lib/db"
import { listFacebookFansByProfile } from "@/lib/facebook-fans"
import { profileDisplayGeo } from "@/lib/profile-geo"
import type { ActiveSessionUser } from "@/lib/session"
import type { CopyFan } from "@/lib/farm-task-copy"

export async function getFarmCopyCatalog(user: ActiveSessionUser) {
  const [result, markers, countries] = await Promise.all([
    listAdsPowerProfiles({ includeOpen: false }), getAllowedProfileTeamMarkers(user),
    prisma.country.findMany({ orderBy: { nameRu: "asc" }, select: { code: true, nameRu: true, flagSvg: true } }),
  ])
  if (!result.ok) throw new Error("Не удалось загрузить доступные профили AdsPower. Попробуйте позже.")
  const profiles = result.profiles.filter((profile) => isAdsPowerProfileAllowed(profile, markers))
  const fansByProfile = await listFacebookFansByProfile(profiles.map((profile) => profile.id))
  const countryCodes = countries.map((country) => country.code.toUpperCase())
  const fans: CopyFan[] = profiles.flatMap((profile) => {
    const geo = profileDisplayGeo(profile, countryCodes) || "ZZ"
    const synced = fansByProfile.get(profile.id) ?? []
    return synced.length ? synced.map((fan) => ({
      id: fan.id, profileId: profile.id, name: fan.name, geo,
      gender: fan.gender === "MALE" || fan.gender === "FEMALE" ? fan.gender : "ANY",
    })) : [{ id: profile.id, profileId: profile.id, name: profile.name, geo, gender: "ANY" }]
  })
  const geos = [...new Set(fans.map((fan) => fan.geo))]
  return { fans, geos, countries: Object.fromEntries(countries.filter((row) => geos.includes(row.code.toUpperCase()))
    .map((row) => [row.code.toUpperCase(), { name: row.nameRu, flagSvg: row.flagSvg }])) }
}
