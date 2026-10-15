export const DEFAULT_TIME_ZONE = "Europe/Kyiv"

export const TIME_ZONES = [
  ["Europe/Kyiv", "Украина — Киев"],
  ["Europe/Simferopol", "Симферополь"],
  ["Europe/Vienna", "Австрия — Вена"],
  ["Europe/Tirane", "Албания — Тирана"],
  ["Europe/Andorra", "Андорра"],
  ["Europe/Brussels", "Бельгия — Брюссель"],
  ["Europe/Minsk", "Беларусь — Минск"],
  ["Europe/Sofia", "Болгария — София"],
  ["Europe/Sarajevo", "Босния и Герцеговина — Сараево"],
  ["Europe/Vatican", "Ватикан"],
  ["Europe/London", "Великобритания — Лондон"],
  ["Europe/Budapest", "Венгрия — Будапешт"],
  ["Europe/Berlin", "Германия — Берлин"],
  ["Europe/Busingen", "Германия — Бюзинген"],
  ["Europe/Gibraltar", "Гибралтар"],
  ["Europe/Athens", "Греция — Афины"],
  ["Europe/Copenhagen", "Дания — Копенгаген"],
  ["Europe/Dublin", "Ирландия — Дублин"],
  ["Atlantic/Reykjavik", "Исландия — Рейкьявик"],
  ["Europe/Madrid", "Испания — Мадрид"],
  ["Atlantic/Canary", "Испания — Канарские острова"],
  ["Africa/Ceuta", "Испания — Сеута"],
  ["Europe/Rome", "Италия — Рим"],
  ["Asia/Nicosia", "Кипр — Никосия"],
  ["Asia/Famagusta", "Кипр — Фамагуста"],
  ["Europe/Riga", "Латвия — Рига"],
  ["Europe/Vilnius", "Литва — Вильнюс"],
  ["Europe/Vaduz", "Лихтенштейн — Вадуц"],
  ["Europe/Luxembourg", "Люксембург"],
  ["Europe/Malta", "Мальта"],
  ["Europe/Chisinau", "Молдова — Кишинёв"],
  ["Europe/Monaco", "Монако"],
  ["Europe/Amsterdam", "Нидерланды — Амстердам"],
  ["Europe/Oslo", "Норвегия — Осло"],
  ["Europe/Warsaw", "Польша — Варшава"],
  ["Europe/Lisbon", "Португалия — Лиссабон"],
  ["Atlantic/Madeira", "Португалия — Мадейра"],
  ["Atlantic/Azores", "Португалия — Азорские острова"],
  ["Europe/Kaliningrad", "Россия — Калининград"],
  ["Europe/Kirov", "Россия — Киров"],
  ["Europe/Volgograd", "Россия — Волгоград"],
  ["Europe/Astrakhan", "Россия — Астрахань"],
  ["Europe/Saratov", "Россия — Саратов"],
  ["Europe/Ulyanovsk", "Россия — Ульяновск"],
  ["Europe/Samara", "Россия — Самара"],
  ["Europe/Bucharest", "Румыния — Бухарест"],
  ["Europe/San_Marino", "Сан-Марино"],
  ["Europe/Skopje", "Северная Македония — Скопье"],
  ["Europe/Belgrade", "Сербия — Белград"],
  ["Europe/Bratislava", "Словакия — Братислава"],
  ["Europe/Ljubljana", "Словения — Любляна"],
  ["Europe/Istanbul", "Турция — Стамбул"],
  ["Europe/Helsinki", "Финляндия — Хельсинки"],
  ["Europe/Mariehamn", "Финляндия — Аландские острова"],
  ["Europe/Paris", "Франция — Париж"],
  ["Europe/Zagreb", "Хорватия — Загреб"],
  ["Europe/Podgorica", "Черногория — Подгорица"],
  ["Europe/Prague", "Чехия — Прага"],
  ["Europe/Zurich", "Швейцария — Цюрих"],
  ["Europe/Stockholm", "Швеция — Стокгольм"],
  ["Europe/Tallinn", "Эстония — Таллин"],
  ["Atlantic/Faroe", "Фарерские острова"],
  ["Europe/Guernsey", "Гернси"],
  ["Europe/Jersey", "Джерси"],
  ["Europe/Isle_of_Man", "Остров Мэн"],
  ["Arctic/Longyearbyen", "Шпицберген — Лонгйир"],
] as const

const allowed = new Set<string>(TIME_ZONES.map(([zone]) => zone))
export function isAllowedTimeZone(value: unknown): value is string {
  return typeof value === "string" && allowed.has(value)
}
export function normalizeTimeZone(value: unknown) {
  if (value === "Europe/Kiev") return DEFAULT_TIME_ZONE
  return isAllowedTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

export function formatDateTime(value: string | number | Date, timeZone = DEFAULT_TIME_ZONE, options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" }) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: normalizeTimeZone(timeZone) }).format(date)
}

export function timeZoneOffset(timeZone: string, now = new Date()) {
  const label = new Intl.DateTimeFormat("en", { timeZone: normalizeTimeZone(timeZone), timeZoneName: "shortOffset" })
    .formatToParts(now).find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  return label.replace("GMT", "UTC")
}
