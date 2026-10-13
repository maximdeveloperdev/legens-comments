import { Gender } from "@prisma/client"
import { getOpenAiConfig } from "./openai-account"
import { profileGeoFromName } from "./profile-geo"

export type FanGenderSource = "dictionary" | "heuristic" | "openai" | "unknown"

export type FanGenderInput = {
  key: string
  name: string
  geo?: string
}

export type FanGenderGuess = {
  key: string
  name: string
  cleanName: string
  gender: Exclude<Gender, "ANY"> | null
  confidence: number
  source: FanGenderSource
}

export type FanGenderBatchResult = {
  guesses: Map<string, FanGenderGuess>
  openAiUsed: boolean
  openAiError?: string
  counts: {
    male: number
    female: number
    unknown: number
    dictionary: number
    heuristic: number
    openai: number
  }
}

const OPENAI_BATCH_SIZE = 80
const OPENAI_CONFIDENCE_THRESHOLD = 0.72

const BUSINESS_WORDS = new Set([
  "academy",
  "agency",
  "blog",
  "boost",
  "brand",
  "business",
  "cafe",
  "casino",
  "club",
  "company",
  "creative",
  "gallery",
  "game",
  "games",
  "general",
  "group",
  "media",
  "music",
  "news",
  "official",
  "page",
  "shop",
  "sports",
  "store",
  "studio",
  "team",
])

const FEMALE_NAMES = new Set([
  "agnieszka",
  "alba",
  "alina",
  "ambre",
  "amelie",
  "ana",
  "anastasia",
  "anna",
  "anne",
  "antonia",
  "beatriz",
  "bruna",
  "camila",
  "carmen",
  "catarina",
  "celeste",
  "celine",
  "chloe",
  "clara",
  "daria",
  "diana",
  "diem",
  "dieu",
  "ewa",
  "fernanda",
  "francisca",
  "gabriela",
  "hanna",
  "hoa",
  "huong",
  "ines",
  "irina",
  "isabel",
  "isabella",
  "izabella",
  "joanna",
  "juliana",
  "julie",
  "katarzyna",
  "kateryna",
  "laia",
  "lan",
  "larissa",
  "laura",
  "leonor",
  "leticia",
  "lilou",
  "linh",
  "louise",
  "lucia",
  "lucie",
  "luisa",
  "magdalena",
  "mai",
  "maria",
  "mariana",
  "marie",
  "marta",
  "matilde",
  "monika",
  "natalia",
  "ninel",
  "noelia",
  "nguyet",
  "ola",
  "olga",
  "olesia",
  "paula",
  "renata",
  "sara",
  "sofia",
  "sofie",
  "trang",
  "valentina",
  "victoria",
  "viktoriya",
  "yulia",
])

const MALE_NAMES = new Set([
  "adam",
  "aleksander",
  "aleksandr",
  "alejandro",
  "alexander",
  "andre",
  "andriy",
  "antoine",
  "antonio",
  "bao",
  "bruno",
  "carlos",
  "chinh",
  "cuong",
  "denis",
  "diego",
  "dmitry",
  "filip",
  "francesco",
  "francisco",
  "giovanni",
  "gonzalo",
  "grzegorz",
  "hung",
  "jan",
  "javier",
  "jean",
  "joao",
  "jose",
  "juan",
  "julien",
  "kamil",
  "leon",
  "leor",
  "louis",
  "luc",
  "luca",
  "lucas",
  "lukasz",
  "manuel",
  "marco",
  "marcos",
  "marek",
  "martin",
  "mateo",
  "matteo",
  "max",
  "maksym",
  "michal",
  "miguel",
  "minh",
  "nam",
  "nazar",
  "nicolas",
  "nikita",
  "pablo",
  "paul",
  "pedro",
  "phuc",
  "pierre",
  "piotr",
  "quang",
  "sebastien",
  "sergey",
  "sergio",
  "serhii",
  "tiago",
  "tomasz",
  "tuan",
  "viktor",
  "victor",
  "vladislav",
])

const FEMALE_ENDING_GEOS = new Set([
  "AR",
  "BG",
  "BR",
  "CL",
  "CO",
  "CZ",
  "DE",
  "ES",
  "HR",
  "IT",
  "LT",
  "LV",
  "MX",
  "PE",
  "PL",
  "PT",
  "RO",
  "RS",
  "RU",
  "SK",
  "UA",
])

const MALE_O_ENDING_GEOS = new Set(["AR", "BR", "CL", "CO", "ES", "IT", "MX", "PE", "PT"])

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’`]/g, "'")
    .toLowerCase()
    .replace(/[^a-z'-]+/g, "")
}

export function cleanFanNameForGender(value: string) {
  return value
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\bBAN\b/gi, " ")
    .replace(/[|•·_]+/g, " ")
    .replace(/[^\p{L}\p{M}'’` -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function nameParts(cleanName: string) {
  return cleanName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
}

function looksLikeBusinessPage(cleanName: string) {
  const keys = nameParts(cleanName).map(normalizeKey).filter(Boolean)
  if (keys.length === 0) return true
  return keys.some((key) => BUSINESS_WORDS.has(key))
}

function geoForName(input: FanGenderInput) {
  return (profileGeoFromName(input.name) || input.geo || "").trim().toUpperCase()
}

export function inferFanGenderLocal(input: FanGenderInput): FanGenderGuess {
  const cleanName = cleanFanNameForGender(input.name)
  const parts = nameParts(cleanName)
  const geo = geoForName(input)
  const firstName = normalizeKey(parts[0] || "")
  const lastName = normalizeKey(parts.at(-1) || "")

  if (parts.length === 0 || looksLikeBusinessPage(cleanName)) {
    return {
      key: input.key,
      name: input.name,
      cleanName,
      gender: null,
      confidence: 0,
      source: "unknown",
    }
  }

  if (FEMALE_NAMES.has(firstName) && !MALE_NAMES.has(firstName)) {
    return {
      key: input.key,
      name: input.name,
      cleanName,
      gender: Gender.FEMALE,
      confidence: 0.96,
      source: "dictionary",
    }
  }

  if (MALE_NAMES.has(firstName) && !FEMALE_NAMES.has(firstName)) {
    return {
      key: input.key,
      name: input.name,
      cleanName,
      gender: Gender.MALE,
      confidence: 0.96,
      source: "dictionary",
    }
  }

  if (/(ova|eva|ska|cka|ina|aya)$/.test(lastName)) {
    return {
      key: input.key,
      name: input.name,
      cleanName,
      gender: Gender.FEMALE,
      confidence: 0.82,
      source: "heuristic",
    }
  }

  if (/(ski|cki|ov|ev|son|sen)$/.test(lastName)) {
    return {
      key: input.key,
      name: input.name,
      cleanName,
      gender: Gender.MALE,
      confidence: 0.78,
      source: "heuristic",
    }
  }

  if (firstName.endsWith("a") && FEMALE_ENDING_GEOS.has(geo)) {
    return {
      key: input.key,
      name: input.name,
      cleanName,
      gender: Gender.FEMALE,
      confidence: 0.74,
      source: "heuristic",
    }
  }

  if (firstName.endsWith("o") && MALE_O_ENDING_GEOS.has(geo)) {
    return {
      key: input.key,
      name: input.name,
      cleanName,
      gender: Gender.MALE,
      confidence: 0.76,
      source: "heuristic",
    }
  }

  return {
    key: input.key,
    name: input.name,
    cleanName,
    gender: null,
    confidence: 0,
    source: "unknown",
  }
}

function normalizeOpenAiGender(value: unknown) {
  const gender = String(value || "").trim().toLowerCase()
  if (gender === "male" || gender === "m" || gender === "man") return Gender.MALE
  if (gender === "female" || gender === "f" || gender === "woman") return Gender.FEMALE
  return null
}

function extractJson(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const startObject = trimmed.indexOf("{")
  const startArray = trimmed.indexOf("[")
  const start =
    startArray >= 0 && (startObject < 0 || startArray < startObject)
      ? startArray
      : startObject
  if (start < 0) throw new Error("ChatGPT не вернул JSON")
  const end = trimmed[start] === "[" ? trimmed.lastIndexOf("]") : trimmed.lastIndexOf("}")
  if (end <= start) throw new Error("ChatGPT вернул битый JSON")
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown
}

function parseOpenAiItems(value: unknown) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== "object") return []
  const record = value as { items?: unknown; results?: unknown; data?: unknown }
  if (Array.isArray(record.items)) return record.items
  if (Array.isArray(record.results)) return record.results
  if (Array.isArray(record.data)) return record.data
  return []
}

async function inferFanGendersWithOpenAi(items: FanGenderInput[]) {
  const { apiKey, model } = getOpenAiConfig()
  if (!apiKey || items.length === 0) {
    return { guesses: new Map<string, FanGenderGuess>(), used: false }
  }

  const guesses = new Map<string, FanGenderGuess>()
  let used = false

  for (let offset = 0; offset < items.length; offset += OPENAI_BATCH_SIZE) {
    const batch = items.slice(offset, offset + OPENAI_BATCH_SIZE)
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Classify display names for avatar matching. Return JSON only. Use male or female only for clear human personal names. Use unknown for brands, clubs, businesses, pages, or ambiguous names. This is only a technical avatar label, not a statement about a real person's identity.",
          },
          {
            role: "user",
            content: `For each item return {"key":"same key","gender":"male|female|unknown","confidence":0..1}. GEO comes from profile brackets, not proxy.\n\nItems:\n${JSON.stringify(
              batch.map((item) => ({
                key: item.key,
                name: cleanFanNameForGender(item.name),
                geo: geoForName(item) || null,
              })),
            )}`,
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    })
    used = true

    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string }
      choices?: Array<{ message?: { content?: string } }>
    } | null
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI ошибка ${response.status}`)

    const parsed = extractJson(payload?.choices?.[0]?.message?.content || "")
    for (const row of parseOpenAiItems(parsed)) {
      if (!row || typeof row !== "object") continue
      const record = row as { key?: unknown; gender?: unknown; confidence?: unknown }
      const key = String(record.key || "")
      const item = batch.find((candidate) => candidate.key === key)
      if (!item) continue
      const confidence = Math.max(0, Math.min(1, Number(record.confidence) || 0))
      const gender = confidence >= OPENAI_CONFIDENCE_THRESHOLD ? normalizeOpenAiGender(record.gender) : null
      guesses.set(key, {
        key,
        name: item.name,
        cleanName: cleanFanNameForGender(item.name),
        gender,
        confidence,
        source: gender ? "openai" : "unknown",
      })
    }
  }

  return { guesses, used }
}

function countGuesses(guesses: Iterable<FanGenderGuess>) {
  const counts = {
    male: 0,
    female: 0,
    unknown: 0,
    dictionary: 0,
    heuristic: 0,
    openai: 0,
  }
  for (const guess of guesses) {
    if (guess.gender === Gender.MALE) counts.male += 1
    else if (guess.gender === Gender.FEMALE) counts.female += 1
    else counts.unknown += 1

    if (guess.source === "dictionary") counts.dictionary += 1
    if (guess.source === "heuristic") counts.heuristic += 1
    if (guess.source === "openai") counts.openai += 1
  }
  return counts
}

export async function inferFanGenders(
  items: FanGenderInput[],
  options: { useOpenAi?: boolean } = {},
): Promise<FanGenderBatchResult> {
  const guesses = new Map<string, FanGenderGuess>()
  const unknownItems: FanGenderInput[] = []

  for (const item of items) {
    const local = inferFanGenderLocal(item)
    guesses.set(item.key, local)
    if (!local.gender && !looksLikeBusinessPage(local.cleanName)) {
      unknownItems.push(item)
    }
  }

  let openAiUsed = false
  let openAiError = ""
  if (options.useOpenAi !== false && unknownItems.length > 0) {
    try {
      const openAi = await inferFanGendersWithOpenAi(unknownItems)
      openAiUsed = openAi.used
      for (const [key, guess] of openAi.guesses) {
        const current = guesses.get(key)
        if (!current) continue
        guesses.set(key, guess.gender ? guess : { ...current, confidence: guess.confidence })
      }
    } catch (error) {
      openAiError = error instanceof Error ? error.message : "OpenAI не определил пол фанок"
    }
  }

  return {
    guesses,
    openAiUsed,
    openAiError: openAiError || undefined,
    counts: countGuesses(guesses.values()),
  }
}
