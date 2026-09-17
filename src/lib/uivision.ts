import { startAdsPowerBrowser } from "@/lib/adspower"

const DEFAULT_EXTENSION_ID = "gcbalfbdmfieckjlnblleoemohcganoc"
const DEFAULT_MACRO = "facebook-comment"

export type UiVisionResult = {
  ok: boolean
  message: string
}

export type UiVisionVars = {
  facebookPostUrl: string
  commentText: string
  likeWithComment?: string
  subscribePage?: string
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extensionId() {
  return (process.env.UIVISION_EXTENSION_ID || DEFAULT_EXTENSION_ID).trim()
}

function macroName() {
  return (process.env.UIVISION_MACRO || DEFAULT_MACRO).trim()
}

function toFileUrl(path: string) {
  const trimmed = path.trim()
  if (trimmed.startsWith("file://")) return trimmed
  const abs = trimmed.replace(/\\/g, "/")
  if (/^[A-Za-z]:/.test(abs)) return `file:///${abs}`
  return `file://${abs.startsWith("/") ? abs : `/${abs}`}`
}

export function buildUiVisionUrl(vars: UiVisionVars) {
  const params = new URLSearchParams({
    direct: "1",
    macro: macroName(),
    cmd_var1: vars.facebookPostUrl,
    cmd_var2: vars.commentText,
    cmd_var3: [vars.likeWithComment === "1" ? "like" : "", vars.subscribePage === "1" ? "subscribe" : ""]
      .filter(Boolean)
      .join(","),
  })

  const htmlPath = (process.env.UIVISION_HTML_PATH || "").trim()
  const base = htmlPath
    ? toFileUrl(htmlPath)
    : `chrome-extension://${extensionId()}/ui.vision.html`

  return `${base}?${params.toString()}`
}

async function listDevtoolsTargets(debugPort: string) {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
  if (!res.ok) {
    throw new Error("DevTools AdsPower не отвечает")
  }
  return (await res.json()) as Array<{
    type?: string
    url?: string
    webSocketDebuggerUrl?: string
  }>
}

async function waitForDevtools(debugPort: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const targets = await listDevtoolsTargets(debugPort)
      if (targets.length > 0) return targets
    } catch {
      // debug port ещё поднимается
    }
    await pause(300)
  }
  throw new Error("Не дождались debug port AdsPower")
}

async function cdpCall(wsUrl: string, method: string, params: Record<string, unknown>) {
  const ws = new WebSocket(wsUrl)
  const id = Date.now()

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP timeout")), 15_000)
      ws.addEventListener("open", () => {
        clearTimeout(timer)
        resolve()
      })
      ws.addEventListener("error", () => {
        clearTimeout(timer)
        reject(new Error("Не удалось подключиться к AdsPower браузеру"))
      })
    })

    const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP не ответил")), 15_000)
      ws.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as {
            id?: number
            result?: Record<string, unknown>
            error?: { message?: string }
          }
          if (payload.id !== id) return
          clearTimeout(timer)
          if (payload.error) {
            reject(new Error(payload.error.message || method))
            return
          }
          resolve(payload.result ?? {})
        } catch (error) {
          clearTimeout(timer)
          reject(error)
        }
      })
    })

    ws.send(JSON.stringify({ id, method, params }))
    return await reply
  } finally {
    ws.close()
  }
}

async function openUrlInAdsPowerBrowser(options: {
  debugPort?: string
  browserWs?: string
  url: string
}) {
  if (options.debugPort) {
    await waitForDevtools(options.debugPort)
    const created = await fetch(
      `http://127.0.0.1:${options.debugPort}/json/new?${encodeURIComponent(options.url)}`,
      { method: "PUT" },
    )
    if (created.ok) return
  }

  if (options.browserWs) {
    await cdpCall(options.browserWs, "Target.createTarget", { url: options.url })
    return
  }

  throw new Error("Профиль открыт, но AdsPower не отдал debug port браузера")
}

function isUiVisionTab(url?: string) {
  if (!url) return false
  const id = extensionId()
  return (
    url.includes("ui.vision.html") ||
    url.includes(`${id}/sidepanel.html`) ||
    url.includes(`${id}/popup.html`)
  )
}

async function waitForUiVision(debugPort: string | undefined, timeoutMs: number) {
  if (!debugPort) return { started: true, finished: false }

  const startedAt = Date.now()
  let started = false

  while (Date.now() - startedAt < 15_000) {
    const targets = await listDevtoolsTargets(debugPort).catch(() => [])
    if (targets.some((target) => isUiVisionTab(target.url))) {
      started = true
      break
    }
    await pause(300)
  }

  if (!started) {
    return { started: false, finished: false }
  }

  const finishDeadline = Date.now() + timeoutMs
  while (Date.now() < finishDeadline) {
    const targets = await listDevtoolsTargets(debugPort).catch(() => [])
    if (!targets.some((target) => isUiVisionTab(target.url))) {
      return { started: true, finished: true }
    }
    await pause(500)
  }

  return { started: true, finished: false }
}

export async function runUiVisionMacro(
  profileId: string,
  vars: UiVisionVars,
): Promise<UiVisionResult> {
  if (!macroName()) {
    return { ok: false, message: "Нет UIVISION_MACRO в .env" }
  }

  const started = await startAdsPowerBrowser(profileId)
  if (!started.ok) {
    return { ok: false, message: started.message }
  }

  const url = buildUiVisionUrl(vars)

  try {
    await openUrlInAdsPowerBrowser({
      debugPort: started.debugPort,
      browserWs: started.browserWs,
      url,
    })
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Не удалось открыть UI.Vision в профиле AdsPower",
    }
  }

  const timeoutMs = Number(process.env.UIVISION_TIMEOUT_MS || 120_000)
  const status = await waitForUiVision(started.debugPort, timeoutMs)
  if (!status.started) {
    return {
      ok: false,
      message:
        "UI.Vision не открылся. Поставьте расширение в этот профиль AdsPower. Если нужен file://, укажите UIVISION_HTML_PATH.",
    }
  }

  return {
    ok: true,
    message: status.finished
      ? "UI.Vision отработал. Профиль остаётся открытым."
      : "UI.Vision запущен. Профиль остаётся открытым.",
  }
}
