export const COMMENT_MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,.mp4,.gif"
export const MAX_COMMENT_IMAGE_SIZE = 10 * 1024 * 1024
// Remote AdsPower uploads must stay strictly below Playwright's 50 MiB boundary.
export const MAX_COMMENT_VIDEO_SIZE = 50_000_000
export const MAX_COMMENT_MEDIA_TOTAL_SIZE = 70 * 1024 * 1024
export const COMMENT_MEDIA_HINT = "Фото и GIF — до 10 МБ, MP4 — до 50 МБ. Один файл к комментарию."

type MediaFile = { name: string; type: string; size: number }
const extensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4",
}

export function commentMediaExtension(file: Pick<MediaFile, "name" | "type">) {
  const mime = file.type.toLowerCase()
  if (extensions[mime]) return extensions[mime]
  if (!mime || mime === "application/octet-stream") {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (["jpg", "jpeg", "png", "webp", "gif", "mp4"].includes(ext)) return ext === "jpeg" ? "jpg" : ext
  }
  return ""
}

export function isCommentVideo(name: string, mime = "") {
  return mime.toLowerCase() === "video/mp4" || /\.mp4(?:$|[?#])/i.test(name)
}

export function commentMediaLabel(name: string, mime = "") {
  if (isCommentVideo(name, mime)) return "Видео MP4"
  return mime.toLowerCase() === "image/gif" || /\.gif(?:$|[?#])/i.test(name) ? "GIF" : "Фото"
}

export function acceptsCommentMedia(accept: string, name: string) {
  const tokens = accept.toLowerCase().split(",").map((token) => token.trim()).filter(Boolean)
  if (!tokens.length || tokens.includes("*/*")) return true
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const mime = Object.entries(extensions).find(([, value]) => value === (ext === "jpeg" ? "jpg" : ext))?.[0]
  return Boolean(mime && (tokens.includes(mime) || tokens.includes(`${mime.split("/")[0]}/*`) || tokens.includes(`.${ext}`)))
}

export function commentMediaError(file: MediaFile): string | null {
  const ext = commentMediaExtension(file)
  if (!ext) return "Можно прикрепить фото (JPG, PNG, WEBP), GIF или видео MP4"
  if (file.size === 0) return "Файл пустой. Выберите другой файл"
  if (file.size > (ext === "mp4" ? MAX_COMMENT_VIDEO_SIZE : MAX_COMMENT_IMAGE_SIZE)) {
    return ext === "mp4" ? "Видео MP4 должно быть до 50 МБ" : "Фото или GIF должны быть до 10 МБ"
  }
  return null
}

export function hasCommentMediaSignature(bytes: Uint8Array, ext: string) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (ext === "mp4") return bytes.length >= 12 && ascii(4, 8) === "ftyp"
  if (ext === "gif") return ["GIF87a", "GIF89a"].includes(ascii(0, 6))
  if (ext === "jpg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (ext === "png") return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  if (ext === "webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
  return false
}
