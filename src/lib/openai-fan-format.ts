import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { getOpenAiConfig } from "@/lib/openai-account"

export type GeneratedFanIdentity = {
  firstName: string
  lastName: string
  fullName: string
  avatarPrompt: string
  coverTheme: string
  coverPrompt: string
}

const FAN_FORMAT_DIR = path.join(process.cwd(), "public", "uploads", "fan-format")

function extractJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("ChatGPT вернул не JSON")
  return JSON.parse(trimmed.slice(start, end + 1)) as Partial<GeneratedFanIdentity>
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "fan"
}

function normalizeName(value: unknown) {
  return String(value || "")
    .replace(/[^\p{L}\p{M}' -]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

async function downloadImage(url: string) {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error(`OpenAI image URL ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export async function generateFanIdentity(input: {
  currentName: string
  geo: string
  countryName?: string
  includeMediaPrompts?: boolean
}): Promise<GeneratedFanIdentity> {
  const { apiKey, model } = getOpenAiConfig()
  if (!apiKey) throw new Error("Добавь OPENAI_API_KEY в .env")

  const geo = input.geo.trim().toUpperCase() || "EU"
  const country = input.countryName?.trim() || geo
  const includeMediaPrompts = input.includeMediaPrompts !== false
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Generate fictional Facebook profile formatting data. Return only JSON. Names must be realistic for the requested country, not celebrities, not public figures, and use Latin letters.",
        },
        {
          role: "user",
          content: includeMediaPrompts
            ? `Current fan/page name: ${input.currentName}
Geo code: ${geo}
Country: ${country}

Generate a new human first name and last name for this geo. Also write:
- an avatar prompt for a realistic, original adult profile photo matching the country/geo;
- a cover photo theme and prompt. Pick one theme from nature, cars, venue/cafe, history, music. Cover photo should be a wide banner scene, no person as the main subject, no text, no logos.

Return JSON:
{"firstName":"...","lastName":"...","fullName":"First Last","avatarPrompt":"...","coverTheme":"nature|cars|venue|history|music","coverPrompt":"..."}`
            : `Current fan/page name: ${input.currentName}
Geo code: ${geo}
Country: ${country}

Generate only a new human first name and last name for this geo.
Return JSON:
{"firstName":"...","lastName":"...","fullName":"First Last"}`,
        },
      ],
    }),
  })

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string }
    choices?: Array<{ message?: { content?: string } }>
  } | null
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI ошибка ${response.status}`)

  const parsed = extractJsonObject(payload?.choices?.[0]?.message?.content || "")
  const firstName = normalizeName(parsed.firstName)
  const lastName = normalizeName(parsed.lastName)
  const fullName = normalizeName(parsed.fullName) || `${firstName} ${lastName}`.trim()
  const avatarPrompt = String(parsed.avatarPrompt || "").trim()
  const coverTheme = String(parsed.coverTheme || "").trim() || "nature"
  const coverPrompt = String(parsed.coverPrompt || "").trim()

  if (!firstName || !lastName || !fullName) {
    throw new Error("ChatGPT не вернул имя и фамилию")
  }

  return {
    firstName,
    lastName,
    fullName,
    avatarPrompt: includeMediaPrompts
      ? avatarPrompt ||
        `Realistic original headshot photo of an adult person from ${country}, natural light, neutral background, social media profile picture, not a celebrity.`
      : "",
    coverTheme: includeMediaPrompts ? coverTheme : "",
    coverPrompt: includeMediaPrompts
      ? coverPrompt ||
        `Wide Facebook cover photo scene from ${country}, atmospheric local nature, clean composition, no text, no logos.`
      : "",
  }
}

async function generateFanImage(input: {
  filenameBase: string
  prompt: string
  size: "1024x1024" | "1536x1024"
  missingMessage: string
}) {
  const { apiKey } = getOpenAiConfig()
  if (!apiKey) throw new Error("Добавь OPENAI_API_KEY в .env")

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      size: input.size,
      prompt: input.prompt,
    }),
  })

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string }
    data?: Array<{ b64_json?: string; url?: string }>
  } | null
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI image ошибка ${response.status}`)

  const image = payload?.data?.[0]
  const body = image?.b64_json
    ? Buffer.from(image.b64_json, "base64")
    : image?.url
      ? await downloadImage(image.url)
      : null
  if (!body || body.length === 0) throw new Error(input.missingMessage)

  await mkdir(FAN_FORMAT_DIR, { recursive: true })
  const filename = `${Date.now()}-${safeFilePart(input.filenameBase)}.png`
  const filePath = path.join(FAN_FORMAT_DIR, filename)
  await writeFile(filePath, body)
  return {
    filePath,
    publicUrl: `/uploads/fan-format/${filename}`,
  }
}

export async function generateFanAvatar(input: {
  fullName: string
  geo: string
  countryName?: string
  prompt: string
}) {
  const country = input.countryName?.trim() || input.geo.trim().toUpperCase() || "Europe"
  return generateFanImage({
    filenameBase: `${input.fullName}-avatar`,
    size: "1024x1024",
    missingMessage: "OpenAI не вернул аватарку",
    prompt: `${input.prompt}

Create a square realistic profile avatar for a fictional adult named ${input.fullName} from ${country}. Natural everyday look, face centered, no text, no logos, no watermark, not a public figure.`,
  })
}

export async function generateFanCover(input: {
  fullName: string
  geo: string
  countryName?: string
  theme: string
  prompt: string
}) {
  const country = input.countryName?.trim() || input.geo.trim().toUpperCase() || "Europe"
  return generateFanImage({
    filenameBase: `${input.fullName}-${input.theme}-cover`,
    size: "1536x1024",
    missingMessage: "OpenAI не вернул обложку",
    prompt: `${input.prompt}

Create a wide Facebook cover photo for a fictional adult from ${country}. Theme: ${input.theme}. Use a polished realistic scene such as nature, cars, local venues, history, or music. No words, no signage text, no logos, no watermark, no identifiable public figures. Composition should work as a horizontal cover banner.`,
  })
}
