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
  const known = knownCountryCodes
    ? new Set([...knownCountryCodes].map((code) => code.toUpperCase()))
    : null
  const geo = tokens.find((token) =>
    /^[A-Z]{2}$/.test(token) && (!known || known.has(token)),
  )
  return geo ?? ""
}

export function profileDisplayGeo(
  profile: { name: string },
  knownCountryCodes?: Iterable<string>,
) {
  return profileGeoFromName(profile.name, knownCountryCodes)
}
