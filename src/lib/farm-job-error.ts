function firstLine(value: string) {
  return value.split(/\r?\n/)[0]?.trim() ?? ""
}

function trimMessage(value: string, max = 220) {
  const clean = value.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean
}

export function formatFarmJobError(value: string | null | undefined) {
  const raw = (value ?? "").trim()
  if (!raw) return null

  const lower = raw.toLowerCase()

  if (
    lower.includes("comment as") ||
    lower.includes("write a comment") ||
    lower.includes("write a public comment") ||
    lower.includes("напишите комментарий") ||
    lower.includes("оставьте комментарий") ||
    lower.includes("написати коментар") ||
    lower.includes("skomentuj jako") ||
    lower.includes("napisz komentarz") ||
    lower.includes("escribe un comentario") ||
    lower.includes("escrever um comentário") ||
    lower.includes("scrivi un commento") ||
    lower.includes("écrivez un commentaire")
  ) {
    return "Не найдено поле комментария на посте. Возможно, пост закрыт, комментарии отключены или Facebook показал другой экран."
  }

  if (lower.includes("this content isn't available") || lower.includes("this page isn't available")) {
    return "Контент Facebook недоступен. Пост удалён, закрыт приватностью или аккаунту нет доступа."
  }

  if (lower.includes("facebook просит логин") || lower.includes("login") || lower.includes("log in")) {
    return "Facebook просит повторный вход. Проверь логин/пароль профиля AdsPower."
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Facebook не загрузил нужный элемент вовремя. Можно перезапустить задачу или проверить доступность поста."
  }

  if (lower.includes("target closed") || lower.includes("browser has been closed")) {
    return "Браузер AdsPower закрылся во время выполнения задачи."
  }

  if (lower.includes("no limit") || lower.includes("quota") || lower.includes("insufficient_quota")) {
    return "Недостаточно лимита ChatGPT для генерации комментария."
  }

  if (lower.includes("остановлено")) return "Задача остановлена вручную."

  return trimMessage(firstLine(raw))
}
