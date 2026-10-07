import { NextResponse } from "next/server"
import { saveFanPageAssets } from "@/lib/fan-page-library-assets"
import { getActiveSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: Request) {
  const session = await getActiveSession()
  if (!session) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 })
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: "Не удалось прочитать файлы" }, { status: 400 })
  }

  const result = await saveFanPageAssets(session, formData).catch((error) => ({
    error: error instanceof Error ? error.message : "Не удалось загрузить картинки",
  }))
  if (result.error) {
    return NextResponse.json(result, { status: 400 })
  }

  return NextResponse.json(result)
}
