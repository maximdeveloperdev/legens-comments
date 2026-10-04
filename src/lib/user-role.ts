import { UserRole } from "@prisma/client"

export function isUserRole(value: FormDataEntryValue | string | null): value is UserRole {
  return value === UserRole.ADMIN || value === UserRole.TEAM_LEAD || value === UserRole.USER
}

export function userRoleLabel(role: UserRole | "ADMIN" | "TEAM_LEAD" | "USER") {
  if (role === UserRole.ADMIN) return "Админ"
  if (role === UserRole.TEAM_LEAD) return "Тимлид"
  return "Юзер"
}
