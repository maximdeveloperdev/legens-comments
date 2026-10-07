import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { FanPageAssetType, Gender, UserRole } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { writeTrackerLog } from "@/lib/action-log"
import { prisma } from "@/lib/db"
import type { ActiveSessionUser } from "@/lib/session"

export type FanPageLibraryActionResult = {
  error?: string
  uploaded?: number
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_UPLOAD_FILES = 20
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "fan-page-library")

const mimeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim()
}

function parseAssetType(value: string) {
  if (value === "AVATAR" || value === "COVER") return value
  return null
}

function parseGender(value: string) {
  if (value === Gender.MALE || value === Gender.FEMALE || value === Gender.ANY) return value
  return Gender.ANY
}

function normalizeGeoCode(value: string) {
  return value.trim().toUpperCase()
}

function assetTypeLabel(type: FanPageAssetType) {
  return type === FanPageAssetType.AVATAR ? "аватарка" : "обложка"
}

function genderLabel(gender: Gender) {
  if (gender === Gender.MALE) return "мужские"
  if (gender === Gender.FEMALE) return "женские"
  return "любой пол"
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

function validateImage(file: File) {
  if (file.size === 0) return "Выберите картинку"
  if (file.size > MAX_IMAGE_SIZE) return "Файл должен быть до 10 МБ"
  if (!mimeToExt[file.type]) return "Нужен JPG, PNG или WEBP"
  return null
}

export async function saveFanPageAssets(
  session: ActiveSessionUser,
  formData: FormData,
): Promise<FanPageLibraryActionResult> {
  const type = parseAssetType(getString(formData, "type"))
  const gender = type === FanPageAssetType.AVATAR ? parseGender(getString(formData, "gender")) : Gender.ANY
  const geoCode = normalizeGeoCode(getString(formData, "geoCode"))
  const teamId = getString(formData, "teamId")
  const files = formData.getAll("files").filter((file): file is File => file instanceof File)

  if (!type) return { error: "Выберите аватарку или обложку" }
  if (!geoCode) return { error: "Выберите гео" }
  if (!teamId) return { error: "Выберите команду" }
  if (files.length === 0) return { error: "Выберите картинки" }
  if (files.length > MAX_UPLOAD_FILES) return { error: `За раз можно загрузить до ${MAX_UPLOAD_FILES} картинок` }

  for (const file of files) {
    const imageError = validateImage(file)
    if (imageError) return { error: `${file.name || "Файл"}: ${imageError}` }
  }

  const country = await prisma.country.findUnique({
    where: { code: geoCode },
    select: { code: true },
  })
  if (!country) return { error: "Гео не найдено" }

  if (!(await canUseTeam(session.id, session.role, teamId))) {
    return { error: "Нет доступа к этой команде" }
  }

  await mkdir(UPLOAD_DIR, { recursive: true })
  const savedFiles = []
  for (const file of files) {
    const ext = mimeToExt[file.type]
    const fileName = `${Date.now()}-${randomUUID()}.${ext}`
    const diskPath = path.join(UPLOAD_DIR, fileName)
    await writeFile(diskPath, Buffer.from(await file.arrayBuffer()))
    savedFiles.push({ file, fileName })
  }

  await prisma.fanPageAsset.createMany({
    data: savedFiles.map(({ file, fileName }) => ({
      type,
      gender,
      geoCode,
      teamId,
      fileName,
      originalName: file.name || fileName,
      mimeType: file.type,
      size: file.size,
      url: `/uploads/fan-page-library/${fileName}`,
      createdByUserId: session.id,
    })),
  })

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { name: true, marker: true },
  })

  await writeTrackerLog({
    userName: session.name,
    action: "Библиотека Fan Page",
    detail: `Добавил ${assetTypeLabel(type)} · ${type === FanPageAssetType.AVATAR ? `${genderLabel(gender)} · ` : ""}${geoCode} · ${team?.name ?? "команда"} (${team?.marker ?? "—"}) · ${savedFiles.length} шт.`,
  })

  revalidatePath("/fan-page-library")
  return { uploaded: savedFiles.length }
}
