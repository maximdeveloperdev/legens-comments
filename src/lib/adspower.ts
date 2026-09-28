import net from "node:net"
import tls from "node:tls"

const DEFAULT_URL = "http://127.0.0.1:50325"

type AdsPowerResponse<T> = {
  code: number
  msg: string
  data?: T
}

type AdsPowerKernelDownload = {
  status?: string
  progress?: number
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

export type AdsPowerProxyCheckResult = {
  ok: boolean
  checked: boolean
  message: string
  proxy?: string
}

type AdsPowerProxyConfig = {
  type: string
  host: string
  port: number
  user: string
  password: string
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

function asMaybeJsonRecord(value: unknown) {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value) as unknown)
    } catch {
      return {}
    }
  }
  return asRecord(value)
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

function proxyConfigFromRecord(value: unknown): AdsPowerProxyConfig | null {
  const row = asMaybeJsonRecord(value)
  const proxySoft = String(row.proxy_soft ?? "").toLowerCase()
  const type = String(row.proxy_type ?? row.type ?? "").toLowerCase()
  if (proxySoft === "no_proxy" || type === "no_proxy") return null

  const host = String(row.proxy_host ?? row.host ?? "").trim()
  const port = Number(row.proxy_port ?? row.port ?? "")
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null

  return {
    type: type || "http",
    host,
    port,
    user: String(row.proxy_user ?? row.user ?? "").trim(),
    password: String(row.proxy_password ?? row.password ?? "").trim(),
  }
}

function proxyLabel(proxy: AdsPowerProxyConfig) {
  return `${proxy.type}://${proxy.host}:${proxy.port}`
}

async function findProfileRow(userId: string) {
  const pageSize = 100

  for (let page = 1; page <= 50; page += 1) {
    if (page > 1) await wait(1100)
    const result = await adspowerFetch<{ list?: unknown[] }>(
      `/api/v1/user/list?page=${page}&page_size=${pageSize}`,
      { timeoutMs: 30_000 },
    )
    if (result.code !== 0) {
      return { ok: false, message: result.msg || "Не удалось получить профиль AdsPower" }
    }

    const rows = asList(result.data)
    const found = rows.find((item) => {
      const row = asRecord(item)
      const id = String(row.user_id ?? row.profile_id ?? "")
      return id === userId
    })
    if (found) return { ok: true, row: asRecord(found) }
    if (rows.length < pageSize) break
  }

  return { ok: false, message: "Профиль AdsPower не найден" }
}

async function proxyFromProxyList(proxyId: string): Promise<AdsPowerProxyConfig | null> {
  if (!proxyId) return null

  const result = await adspowerFetch<{ list?: unknown[] }>(
    "/api/v2/proxy-list/list",
    {
      method: "POST",
      body: JSON.stringify({
        Proxy_id: [proxyId],
        proxy_id: [proxyId],
        page: "1",
        limit: "1",
      }),
      timeoutMs: 30_000,
    },
  )
  if (result.code !== 0) return null

  for (const item of asList(result.data)) {
    const row = asRecord(item)
    const id = String(row.proxy_id ?? row.id ?? "")
    if (!id || id === proxyId) {
      const proxy = proxyConfigFromRecord(row)
      if (proxy) return proxy
    }
  }

  return null
}

async function getProfileProxy(userId: string): Promise<{
  ok: boolean
  message: string
  proxy?: AdsPowerProxyConfig
  hasProxy: boolean
}> {
  const profile = await findProfileRow(userId)
  if (!profile.ok || !profile.row) {
    return { ok: false, message: profile.message || "Профиль AdsPower не найден", hasProxy: false }
  }

  const row = profile.row
  const direct = proxyConfigFromRecord(row.user_proxy_config) || proxyConfigFromRecord(row)
  if (direct) return { ok: true, message: "Прокси найден", proxy: direct, hasProxy: true }

  const proxyConfig = asMaybeJsonRecord(row.user_proxy_config)
  const proxyId = String(row.proxyid ?? row.proxy_id ?? proxyConfig.proxyid ?? proxyConfig.proxy_id ?? "").trim()
  const listed = await proxyFromProxyList(proxyId)
  if (listed) return { ok: true, message: "Прокси найден", proxy: listed, hasProxy: true }

  const proxySoft = String(proxyConfig.proxy_soft ?? "").toLowerCase()
  const proxyType = String(proxyConfig.proxy_type ?? "").toLowerCase()
  const hasProxy =
    Boolean(proxyId) ||
    (Boolean(proxySoft) && proxySoft !== "no_proxy") ||
    (Boolean(proxyType) && proxyType !== "no_proxy")

  if (hasProxy) {
    return {
      ok: true,
      message: "Прокси указан, но AdsPower не отдал host/port для проверки",
      hasProxy: true,
    }
  }

  return { ok: true, message: "Профиль без прокси", hasProxy: false }
}

function tcpConnect(host: string, port: number, timeoutMs: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error("timeout"))
    }, timeoutMs)

    socket.once("connect", () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function socketRead(socket: net.Socket, timeoutMs: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("timeout"))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off("data", onData)
      socket.off("error", onError)
      socket.off("end", onEnd)
    }
    const onData = (chunk: Buffer) => {
      cleanup()
      resolve(chunk)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onEnd = () => {
      cleanup()
      reject(new Error("connection closed"))
    }

    socket.once("data", onData)
    socket.once("error", onError)
    socket.once("end", onEnd)
  })
}

async function checkSocks5Proxy(proxy: AdsPowerProxyConfig) {
  const socket = await tcpConnect(proxy.host, proxy.port, 10_000)
  try {
    const methods = proxy.user ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00])
    socket.write(methods)
    const method = await socketRead(socket, 5000)
    if (method[0] !== 0x05 || method[1] === 0xff) {
      throw new Error("SOCKS5 proxy rejected auth methods")
    }

    if (method[1] === 0x02) {
      const user = Buffer.from(proxy.user)
      const password = Buffer.from(proxy.password)
      if (user.length > 255 || password.length > 255) {
        throw new Error("SOCKS5 proxy credentials are too long")
      }
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([password.length]), password]))
      const auth = await socketRead(socket, 5000)
      if (auth[1] !== 0x00) {
        throw new Error("SOCKS5 proxy auth failed")
      }
    }

    const host = Buffer.from("www.facebook.com")
    socket.write(
      Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
        host,
        Buffer.from([0x01, 0xbb]),
      ]),
    )
    const response = await socketRead(socket, 8000)
    if (response[0] !== 0x05 || response[1] !== 0x00) {
      throw new Error(`SOCKS5 connect failed (${response[1] ?? "no code"})`)
    }
  } finally {
    socket.destroy()
  }
}

async function checkHttpProxy(proxy: AdsPowerProxyConfig) {
  const isTlsProxy = proxy.type === "https"
  const socket = isTlsProxy
    ? await new Promise<tls.TLSSocket>((resolve, reject) => {
        const client = tls.connect({
          host: proxy.host,
          port: proxy.port,
          servername: proxy.host,
          rejectUnauthorized: false,
        })
        const timer = setTimeout(() => {
          client.destroy()
          reject(new Error("timeout"))
        }, 10_000)
        client.once("secureConnect", () => {
          clearTimeout(timer)
          resolve(client)
        })
        client.once("error", (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })
    : await tcpConnect(proxy.host, proxy.port, 10_000)

  try {
    const auth = proxy.user
      ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.user}:${proxy.password}`).toString("base64")}\r\n`
      : ""
    socket.write(
      `CONNECT www.facebook.com:443 HTTP/1.1\r\nHost: www.facebook.com:443\r\n${auth}Connection: close\r\n\r\n`,
    )
    const response = await socketRead(socket, 10_000)
    const status = response.toString("utf8", 0, Math.min(response.length, 120)).match(/HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1]
    if (status !== "200") {
      throw new Error(`HTTP CONNECT failed (${status || "no status"})`)
    }
  } finally {
    socket.destroy()
  }
}

async function testProxy(proxy: AdsPowerProxyConfig) {
  if (proxy.type === "socks5") {
    await checkSocks5Proxy(proxy)
    return
  }
  if (proxy.type === "http" || proxy.type === "https") {
    await checkHttpProxy(proxy)
    return
  }
  throw new Error(`Unsupported proxy type: ${proxy.type}`)
}

export async function checkAdsPowerProfileProxy(userId: string): Promise<AdsPowerProxyCheckResult> {
  const id = userId.trim()
  if (!id) return { ok: false, checked: false, message: "Нет ID профиля" }

  try {
    const result = await getProfileProxy(id)
    if (!result.ok) return { ok: false, checked: false, message: result.message }
    if (!result.hasProxy) return { ok: true, checked: false, message: result.message }
    if (!result.proxy) return { ok: true, checked: false, message: result.message }

    await testProxy(result.proxy)
    return {
      ok: true,
      checked: true,
      proxy: proxyLabel(result.proxy),
      message: `Прокси работает: ${proxyLabel(result.proxy)}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "proxy check failed"
    return {
      ok: false,
      checked: true,
      message: `Прокси не работает: ${message}`,
    }
  }
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function listAdsPowerProfiles(options: { includeOpen?: boolean } = {}): Promise<{
  ok: boolean
  message: string
  profiles: AdsPowerProfile[]
}> {
  if (!process.env.ADSPOWER_API_KEY) {
    return { ok: false, message: "Нет ADSPOWER_API_KEY в .env", profiles: [] }
  }

  try {
    let openIds = new Set<string>()
    if (options.includeOpen) {
      const status = await adspowerFetch<unknown>("/status")
      if (status.code !== 0) {
        return { ok: false, message: status.msg || "AdsPower не отвечает", profiles: [] }
      }

      const active = await adspowerFetch<{ list?: unknown[] }>("/api/v1/browser/local-active")
      openIds = new Set(
        asList(active.data).map((item) => {
          const row = asRecord(item)
          return String(row.user_id ?? row.profile_id ?? "")
        }).filter(Boolean),
      )
    }

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

function missingChromeKernel(message: string) {
  const match = message.match(/SunBrowser\s+(\d+)\s+is\s+not\s+ready/i)
  return match?.[1] ?? ""
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

async function ensureChromeKernel(kernel: string) {
  for (let step = 0; step < 60; step += 1) {
    const result = await adspowerFetch<AdsPowerKernelDownload>(
      "/api/v2/browser-profile/download-kernel",
      {
        method: "POST",
        body: JSON.stringify({
          kernel_type: "Chrome",
          kernel_version: kernel,
        }),
        timeoutMs: 60_000,
      },
    )

    if (result.code !== 0) {
      return {
        ok: false,
        message: result.msg || `Не удалось скачать SunBrowser ${kernel}`,
      }
    }

    const status = String(result.data?.status ?? "")
    if (status === "completed") {
      return { ok: true, message: `SunBrowser ${kernel} установлен` }
    }
    if (status === "failed") {
      return { ok: false, message: `Скачивание SunBrowser ${kernel} завершилось ошибкой` }
    }

    await wait(status === "pending" ? 6000 : 3000)
  }

  return { ok: false, message: `SunBrowser ${kernel} долго скачивается, попробуйте позже` }
}

export type AdsPowerStartResult = {
  ok: boolean
  message: string
  browserWs?: string
  debugPort?: string
}

export async function startAdsPowerBrowser(
  userId: string,
  options: { skipProxyCheck?: boolean } = {},
): Promise<AdsPowerStartResult> {
  const id = userId.trim()
  if (!id) {
    return { ok: false, message: "Нет ID профиля" }
  }
  const installingKernels = new Set<string>()

  try {
    if (!options.skipProxyCheck) {
      const proxyCheck = await checkAdsPowerProfileProxy(id)
      if (!proxyCheck.ok) {
        return { ok: false, message: proxyCheck.message }
      }
    }

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

      const missingKernel = missingChromeKernel(msg)
      if (missingKernel && !installingKernels.has(missingKernel)) {
        installingKernels.add(missingKernel)
        const kernel = await ensureChromeKernel(missingKernel)
        if (!kernel.ok) {
          return { ok: false, message: kernel.message }
        }
        continue
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
