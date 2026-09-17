import { writeActionLog } from "@/lib/action-log"
import { captureFacebookPost } from "@/lib/facebook-page-switch"
import { farmQueueIsBusy } from "@/lib/farm-queue"

export type FacebookPostKind = "text" | "image" | "image_text" | "unknown"

export type FacebookPostRead = {
  url: string
  text: string
  hasText: boolean
  hasImage: boolean
  kind: FacebookPostKind
  via: "browser" | "preview"
  screenshotJpeg?: string
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function metaContent(html: string, property: string) {
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`,
      "i",
    ),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match?.[1]) return decodeHtml(match[1]).trim()
  }
  return ""
}

function kindFrom(hasText: boolean, hasImage: boolean): FacebookPostKind {
  if (hasText && hasImage) return "image_text"
  if (hasImage) return "image"
  if (hasText) return "text"
  return "unknown"
}

async function fetchImageJpeg(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
      redirect: "follow",
    })
    if (!response.ok) return undefined
    const type = response.headers.get("content-type") || ""
    if (!type.startsWith("image/")) return undefined
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 80 || buffer.length > 3_500_000) return undefined
    return buffer.toString("base64")
  } catch {
    return undefined
  }
}

export async function readFacebookPost(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,it;q=0.8,ru;q=0.7",
      },
      redirect: "follow",
    })
    const html = await response.text()
    const title = metaContent(html, "og:title")
    const description = metaContent(html, "og:description")
    const image = metaContent(html, "og:image")
    const text = [title, description].filter(Boolean).join("\n")
    return { url, title, description, image, text }
  } catch {
    return { url, title: "", description: "", image: "", text: "" }
  }
}

export async function readFacebookPostForAi(input: {
  url: string
  profileId?: string
}): Promise<FacebookPostRead> {
  const preview = await readFacebookPost(input.url)
  const previewImage = preview.image ? await fetchImageJpeg(preview.image) : undefined
  const fallback: FacebookPostRead = {
    url: input.url,
    text: preview.text,
    hasText: Boolean(preview.text.trim()),
    hasImage: Boolean(previewImage || preview.image),
    kind: kindFrom(Boolean(preview.text.trim()), Boolean(previewImage || preview.image)),
    via: "preview",
    screenshotJpeg: previewImage,
  }

  if (!input.profileId) return fallback
  if (await farmQueueIsBusy()) return fallback

  try {
    const captured = await captureFacebookPost(
      { profileId: input.profileId, url: input.url },
      (line) => {
        void writeActionLog({
          userName: "ChatGPT",
          action: "Разбор поста",
          detail: line.text,
          level: line.level,
          profileId: input.profileId,
          source: "adspower",
        })
      },
    )
    const text = captured.text.trim() || preview.text
    const hasImage = captured.hasImage || Boolean(captured.screenshotJpeg) || fallback.hasImage
    return {
      url: input.url,
      text,
      hasText: Boolean(text),
      hasImage,
      kind: kindFrom(Boolean(text), hasImage),
      via: "browser",
      screenshotJpeg: captured.screenshotJpeg || fallback.screenshotJpeg,
    }
  } catch {
    return fallback
  }
}
