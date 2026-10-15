export function isSameOriginMutation(request: Request) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return false
  const origin = request.headers.get("Origin")
  if (!origin) return true
  try {
    const host = new URL(origin).host
    const expectedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0].trim() || request.headers.get("Host") || new URL(request.url).host
    return host === expectedHost
  } catch { return false }
}
