"use server"

import { unlink } from "node:fs/promises"
import path from "node:path"
import { FanPageAssetType, UserRole } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { writeTrackerLog } from "@/lib/action-log"
import { prisma } from "@/lib/db"
import { saveFanPageAssets, type FanPageLibraryActionResult } from "@/lib/fan-page-library-assets"
import { getActiveSession } from "@/lib/session"

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "fan-page-library")

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim()
}

function assetTypeLabel(type: FanPageAssetType) {
  return type === FanPageAssetType.AVATAR ? "аватарка" : "обложка"
}

async function getAllowedTeamIds(userId: string, role: UserRole) {
  if (role === UserRole.ADMIN) return null

  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { teamLeadId: userId },
        { buyers: { some: { userId } } },
      ],
    },
    select: { id: true },
  })

  return teams.map((team) => team.id)
}

async function canUseTeam(userId: string, role: UserRole, teamId: string) {
  if (role === UserRole.ADMIN) {
    return Boolean(await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } }))
  }

  const allowedTeamIds = await getAllowedTeamIds(userId, role)
  return Boolean(allowedTeamIds?.includes(teamId))
}

export async function uploadFanPageAsset(formData: FormData): Promise<FanPageLibraryActionResult> {
  const session = await getActiveSession()
  if (!session) return { error: "Нет доступа" }
  return saveFanPageAssets(session, formData)
}

export async function deleteFanPageAsset(formData: FormData): Promise<FanPageLibraryActionResult> {
  const session = await getActiveSession()
  if (!session) return { error: "Нет доступа" }
  if (session.role === UserRole.USER) return { error: "Нет доступа" }

  const id = getString(formData, "id")
  if (!id) return { error: "Картинка не найдена" }

  const asset = await prisma.fanPageAsset.findUnique({
    where: { id },
    include: {
      team: { select: { id: true, name: true, marker: true } },
    },
  })
  if (!asset) return { error: "Картинка не найдена" }

  if (!(await canUseTeam(session.id, session.role, asset.teamId))) {
    return { error: "Нет доступа к этой команде" }
  }

  await prisma.fanPageAsset.delete({ where: { id } })
  await unlink(path.join(UPLOAD_DIR, asset.fileName)).catch(() => undefined)

  await writeTrackerLog({
    userName: session.name,
    action: "Библиотека Fan Page",
    detail: `Удалил ${assetTypeLabel(asset.type)} · ${asset.geoCode} · ${asset.team.name} (${asset.team.marker})`,
  })

  revalidatePath("/fan-page-library")
  return {}
}

export async function deleteFanPageAssets(formData: FormData): Promise<FanPageLibraryActionResult> {
  const session = await getActiveSession()
  if (!session) return { error: "Нет доступа" }
  if (session.role === UserRole.USER) return { error: "Нет доступа" }

  const ids = Array.from(new Set(formData.getAll("ids").map((id) => String(id).trim()).filter(Boolean)))
  if (ids.length === 0) return { error: "Выберите картинки" }
  if (ids.length > 200) return { error: "За раз можно удалить до 200 картинок" }

  const assets = await prisma.fanPageAsset.findMany({
    where: { id: { in: ids } },
    include: {
      team: { select: { id: true, name: true, marker: true } },
    },
  })
  if (assets.length === 0) return { error: "Картинки не найдены" }
  if (assets.length !== ids.length) return { error: "Часть картинок уже удалена. Обнови страницу" }

  if (session.role !== UserRole.ADMIN) {
    const allowedTeamIds = (await getAllowedTeamIds(session.id, session.role)) ?? []
    const denied = assets.find((asset) => !allowedTeamIds.includes(asset.teamId))
    if (denied) return { error: "Нет доступа к одной из выбранных команд" }
  }

  await prisma.fanPageAsset.deleteMany({ where: { id: { in: ids } } })
  await Promise.all(assets.map((asset) => unlink(path.join(UPLOAD_DIR, asset.fileName)).catch(() => undefined)))

  const teamMarkers = Array.from(new Set(assets.map((asset) => asset.team.marker))).join(", ")
  await writeTrackerLog({
    userName: session.name,
    action: "Библиотека Fan Page",
    detail: `Удалил картинки · ${assets.length} шт. · команды: ${teamMarkers || "—"}`,
  })

  revalidatePath("/fan-page-library")
  return {}
}
