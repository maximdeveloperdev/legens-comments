import { cache } from "react"
import { cookies } from "next/headers"
import { getActiveSession } from "@/lib/session"
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, isLanguage, translator } from "@/lib/i18n"

export const getLanguage = cache(async () => {
  const user = await getActiveSession()
  if (isLanguage(user?.language)) return user.language
  const stored = (await cookies()).get(LANGUAGE_COOKIE)?.value
  return isLanguage(stored) ? stored : DEFAULT_LANGUAGE
})

export async function getTranslations() {
  return translator(await getLanguage())
}
