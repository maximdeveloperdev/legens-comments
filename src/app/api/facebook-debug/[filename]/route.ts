import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"
import { getActiveSession } from "@/lib/session"

export const dynamic = "force-dynamic"

const FACEBOOK_DEBUG_DIR = path.join(process.cwd(), ".debug", "facebook-errors")

function safeDebugPath(filename: string) {
  if (!/^[a-zA-Z0-9_.-]+\.png$/.test(filename)) return null
  const filePath = path.join(FACEBOOK_DEBUG_DIR, filename)
  if (!filePath.startsWith(`${FACEBOOK_DEBUG_DIR}${path.sep}`)) return null
  return filePath
}

async function readDebugImage(filename: string) {
  const filePath = safeDebugPath(filename)
  if (!filePath) return null

  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

export async function GET(_request: Request, ctx: RouteContext<"/api/facebook-debug/[filename]">) {
  const user = await getActiveSession()
  if (!user) return new NextResponse(null, { status: 401 })

  const { filename } = await ctx.params
  const body = await readDebugImage(filename)
  if (!body) return new NextResponse(null, { status: 404 })

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Type": "image/png",
    },
  })
}

export async function HEAD(_request: Request, ctx: RouteContext<"/api/facebook-debug/[filename]">) {
  const user = await getActiveSession()
  if (!user) return new NextResponse(null, { status: 401 })

  const { filename } = await ctx.params
  const body = await readDebugImage(filename)
  if (!body) return new NextResponse(null, { status: 404 })

  return new NextResponse(null, {
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Type": "image/png",
      "Content-Length": String(body.byteLength),
    },
  })
}
