import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const FAN_PAGE_LIBRARY_DIR = path.join(process.cwd(), "public", "uploads", "fan-page-library")

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

function safeAssetPath(filename: string) {
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(filename)) return null
  const filePath = path.join(FAN_PAGE_LIBRARY_DIR, filename)
  if (!filePath.startsWith(`${FAN_PAGE_LIBRARY_DIR}${path.sep}`)) return null
  return filePath
}

async function readAsset(filename: string) {
  const filePath = safeAssetPath(filename)
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

export async function GET(_request: Request, ctx: RouteContext<"/uploads/fan-page-library/[filename]">) {
  const { filename } = await ctx.params
  const asset = await readAsset(filename)

  if (!asset) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(asset.body, {
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Type": asset.contentType,
    },
  })
}

export async function HEAD(_request: Request, ctx: RouteContext<"/uploads/fan-page-library/[filename]">) {
  const { filename } = await ctx.params
  const asset = await readAsset(filename)

  if (!asset) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(null, {
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.body.byteLength),
    },
  })
}
