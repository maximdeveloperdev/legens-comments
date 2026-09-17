export const ACTION_LOG_PAGE_SIZES = [20, 50, 100, 200, 500] as const

const PAGE_SIZE_SET = new Set<number>(ACTION_LOG_PAGE_SIZES)

export function parseActionLogsPage(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

export function parseActionLogsPageSize(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && PAGE_SIZE_SET.has(parsed) ? parsed : 50
}
