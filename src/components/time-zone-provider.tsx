"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { DEFAULT_TIME_ZONE, formatDateTime, normalizeTimeZone } from "@/lib/time-zones"

const TimeZoneContext = createContext({ timeZone: DEFAULT_TIME_ZONE, setTimeZone: (value: string) => { void value } })

export function TimeZoneProvider({ initialTimeZone, children }: { initialTimeZone: string; children: ReactNode }) {
  const [timeZone, setTimeZone] = useState(() => normalizeTimeZone(initialTimeZone))
  const value = useMemo(() => ({ timeZone, setTimeZone }), [timeZone])
  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>
}

export function useTimeZone() { return useContext(TimeZoneContext) }

export function DateTime({ value, options }: { value: string; options?: Intl.DateTimeFormatOptions }) {
  const { timeZone } = useTimeZone()
  return <time dateTime={value} title={timeZone}>{formatDateTime(value, timeZone, options)}</time>
}
