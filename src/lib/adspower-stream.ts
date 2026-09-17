import { revalidatePath } from "next/cache"
import { writeActionLog, writeTrackerLog } from "@/lib/action-log"
import { requireAdminSession } from "@/lib/session"

export const maxDuration = 180
export const dynamic = "force-dynamic"

type RunFn = (
  profileId: string,
  onLog: (line: { level: "info" | "ok" | "error"; text: string }) => void,
) => Promise<{ ok: boolean; message: string }>

export async function streamAdsPowerRun(options: {
  request: Request
  action: string
  run: RunFn
}) {
  const session = await requireAdminSession()
  if (!session) {
    return Response.json({ error: "Нет доступа" }, { status: 403 })
  }

  const body = (await options.request.json().catch(() => null)) as {
    profileId?: string
  } | null
  const profileId = body?.profileId?.trim() || ""
  if (!profileId) {
    return Response.json({ error: "Выберите профиль" }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      await writeTrackerLog({
        userName: session.name,
        action: options.action,
        detail: `Запустил · профиль ${profileId}`,
        profileId,
      })

      const result = await options.run(profileId, (line) => {
        send({ type: "log", level: line.level, text: line.text })
        void writeActionLog({
          userName: session.name,
          action: options.action,
          detail: line.text,
          level: line.level,
          profileId,
          source: "adspower",
        })
      })

      await writeTrackerLog({
        userName: session.name,
        action: options.action,
        detail: result.message,
        level: result.ok ? "ok" : "error",
        profileId,
      })

      send({
        type: "done",
        ok: result.ok,
        message: result.message,
      })
      try {
        revalidatePath("/constructor")
        revalidatePath("/settings/adspower")
      } catch {
        // stream already started
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
