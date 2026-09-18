import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars")

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

function safeAvatarPath(filename: string) {
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(filename)) return null
  const filePath = path.join(AVATAR_DIR, filename)
  if (!filePath.startsWith(`${AVATAR_DIR}${path.sep}`)) return null
  return filePath
}

async function readAvatar(filename: string) {
  const filePath = safeAvatarPath(filename)
  if (!filePath) return null

  try {
    return {
      body: await readFile(filePath),
      contentType: CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream",
    }
  } catch {
    return null
  }
}

export async function GET(_request: Request, ctx: RouteContext<"/uploads/avatars/[filename]">) {
  const { filename } = await ctx.params
  const avatar = await readAvatar(filename)

  if (!avatar) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(avatar.body, {
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Type": avatar.contentType,
    },
  })
}

export async function HEAD(_request: Request, ctx: RouteContext<"/uploads/avatars/[filename]">) {
  const { filename } = await ctx.params
  const avatar = await readAvatar(filename)

  if (!avatar) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(null, {
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Type": avatar.contentType,
      "Content-Length": String(avatar.body.byteLength),
    },
  })
}
