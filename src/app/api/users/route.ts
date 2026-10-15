import { createUser, updateUser } from "@/app/actions/users"
import { isSameOriginMutation } from "@/lib/same-origin"

async function save(request: Request, update: boolean) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Запрос с другого сайта запрещён" }, { status: 403 })
  try {
    const form = await request.formData().catch(() => null)
    if (!form) return Response.json({ error: "Не удалось прочитать форму пользователя" }, { status: 400 })
    const result = update ? await updateUser(form) : await createUser(form)
    return Response.json(result, { status: result.error ? result.error === "Нет доступа" ? 403 : 400 : 200 })
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown"
    if (code === "P2002") return Response.json({ error: "Пользователь с такой почтой уже есть" }, { status: 409 })
    console.error("User save failed", { code })
    return Response.json({ error: "Не удалось сохранить пользователя. Обновите список и проверьте результат перед повторной попыткой." }, { status: 500 })
  }
}

export async function POST(request: Request) { return save(request, false) }
export async function PUT(request: Request) { return save(request, true) }
