import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getFarmQueueAccess } from "@/lib/farm-queue-access"
import { getActiveSession, type ActiveSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

const FACEBOOK_DEBUG_DIR = path.join(process.cwd(), ".debug", "facebook-errors")
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" }

function safeDebugPath(filename: string) {
  if (!/^[a-zA-Z0-9_.-]+\.png$/.test(filename)) return null
  const filePath = path.join(FACEBOOK_DEBUG_DIR, filename)
  if (!filePath.startsWith(`${FACEBOOK_DEBUG_DIR}${path.sep}`)) return null
  return filePath
}

async function canReadDebugImage(user: ActiveSessionUser, filename: string) {
  const access = await getFarmQueueAccess(user)
  if (access.kind === "all") return true

  // Ownership comes from the saved job, never from a shared AdsPower profile,
  // a display name, the filename, or the caller's current profile permissions.
  const artifact = await prisma.facebookDebugArtifact.findFirst({
    where: {
      filename,
      farmJob: { is: { task: { createdByUserId: { in: access.createdByUserIds } } } },
    },
    select: { filename: true },
  })
  return Boolean(artifact)
}

async function debugImageResponse(ctx: RouteContext<"/api/facebook-debug/[filename]">, head: boolean) {
  const user = await getActiveSession()
  if (!user) return new NextResponse(null, { status: 401, headers: PRIVATE_HEADERS })
  const { filename } = await ctx.params
  // Use the same response for absent and unauthorized files. In particular,
  // HEAD must not reveal whether another user's screenshot exists or its size.
  if (!safeDebugPath(filename) || !(await canReadDebugImage(user, filename))) {
    return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS })
  }

  const body = await readFile(path.join(FACEBOOK_DEBUG_DIR, filename)).catch(() => null)
  if (!body) return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS })

  return new NextResponse(head ? null : body, {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "image/png",
      "Content-Length": String(body.byteLength),
    },
  })
}

export async function GET(_request: Request, ctx: RouteContext<"/api/facebook-debug/[filename]">) {
  return debugImageResponse(ctx, false)
}

export async function HEAD(_request: Request, ctx: RouteContext<"/api/facebook-debug/[filename]">) {
  return debugImageResponse(ctx, true)
}
