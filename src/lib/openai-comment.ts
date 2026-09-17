import { AI_COMMENT_PROMPT } from "@/lib/ai-comment-prompt"
import { getOpenAiConfig } from "@/lib/openai-account"
import type { FacebookPostKind, FacebookPostRead } from "@/lib/facebook-post"

export type CommentAuthor = {
  name: string
  country?: string
  postIndex?: number
}

export type GeneratedComments = {
  comments: string[]
  postSummary: string
  postKind: FacebookPostKind
}

type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

function extractJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) {
    throw new Error("ChatGPT вернул не JSON")
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as {
    comments?: unknown
    summary?: unknown
    postKind?: unknown
  }
}

function asKind(value: unknown, fallback: FacebookPostKind): FacebookPostKind {
  if (value === "text" || value === "image" || value === "image_text") return value
  return fallback
}

export async function generateCommentsWithGpt(input: {
  posts: FacebookPostRead[]
  authors: CommentAuthor[]
  count: number
}): Promise<GeneratedComments> {
  const { apiKey, model } = getOpenAiConfig()
  if (!apiKey) {
    throw new Error("Добавь OPENAI_API_KEY в .env")
  }

  const count = Math.min(Math.max(input.count, 1), 80)
  const authors: CommentAuthor[] =
    input.authors.length > 0
      ? input.authors.slice(0, count)
      : Array.from({ length: count }, (_, index) => ({ name: `Человек ${index + 1}` }))

  const postsBlock = input.posts
    .map((post, index) => {
      const body = post.text.trim() || "Текста под постом нет — смотри картинку, если она приложена."
      const kind =
        post.kind === "image_text"
          ? "картинка и текст"
          : post.kind === "image"
            ? "картинка"
            : post.kind === "text"
              ? "текст"
              : "неясно"
      return `${index + 1}. ${post.url}\nТип: ${kind}\nКак читали: ${post.via === "browser" ? "зашли на пост" : "превью"}\n${body}`
    })
    .join("\n\n")

  const authorsBlock = authors
    .map((author, index) => {
      const geo = author.country ? `, страна ${author.country}` : ""
      const post = Number.isInteger(author.postIndex) ? `, для поста ${(author.postIndex ?? 0) + 1}` : ""
      return `${index + 1}. ${author.name}${geo}${post}`
    })
    .join("\n")

  const userText = `${AI_COMMENT_PROMPT}

Посты:
${postsBlock}

Комментаторы и цели (пиши ровно в этом порядке, comments[i] = строка i):
${authorsBlock}

Нужно ровно ${authors.length} комментариев.
Если у строки указано «для поста N», comments[i] пиши именно к посту N.
Каждый comments[i] строго на языке своего поста, не на языке имени и не на русском, если пост на другом языке.

Верни JSON:
{"postKind":"text"|"image"|"image_text","summary":"коротко что на посте, на русском","comments":["..."]}`

  const content: ChatContent[] = [{ type: "text", text: userText }]
  for (const post of input.posts) {
    if (!post.screenshotJpeg) continue
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${post.screenshotJpeg}` },
    })
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.95,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Ты живой комментатор Facebook. Смотри картинку, если она есть. Комментарии всегда на языке поста. Следуй промпту. Верни только JSON.",
        },
        {
          role: "user",
          content,
        },
      ],
    }),
  })

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string }
    choices?: Array<{ message?: { content?: string } }>
  } | null

  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI ошибка ${response.status}`)
  }

  const parsed = extractJsonObject(payload?.choices?.[0]?.message?.content || "")
  const comments = (Array.isArray(parsed.comments) ? parsed.comments : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, authors.length)

  if (comments.length === 0) {
    throw new Error("ChatGPT не вернул комментарии")
  }

  while (comments.length < authors.length) {
    comments.push(comments[comments.length % Math.max(comments.length, 1)] || comments[0])
  }

  const fallbackKind = input.posts[0]?.kind || "unknown"
  const summary =
    String(parsed.summary || "").trim() ||
    input.posts.map((post) => post.text || post.url).join(" · ").slice(0, 240)

  return {
    comments,
    postSummary: summary,
    postKind: asKind(parsed.postKind, fallbackKind),
  }
}
