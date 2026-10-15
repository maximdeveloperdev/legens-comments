import { cookies } from "next/headers"
import { isSameOriginMutation } from "@/lib/same-origin"
import { getActiveSession } from "@/lib/session"
import { prisma } from "@/lib/db"
import { LANGUAGE_COOKIE, isLanguage } from "@/lib/i18n"

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Cross-site request denied" }, { status: 403 })
  const input = await request.json().catch(() => null)
  if (!isLanguage(input?.language)) return Response.json({ error: "Choose ru or uk" }, { status: 400 })
  const user = await getActiveSession()
  if (user) await prisma.user.update({ where: { id: user.id }, data: { language: input.language } })
  const cookieStore = await cookies()
  cookieStore.set(LANGUAGE_COOKIE, input.language, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 24 * 365,
  })
  return Response.json({ language: input.language })
}
