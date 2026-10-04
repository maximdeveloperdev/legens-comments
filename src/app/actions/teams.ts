"use server"

import { Prisma, UserRole } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { writeTrackerLog } from "@/lib/action-log"
import { requireAdminSession } from "@/lib/session"

export type TeamActionResult = {
  error?: string
}

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim()
}

function getIds(formData: FormData, key: string) {
  return [...new Set(formData.getAll(key).map((value) => String(value)).filter(Boolean))]
}

function normalizeMarker(value: string) {
  return value.trim()
}

async function validateTeamInput(formData: FormData) {
  const name = getString(formData, "name")
  const marker = normalizeMarker(getString(formData, "marker"))
  const teamLeadId = getString(formData, "teamLeadId")
  const buyerIds = getIds(formData, "buyerIds")

  if (!name || !marker || !teamLeadId) {
    return { error: "Заполните название, маркер и тимлида" }
  }

  if (marker.length > 64) {
    return { error: "Маркер должен быть не длиннее 64 символов" }
  }

  const teamLead = await prisma.user.findFirst({
    where: { id: teamLeadId, role: UserRole.TEAM_LEAD, active: true },
    select: { id: true, name: true },
  })
  if (!teamLead) {
    return { error: "Выберите активного пользователя с ролью тимлид" }
  }

  const buyers = buyerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: buyerIds }, role: UserRole.USER, active: true },
        select: { id: true },
      })
    : []

  if (buyers.length !== buyerIds.length) {
    return { error: "В байерах есть неактивный пользователь или не юзер" }
  }

  return {
    name,
    marker,
    teamLeadId,
    buyerIds,
    teamLeadName: teamLead.name,
  }
}

function markerTakenMessage(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return "Команда с таким маркером уже есть"
  }
  return null
}

export async function createTeam(formData: FormData): Promise<TeamActionResult> {
  const session = await requireAdminSession()
  if (!session) return { error: "Нет доступа" }

  const parsed = await validateTeamInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  try {
    await prisma.team.create({
      data: {
        name: parsed.name,
        marker: parsed.marker,
        teamLeadId: parsed.teamLeadId,
        buyers: {
          create: parsed.buyerIds.map((userId) => ({ userId })),
        },
      },
    })
  } catch (error) {
    return { error: markerTakenMessage(error) ?? "Не удалось создать команду" }
  }

  await writeTrackerLog({
    userName: session.name,
    action: "Создал команду",
    detail: `${parsed.name} · ${parsed.marker} · тимлид ${parsed.teamLeadName} · байеров ${parsed.buyerIds.length}`,
  })

  revalidatePath("/teams")
  return {}
}

export async function updateTeam(formData: FormData): Promise<TeamActionResult> {
  const session = await requireAdminSession()
  if (!session) return { error: "Нет доступа" }

  const id = getString(formData, "id")
  if (!id) return { error: "Команда не найдена" }

  const parsed = await validateTeamInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const current = await prisma.team.findUnique({ where: { id } })
  if (!current) return { error: "Команда не найдена" }

  try {
    await prisma.$transaction([
      prisma.team.update({
        where: { id },
        data: {
          name: parsed.name,
          marker: parsed.marker,
          teamLeadId: parsed.teamLeadId,
        },
      }),
      prisma.teamBuyer.deleteMany({ where: { teamId: id } }),
      prisma.teamBuyer.createMany({
        data: parsed.buyerIds.map((userId) => ({ teamId: id, userId })),
        skipDuplicates: true,
      }),
    ])
  } catch (error) {
    return { error: markerTakenMessage(error) ?? "Не удалось обновить команду" }
  }

  await writeTrackerLog({
    userName: session.name,
    action: "Изменил команду",
    detail: `${parsed.name} · ${parsed.marker} · тимлид ${parsed.teamLeadName} · байеров ${parsed.buyerIds.length}`,
  })

  revalidatePath("/teams")
  return {}
}

export async function deleteTeam(formData: FormData): Promise<TeamActionResult> {
  const session = await requireAdminSession()
  if (!session) return { error: "Нет доступа" }

  const id = getString(formData, "id")
  if (!id) return { error: "Команда не найдена" }

  const current = await prisma.team.findUnique({
    where: { id },
    select: { name: true, marker: true },
  })
  if (!current) return { error: "Команда не найдена" }

  await prisma.team.delete({ where: { id } })

  await writeTrackerLog({
    userName: session.name,
    action: "Удалил команду",
    detail: `${current.name} · ${current.marker}`,
  })

  revalidatePath("/teams")
  return {}
}
