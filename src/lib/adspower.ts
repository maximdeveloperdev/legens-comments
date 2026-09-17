const DEFAULT_URL = "http://127.0.0.1:50325"

type AdsPowerResponse<T> = {
  code: number
  msg: string
  data?: T
}

export type AdsPowerConnection = {
  ok: boolean
  url: string
  message: string
  paidRequired?: boolean
  openBrowsers: AdsPowerOpenBrowser[]
}

export type AdsPowerOpenBrowser = {
  id: string
  name: string
  detail: string
}

export type AdsPowerFan = {
  id: string
  name: string
  position: number
  current: boolean
}

export type AdsPowerProfile = {
  id: string
  serial: string
  name: string
  groupName: string
  username: string
  ip: string
  ipCountry: string
  lastOpenAt: number
  createdAt: number
  open: boolean
  fans: AdsPowerFan[]
}

function baseUrl() {
  return (process.env.ADSPOWER_API_URL || DEFAULT_URL).replace(/\/$/, "")
}

let adspowerGate: Promise<void> = Promise.resolve()
let lastAdsPowerCall = 0

async function adspowerFetch<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<AdsPowerResponse<T>> {
  const run = async () => {
    const waitMs = 1100 - (Date.now() - lastAdsPowerCall)
    if (waitMs > 0) await wait(waitMs)
    lastAdsPowerCall = Date.now()

    const key = process.env.ADSPOWER_API_KEY
    const method = (init?.method ?? "GET").toUpperCase()
    const { timeoutMs, ...request } = init ?? {}
    const res = await fetch(`${baseUrl()}${path}`, {
      ...request,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        ...request.headers,
      },
      cache: "no-store",
      signal: request.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
    })

    return (await res.json()) as AdsPowerResponse<T>
  }

  const pending = adspowerGate.then(run, run)
  adspowerGate = pending.then(
    () => undefined,
    () => undefined,
  )
  return pending
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function asList(value: unknown) {
  if (Array.isArray(value)) return value
  const data = asRecord(value)
  return Array.isArray(data.list) ? data.list : []
}

function unixSeconds(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function mapProfile(item: unknown, openIds: Set<string>): AdsPowerProfile {
  const row = asRecord(item)
  const id = String(row.user_id ?? row.profile_id ?? "")
  const proxy = asRecord(row.user_proxy_config)
  const country = String(
    row.ip_country || proxy.proxy_country || proxy.country || "",
  ).toUpperCase()
  return {
    id,
    serial: String(row.serial_number ?? ""),
    name: String(row.name ?? `Профиль ${id}`),
    groupName: String(row.group_name ?? ""),
    username: String(row.username ?? ""),
    ip: String(row.ip ?? ""),
    ipCountry: country,
    lastOpenAt: unixSeconds(row.last_open_time),
    createdAt: unixSeconds(row.created_time),
    open: openIds.has(id),
    fans: [],
  }
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function listAdsPowerProfiles(): Promise<{
  ok: boolean
  message: string
  profiles: AdsPowerProfile[]
}> {
  if (!process.env.ADSPOWER_API_KEY) {
    return { ok: false, message: "Нет ADSPOWER_API_KEY в .env", profiles: [] }
  }

  try {
    const status = await adspowerFetch<unknown>("/status")
    if (status.code !== 0) {
      return { ok: false, message: status.msg || "AdsPower не отвечает", profiles: [] }
    }

    const active = await adspowerFetch<{ list?: unknown[] }>("/api/v1/browser/local-active")
    const openIds = new Set(
      asList(active.data).map((item) => {
        const row = asRecord(item)
        return String(row.user_id ?? row.profile_id ?? "")
      }).filter(Boolean),
    )

    const pageSize = 100
    const rows: AdsPowerProfile[] = []
    let page = 1

    while (page <= 50) {
      if (page > 1) await wait(1100)
      const result = await adspowerFetch<{ list?: unknown[]; page?: number; page_size?: number }>(
        `/api/v1/user/list?page=${page}&page_size=${pageSize}`,
      )
      if (result.code !== 0) {
        return {
          ok: false,
          message: result.msg || "Не удалось получить профили",
          profiles: rows,
        }
      }

      const chunk = asList(result.data).map((item) => mapProfile(item, openIds))
      rows.push(...chunk)
      if (chunk.length < pageSize) break
      page += 1
    }

    return { ok: true, message: "OK", profiles: rows }
  } catch {
    return {
      ok: false,
      message: "Не удалось достучаться до Local API. AdsPower должен быть запущен на этом компьютере.",
      profiles: [],
    }
  }
}

function alreadyOpen(message: string) {
  return /already|is running|opened|открыт|вже відкрит/i.test(message)
}

function alreadyClosed(message: string) {
  return /not open|not running|is not open|не открыт|не відкрит/i.test(message)
}

function startFailed(message: string) {
  return /failed to start|не вдалося запустити|не удалось запустить|100001/i.test(message)
}

function startErrorMessage(message: string) {
  if (startFailed(message)) {
    return "AdsPower не смог открыть профиль (100001): занят прошлым запуском или ещё закрывается."
  }
  return message || "Не удалось запустить профиль"
}

function extractPort(value: string) {
  const match = value.match(/(?:127\.0\.0\.1|localhost):(\d+)/i)
  return match?.[1] ?? ""
}

function debugFromRecord(row: Record<string, unknown>) {
  const ws = asRecord(row.ws)
  const browserWs = String(ws.puppeteer ?? row.puppeteer ?? "").trim()
  const selenium = String(ws.selenium ?? row.selenium ?? "").trim()
  const debugPort =
    String(row.debug_port ?? row.debugPort ?? "").trim() ||
    extractPort(browserWs) ||
    extractPort(selenium)
  return {
    browserWs: browserWs || undefined,
    debugPort: debugPort || undefined,
  }
}

function hasDebug(debug: { browserWs?: string; debugPort?: string }) {
  return Boolean(debug.browserWs || debug.debugPort)
}

async function lookupActiveDebug(userId: string) {
  const active = await adspowerFetch<unknown>("/api/v1/browser/local-active")
  for (const item of asList(active.data)) {
    const row = asRecord(item)
    const id = String(row.user_id ?? row.profile_id ?? "")
    if (id !== userId) continue
    return { open: true, ...debugFromRecord(row) }
  }
  return { open: false, browserWs: undefined, debugPort: undefined }
}

export type AdsPowerStartResult = {
  ok: boolean
  message: string
  browserWs?: string
  debugPort?: string
}

export async function startAdsPowerBrowser(userId: string): Promise<AdsPowerStartResult> {
  const id = userId.trim()
  if (!id) {
    return { ok: false, message: "Нет ID профиля" }
  }

  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      if (attempt > 1) await wait(4000 * attempt)

      await stopAdsPowerBrowser(id)
      await wait(attempt === 1 ? 4000 : 6000)

      const params = new URLSearchParams({
        user_id: id,
        headless: "1",
        ip_tab: "0",
        open_tabs: "1",
      })
      const result = await adspowerFetch<{
        ws?: { puppeteer?: string; selenium?: string }
        debug_port?: string
      }>(`/api/v1/browser/start?${params.toString()}`, { timeoutMs: 90_000 })
      let debug = debugFromRecord(asRecord(result.data))
      const msg = result.msg || ""

      if (!hasDebug(debug)) {
        await wait(2500)
        const launched = await lookupActiveDebug(id)
        if (hasDebug(launched)) debug = launched
      }

      if (hasDebug(debug)) {
        return {
          ok: true,
          message: msg || "Запущен headless",
          browserWs: debug.browserWs,
          debugPort: debug.debugPort,
        }
      }

      if (result.code === 0 || alreadyOpen(msg) || startFailed(msg)) {
        continue
      }

      return { ok: false, message: startErrorMessage(msg) }
    }

    return {
      ok: false,
      message: "AdsPower не смог открыть профиль (100001): занят прошлым запуском или ещё закрывается.",
    }
  } catch {
    return { ok: false, message: "Не удалось запустить профиль. AdsPower должен быть запущен." }
  }
}

export async function stopAdsPowerBrowser(userId: string): Promise<{ ok: boolean; message: string }> {
  const id = userId.trim()
  if (!id) {
    return { ok: false, message: "Нет ID профиля" }
  }

  try {
    const before = await lookupActiveDebug(id)
    const result = await adspowerFetch<unknown>(
      `/api/v1/browser/stop?user_id=${encodeURIComponent(id)}`,
      { timeoutMs: 30_000 },
    )
    const msg = result.msg || ""

    if (!before.open && (result.code === 0 || alreadyClosed(msg))) {
      await wait(1500)
      return { ok: true, message: msg || "Остановлен" }
    }

    for (let step = 0; step < 12; step += 1) {
      await wait(1200)
      const active = await lookupActiveDebug(id)
      if (!active.open) {
        await wait(2500)
        return { ok: true, message: msg || "Остановлен" }
      }
      if (step === 2 || step === 6 || step === 10) {
        await adspowerFetch<unknown>(`/api/v1/browser/stop?user_id=${encodeURIComponent(id)}`, {
          timeoutMs: 30_000,
        })
      }
    }

    if (result.code === 0 || alreadyClosed(msg)) {
      await wait(2500)
      return { ok: true, message: msg || "Остановлен" }
    }
    return { ok: false, message: msg || "Не удалось остановить профиль" }
  } catch {
    return { ok: false, message: "Не удалось остановить профиль. AdsPower должен быть запущен." }
  }
}

export async function getAdsPowerConnection(): Promise<AdsPowerConnection> {
  const url = baseUrl()

  if (!process.env.ADSPOWER_API_KEY) {
    return {
      ok: false,
      url,
      message: "Нет ADSPOWER_API_KEY в .env",
      openBrowsers: [],
    }
  }

  try {
    const status = await adspowerFetch<unknown>("/status")
    if (status.code !== 0) {
      return {
        ok: false,
        url,
        message: status.msg || "AdsPower не отвечает",
        openBrowsers: [],
      }
    }

    const active = await adspowerFetch<{ list?: unknown[] }>("/api/v1/browser/local-active")
    const openBrowsers = asList(active.data).map((item, index) => {
      const row = asRecord(item)
      const id = String(row.user_id ?? row.profile_id ?? row.serial_number ?? index)
      const name = String(row.name ?? row.username ?? `Профиль ${id}`)
      const serial = row.serial_number ? `№ ${String(row.serial_number)}` : id
      return { id, name, detail: serial }
    })

    return {
      ok: true,
      url,
      message: "API доступен. Тариф оплачен: профили, логи и Local API открыты.",
      paidRequired: false,
      openBrowsers,
    }
  } catch {
    return {
      ok: false,
      url,
      message: "Не удалось достучаться до Local API. AdsPower должен быть запущен на этом компьютере.",
      openBrowsers: [],
    }
  }
}
