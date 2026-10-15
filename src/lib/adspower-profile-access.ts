import { UserRole } from "@prisma/client"
import { listAdsPowerProfiles } from "@/lib/adspower"
import { prisma } from "@/lib/db"
import { profileTeamMarkerFromName } from "@/lib/profile-geo"
import type { ActiveSessionUser } from "@/lib/session"

type ProfileAccessUser = Pick<ActiveSessionUser, "id" | "role">

export async function getAllowedProfileTeamMarkers(user: ProfileAccessUser) {
  if (user.role === UserRole.ADMIN) return null

  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { teamLeadId: user.id },
        { buyers: { some: { userId: user.id } } },
      ],
    },
    select: { marker: true },
  })
  return new Set(["ALL", ...teams.map((team) => team.marker.trim().toUpperCase()).filter(Boolean)])
}

export function isAdsPowerProfileAllowed(profile: { name: string }, allowedMarkers: Set<string> | null) {
  if (allowedMarkers === null) return true
  const marker = profileTeamMarkerFromName(profile.name)
  return Boolean(marker && allowedMarkers.has(marker))
}

export async function getFarmProfileAccessError(user: ProfileAccessUser, profileIds: string[]): Promise<string | null> {
  if (user.role === UserRole.ADMIN) return null
  const requested = new Set(profileIds.map((id) => id.trim()))
  if (requested.size === 0 || requested.has("")) return "Не выбраны профили для задачи"

  try {
    const [allowedMarkers, result] = await Promise.all([
      getAllowedProfileTeamMarkers(user),
      listAdsPowerProfiles({ includeOpen: false }),
    ])
    if (!result.ok) return "Не удалось проверить доступ к профилям AdsPower. Попробуйте позже."

    const allowedIds = new Set(result.profiles
      .filter((profile) => isAdsPowerProfileAllowed(profile, allowedMarkers))
      .map((profile) => profile.id))
    if ([...requested].some((id) => !allowedIds.has(id))) {
      return "Нет доступа к выбранным профилям. Используйте профили своей команды или общие ALL."
    }
    return null
  } catch {
    return "Не удалось проверить доступ к профилям AdsPower. Попробуйте позже."
  }
}
