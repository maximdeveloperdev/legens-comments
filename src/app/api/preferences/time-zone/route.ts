import { isSameOriginMutation } from "@/lib/same-origin"
import { getActiveSession } from "@/lib/session"
import { prisma } from "@/lib/db"
import { isAllowedTimeZone } from "@/lib/time-zones"

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Запрос с другого сайта запрещён" }, { status: 403 })
  const user = await getActiveSession()
  if (!user) return Response.json({ error: "Нужно войти в аккаунт" }, { status: 401 })
  const input = await request.json().catch(() => null)
  if (!isAllowedTimeZone(input?.timeZone)) return Response.json({ error: "Выберите часовой пояс из списка" }, { status: 400 })
  await prisma.user.update({ where: { id: user.id }, data: { timeZone: input.timeZone } })
  return Response.json({ timeZone: input.timeZone })
}
