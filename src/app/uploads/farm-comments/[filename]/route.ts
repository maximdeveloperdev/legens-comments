import { open } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

export const dynamic = "force-dynamic"

const MEDIA_DIR = path.join(process.cwd(), "public", "uploads", "farm-comments")
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4",
}

function requestedRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || !size) return null
  const first = match[1] ? Number(match[1]) : null
  const last = match[2] ? Number(match[2]) : null
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null
  const start = first ?? Math.max(0, size - (last ?? 0))
  const end = first === null || last === null ? size - 1 : Math.min(last, size - 1)
  return start >= 0 && start < size && end >= start ? { start, end } : null
}

async function serve(request: Request, filename: string, head: boolean) {
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif|mp4)$/i.test(filename)) return new Response(null, { status: 404 })
  const file = await open(path.join(MEDIA_DIR, filename), "r").catch(() => null)
  if (!file) return new Response(null, { status: 404 })
  try {
    const stat = await file.stat()
    if (!stat.isFile()) { await file.close(); return new Response(null, { status: 404 }) }
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPES[path.extname(filename).toLowerCase()],
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    }
    if (head || !stat.size) { await file.close(); return new Response(null, { headers }) }
    const rangeHeader = request.headers.get("Range")
    // Ignore Range when If-Range is present: serve the complete current file.
    // This is valid without maintaining validators for immutable upload names.
    const range = rangeHeader && !request.headers.has("If-Range") ? requestedRange(rangeHeader, stat.size) : undefined
    if (range === null) {
      await file.close()
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}`, "Accept-Ranges": "bytes" } })
    }
    if (range) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`
      headers["Content-Length"] = String(range.end - range.start + 1)
    }
    const stream = file.createReadStream({ ...(range ?? {}), autoClose: true })
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers })
  } catch {
    await file.close().catch(() => undefined)
    return new Response(null, { status: 404 })
  }
}

export async function GET(request: Request, context: { params: Promise<{ filename: string }> }) {
  return serve(request, (await context.params).filename, false)
}

export async function HEAD(request: Request, context: { params: Promise<{ filename: string }> }) {
  return serve(request, (await context.params).filename, true)
}
