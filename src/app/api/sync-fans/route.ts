import { runFacebookFanSync } from "@/lib/facebook-page-switch"
import { streamAdsPowerRun } from "@/lib/adspower-stream"

export const maxDuration = 180
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return streamAdsPowerRun({
    request,
    action: "Синхронизация фанок",
    run: runFacebookFanSync,
  })
}
