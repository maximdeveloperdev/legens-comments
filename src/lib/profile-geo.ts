export function profileBracketTokens(name: string) {
  return [...name.matchAll(/\[([^\]]+)\]/g)]
    .map((match) => match[1]?.trim().toUpperCase() ?? "")
    .filter(Boolean)
}

export function profileTeamMarkerFromName(name: string) {
  return profileBracketTokens(name)[0] ?? ""
}

export function profileGeoFromName(name: string, knownCountryCodes?: Iterable<string>) {
  const tokens = profileBracketTokens(name)
  const candidates = (tokens.length > 1 ? tokens.slice(1) : tokens).filter((token) =>
    /^[A-Z]{2}$/.test(token),
  )
  if (candidates.length === 0) return ""

  const known = knownCountryCodes
    ? new Set([...knownCountryCodes].map((code) => code.toUpperCase()).filter(Boolean))
    : null
  if (!known || known.size === 0) return candidates[0] ?? ""

  return candidates.find((token) => known.has(token)) ?? candidates[0] ?? ""
}

export function profileDisplayGeo(
  profile: { name: string },
  knownCountryCodes?: Iterable<string>,
) {
  return profileGeoFromName(profile.name, knownCountryCodes)
}
