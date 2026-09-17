import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export type OpenAiCheck = {
  name: string
  ok: boolean
  status: number
  detail: string
}

export type OpenAiAccount = {
  keyPresent: boolean
  connected: boolean
  keyMasked: string
  model: string
  modelAvailable: boolean | null
  error?: string
  apiVersion?: string
  requestId?: string
  organization?: string
  project?: string
  modelCount: number
  chatModels: string[]
  files: number | null
  filesHasMore: boolean
  fineTunes: number | null
  batches: number | null
  usage: {
    available: boolean
    detail: string
    spentUsd?: number
    currency?: string
  }
  checks: OpenAiCheck[]
}

function valueFromDotEnv(name: string) {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8")
    const line = text.split(/\r?\n/).find((row) => row.startsWith(`${name}=`))
    if (!line) return ""
    return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  } catch {
    return ""
  }
}

export function getOpenAiConfig() {
  const apiKey = (process.env.OPENAI_API_KEY || valueFromDotEnv("OPENAI_API_KEY") || "").trim()
  const model = (process.env.OPENAI_MODEL || valueFromDotEnv("OPENAI_MODEL") || "gpt-4o-mini").trim()
  return { apiKey, model }
}

export function maskOpenAiKey(key: string) {
  if (!key) return "не задан"
  if (key.length <= 12) return "••••"
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}

async function openaiGet(path: string, apiKey: string) {
  const response = await fetch(`https://api.openai.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  })
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 400) }
  }
  return { response, json }
}

function errorMessage(json: unknown) {
  if (!json || typeof json !== "object") return ""
  const record = json as { error?: unknown; message?: unknown }
  let raw = ""
  if (typeof record.error === "string") raw = record.error
  else if (record.error && typeof record.error === "object") {
    const nested = record.error as { message?: string; code?: string }
    raw = nested.message || nested.code || ""
  } else if (typeof record.message === "string") {
    raw = record.message
  }

  const lower = raw.toLowerCase()
  if (lower.includes("api.usage.read")) {
    return "Нет права api.usage.read — баланс и траты этому ключу не отдают."
  }
  if (lower.includes("api.management.read")) {
    return "Нет права api.management.read — проекты организации недоступны."
  }
  if (lower.includes("session key")) {
    return "Кредиты OpenAI отдаёт только из кабинета (session), не по API-ключу."
  }
  return raw
}

function listMeta(json: unknown) {
  if (!json || typeof json !== "object") return { count: null, hasMore: false }
  const data = (json as { data?: unknown; has_more?: unknown }).data
  const hasMore = Boolean((json as { has_more?: unknown }).has_more)
  return { count: Array.isArray(data) ? data.length : null, hasMore }
}

function isChatModel(id: string) {
  return /^(gpt|o[1-9]|chatgpt)/i.test(id)
}

function sumCosts(json: unknown) {
  if (!json || typeof json !== "object") return { spentUsd: undefined as number | undefined, currency: "usd" }
  const buckets = (json as { data?: unknown }).data
  if (!Array.isArray(buckets)) return { spentUsd: undefined, currency: "usd" }

  let spent = 0
  let currency = "usd"
  let found = false

  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue
    const results = (bucket as { results?: unknown; amount?: { value?: number; currency?: string } }).results
    const amount = (bucket as { amount?: { value?: number; currency?: string } }).amount
    if (amount && Number.isFinite(Number(amount.value))) {
      spent += Number(amount.value)
      currency = amount.currency || currency
      found = true
    }
    if (Array.isArray(results)) {
      for (const row of results) {
        if (!row || typeof row !== "object") continue
        const rowAmount = (row as { amount?: { value?: number; currency?: string } }).amount
        if (rowAmount && Number.isFinite(Number(rowAmount.value))) {
          spent += Number(rowAmount.value)
          currency = rowAmount.currency || currency
          found = true
        }
      }
    }
  }

  return { spentUsd: found ? spent : undefined, currency }
}

function header(response: Response, name: string) {
  return response.headers.get(name) || undefined
}

export async function getOpenAiAccount(): Promise<OpenAiAccount> {
  const { apiKey, model } = getOpenAiConfig()
  const empty: OpenAiAccount = {
    keyPresent: Boolean(apiKey),
    connected: false,
    keyMasked: maskOpenAiKey(apiKey),
    model,
    modelAvailable: null,
    modelCount: 0,
    chatModels: [],
    files: null,
    filesHasMore: false,
    fineTunes: null,
    batches: null,
    usage: {
      available: false,
      detail: apiKey
        ? "Баланс и траты OpenAI отдаёт только ключ с правом api.usage.read."
        : "Сначала добавь OPENAI_API_KEY в .env",
    },
    checks: [],
  }

  if (!apiKey) {
    empty.error = "Ключ не задан"
    return empty
  }

  const now = Math.floor(Date.now() / 1000)
  const start = now - 30 * 24 * 3600

  try {
    const [modelsCall, filesCall, tunesCall, batchesCall, costsCall, usageCall, projectsCall, grantsCall] =
      await Promise.all([
        openaiGet("/v1/models", apiKey),
        openaiGet("/v1/files", apiKey),
        openaiGet("/v1/fine_tuning/jobs", apiKey),
        openaiGet("/v1/batches", apiKey),
        openaiGet(`/v1/organization/costs?start_time=${start}&end_time=${now}&bucket_width=1d`, apiKey),
        openaiGet(`/v1/organization/usage/completions?start_time=${start}&bucket_width=1d`, apiKey),
        openaiGet("/v1/organization/projects", apiKey),
        openaiGet("/dashboard/billing/credit_grants", apiKey),
      ])

    const filesMeta = listMeta(filesCall.json)
    const tunesMeta = listMeta(tunesCall.json)
    const batchesMeta = listMeta(batchesCall.json)
    const costs = sumCosts(costsCall.json)

    const checks: OpenAiCheck[] = [
      {
        name: "Модели",
        ok: modelsCall.response.ok,
        status: modelsCall.response.status,
        detail: modelsCall.response.ok
          ? `${listMeta(modelsCall.json).count ?? 0} шт.`
          : errorMessage(modelsCall.json) || "Нет доступа",
      },
      {
        name: "Файлы",
        ok: filesCall.response.ok,
        status: filesCall.response.status,
        detail: filesCall.response.ok
          ? `${filesMeta.count ?? 0}${filesMeta.hasMore ? "+" : ""}`
          : errorMessage(filesCall.json) || "Нет доступа",
      },
      {
        name: "Fine-tune",
        ok: tunesCall.response.ok,
        status: tunesCall.response.status,
        detail: tunesCall.response.ok
          ? `${tunesMeta.count ?? 0}${tunesMeta.hasMore ? "+" : ""}`
          : errorMessage(tunesCall.json) || "Нет доступа",
      },
      {
        name: "Batches",
        ok: batchesCall.response.ok,
        status: batchesCall.response.status,
        detail: batchesCall.response.ok
          ? `${batchesMeta.count ?? 0}${batchesMeta.hasMore ? "+" : ""}`
          : errorMessage(batchesCall.json) || "Нет доступа",
      },
      {
        name: "Траты (Costs)",
        ok: costsCall.response.ok,
        status: costsCall.response.status,
        detail: costsCall.response.ok
          ? "доступны"
          : errorMessage(costsCall.json) || "Нет доступа",
      },
      {
        name: "Usage",
        ok: usageCall.response.ok,
        status: usageCall.response.status,
        detail: usageCall.response.ok
          ? "доступны"
          : errorMessage(usageCall.json) || "Нет доступа",
      },
      {
        name: "Проекты",
        ok: projectsCall.response.ok,
        status: projectsCall.response.status,
        detail: projectsCall.response.ok
          ? `${listMeta(projectsCall.json).count ?? 0} шт.`
          : errorMessage(projectsCall.json) || "Нет доступа",
      },
      {
        name: "Кредиты / баланс",
        ok: grantsCall.response.ok,
        status: grantsCall.response.status,
        detail: grantsCall.response.ok
          ? "доступны"
          : errorMessage(grantsCall.json) || "Нет доступа",
      },
    ]

    if (!modelsCall.response.ok) {
      return {
        ...empty,
        error: errorMessage(modelsCall.json) || `OpenAI ${modelsCall.response.status}`,
        checks,
      }
    }

    const models = Array.isArray((modelsCall.json as { data?: Array<{ id?: string }> }).data)
      ? (modelsCall.json as { data: Array<{ id?: string }> }).data
          .map((item) => item.id || "")
          .filter(Boolean)
      : []
    const chatModels = models.filter(isChatModel).sort((left, right) => left.localeCompare(right))

    const usage = costsCall.response.ok
      ? {
          available: true,
          detail: "Сумма за 30 дней по Costs API",
          spentUsd: costs.spentUsd,
          currency: costs.currency,
        }
      : grantsCall.response.ok
        ? {
            available: true,
            detail: "Кредиты billing API",
          }
        : {
            available: false,
            detail:
              errorMessage(costsCall.json) ||
              "У этого ключа нет права api.usage.read — баланс и траты OpenAI не отдаёт.",
          }

    return {
      keyPresent: true,
      connected: true,
      keyMasked: maskOpenAiKey(apiKey),
      model,
      modelAvailable: models.includes(model),
      apiVersion: header(modelsCall.response, "openai-version"),
      requestId: header(modelsCall.response, "x-request-id"),
      organization: header(modelsCall.response, "openai-organization"),
      project: header(modelsCall.response, "openai-project"),
      modelCount: models.length,
      chatModels,
      files: filesCall.response.ok ? filesMeta.count : null,
      filesHasMore: filesMeta.hasMore,
      fineTunes: tunesCall.response.ok ? tunesMeta.count : null,
      batches: batchesCall.response.ok ? batchesMeta.count : null,
      usage,
      checks,
    }
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : "OpenAI не ответил",
    }
  }
}
