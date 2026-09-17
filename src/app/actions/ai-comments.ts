"use server"

import { writeTrackerLog } from "@/lib/action-log"
import { readFacebookPostForAi } from "@/lib/facebook-post"
import { getOpenAiConfig } from "@/lib/openai-account"
import { generateCommentsWithGpt } from "@/lib/openai-comment"
import { getActiveSession } from "@/lib/session"

export type AiCommentAuthor = {
  name: string
  country?: string
}

export type AiCommentResult = {
  error?: string
  comments?: string[]
  postSummary?: string
  postKind?: "text" | "image" | "image_text" | "unknown"
  via?: "browser" | "preview"
}

function normalizeFacebookUrl(value: string) {
  const raw = value.trim()
  if (!raw) return ""
  if (/^\d+$/.test(raw)) return `https://www.facebook.com/${raw}`
  if (raw.startsWith("/")) return `https://www.facebook.com${raw}`
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`
  return raw
}

function isFacebookUrl(value: string) {
  try {
    const url = new URL(normalizeFacebookUrl(value))
    return /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.watch$/.test(url.hostname)
  } catch {
    return false
  }
}

function isLimitError(value: string) {
  return /insufficient_quota|quota|billing|limit|credits|credit balance|exceeded/i.test(value)
}

async function checkOpenAiBeforeGeneration() {
  const { apiKey } = getOpenAiConfig()
  if (!apiKey) return "Добавь OPENAI_API_KEY в .env"

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    })
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string }
    } | null
    const message = payload?.error?.message || payload?.error?.code || ""
    if (response.status === 429 || isLimitError(message)) return "no limit"
    if (!response.ok) return message || `OpenAI ${response.status}`
  } catch (error) {
    return error instanceof Error ? error.message : "OpenAI не ответил"
  }

  return ""
}

export async function generateAiComments(input: {
  urls: string[]
  authors: AiCommentAuthor[]
  profileId?: string
}): Promise<AiCommentResult> {
  const session = await getActiveSession()
  if (!session) {
    return { error: "Нужно войти в аккаунт" }
  }

  const urls = [...new Set(input.urls.map(normalizeFacebookUrl).filter(isFacebookUrl))]
  const authors = input.authors
    .map((author) => ({
      name: author.name.trim(),
      country: author.country?.trim() || undefined,
    }))
    .filter((author) => author.name)
  const count = Math.min(Math.max(authors.length || 1, 1), 40)

  if (urls.length === 0) {
    return { error: "Вставь ссылку на пост Facebook" }
  }

  try {
    const preflightError = await checkOpenAiBeforeGeneration()
    if (preflightError) {
      return { error: preflightError }
    }

    const posts = []
    for (const url of urls) {
      posts.push(
        await readFacebookPostForAi({
          url,
          profileId: input.profileId?.trim() || undefined,
        }),
      )
    }
    const targetAuthors = urls.flatMap((_, postIndex) =>
      (authors.length > 0 ? authors : [{ name: `Человек ${postIndex + 1}` }]).map((author) => ({
        ...author,
        postIndex,
      })),
    )
    const result = await generateCommentsWithGpt({
      posts,
      authors: targetAuthors.length > 0 ? targetAuthors.slice(0, 80) : [],
      count: Math.min(Math.max(targetAuthors.length || count, 1), 80),
    })
    await writeTrackerLog({
      userName: session.name,
      action: "AI-комментарии",
      detail: `${result.comments.length} шт. · ${urls.length} пост. · ${result.postKind} · ${posts[0]?.via || "preview"}`,
    })
    return {
      comments: result.comments,
      postSummary: result.postSummary,
      postKind: result.postKind,
      via: posts[0]?.via,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "ChatGPT не ответил"
    return { error: isLimitError(message) ? "no limit" : message }
  }
}
