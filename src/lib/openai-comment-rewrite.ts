import { normalizeFarmCommentForAntiSpam } from "@/lib/farm-anti-spam"
import { getOpenAiConfig } from "@/lib/openai-account"

function extractJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("ChatGPT вернул не JSON")
  return JSON.parse(trimmed.slice(start, end + 1)) as { comment?: unknown }
}

function uniqueAvoidComments(values: string[]) {
  const keys = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const clean = value.replace(/\s+/g, " ").trim()
    const key = normalizeFarmCommentForAntiSpam(clean)
    if (!clean || !key || keys.has(key)) continue
    keys.add(key)
    result.push(clean)
  }
  return result.slice(-20)
}

export async function rewriteFarmCommentWithGpt(input: {
  comment: string
  fanName?: string
  url?: string
  avoidComments?: string[]
}) {
  const { apiKey, model } = getOpenAiConfig()
  if (!apiKey) throw new Error("Добавь OPENAI_API_KEY в .env")

  const original = input.comment.trim()
  const avoidComments = uniqueAvoidComments([original, ...(input.avoidComments || [])])
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 1.05,
      presence_penalty: 0.4,
      frequency_penalty: 0.5,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Rewrite Facebook comments for anti-spam. Preserve the original meaning, sentiment, language, and natural human tone. Return only JSON.",
        },
        {
          role: "user",
          content: `Original comment:
${original}

Fan/page: ${input.fanName || "unknown"}
Post URL: ${input.url || "unknown"}

Do not use these exact comments:
${avoidComments.map((comment, index) => `${index + 1}. ${comment}`).join("\n")}

Rewrite as one natural Facebook comment in the same language. Keep the same logic and intent, but use different wording. Do not add facts, links, hashtags, quotes around the whole text, or emoji spam.

Return JSON:
{"comment":"..."}`,
        },
      ],
    }),
  })

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string }
    choices?: Array<{ message?: { content?: string } }>
  } | null
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI ошибка ${response.status}`)

  const rewritten = String(extractJsonObject(payload?.choices?.[0]?.message?.content || "").comment || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!rewritten) throw new Error("ChatGPT не вернул перефразированный комментарий")
  const rewrittenKey = normalizeFarmCommentForAntiSpam(rewritten)
  const blocked = avoidComments.some((comment) => normalizeFarmCommentForAntiSpam(comment) === rewrittenKey)
  if (blocked) throw new Error("ChatGPT вернул такой же комментарий")
  return rewritten
}
