"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { DEFAULT_LANGUAGE, LANGUAGE_LOCALES, translator, type Language } from "@/lib/i18n"

const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE)

export function LanguageProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>
}

export function useLanguage() { return useContext(LanguageContext) }
export function useTranslations() {
  const language = useLanguage()
  return useMemo(() => translator(language), [language])
}

export function useCountryName() {
  const language = useLanguage()
  return useMemo(() => {
    const names = new Intl.DisplayNames([LANGUAGE_LOCALES[language]], { type: "region" })
    return (code: string, fallback: string) => /^[A-Z]{2}$/.test(code) ? names.of(code) ?? fallback : fallback
  }, [language])
}

export function useLocalizedCountries<T extends { name: string }>(countries: Record<string, T>) {
  const countryName = useCountryName()
  return useMemo(() => Object.fromEntries(Object.entries(countries).map(([code, country]) => [code, { ...country, name: countryName(code, country.name) }])), [countries, countryName])
}
