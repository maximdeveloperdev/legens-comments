import ukMessages from "@/lib/messages/uk.json"

export type Language = "ru" | "uk"
export const LANGUAGE_COOKIE = "legends-language"
export const DEFAULT_LANGUAGE: Language = "ru"
export const LANGUAGE_LOCALES = { ru: "ru-RU", uk: "uk-UA" } as const

export function isLanguage(value: unknown): value is Language {
  return value === "ru" || value === "uk"
}

const ukrainian: Record<string, string> = ukMessages

// Russian source messages are stable keys; interpolation keeps user content intact.
export function translate(language: Language, message: string, ...values: unknown[]) {
  const core = message.trim()
  const translated = language === "uk" && Object.hasOwn(ukrainian, core)
    ? message.slice(0, message.indexOf(core)) + ukrainian[core] + message.slice(message.indexOf(core) + core.length)
    : message
  return translated.replace(/\{(\d+)\}/g, (token, index: string) => values[Number(index)] === undefined ? token : String(values[Number(index)]))
}

export function translator(language: Language) {
  return (message: string, ...values: unknown[]) => translate(language, message, ...values)
}
