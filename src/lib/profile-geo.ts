export function profileGeoFromName(name: string) {
  const match = name.match(/^\s*\[([a-z]{2})\]/i)
  return match ? match[1].toUpperCase() : ""
}

export function profileDisplayGeo(profile: { name: string }) {
  return profileGeoFromName(profile.name)
}
