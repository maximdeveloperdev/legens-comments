import { cpSync, existsSync } from "fs"
import path from "path"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import countries from "world-countries"

const prisma = new PrismaClient()

function copyFlagIcons() {
  const source = path.join(process.cwd(), "node_modules/flag-icons/flags")
  const target = path.join(process.cwd(), "public/flags")
  if (!existsSync(source)) {
    throw new Error("Пакет flag-icons не установлен")
  }
  cpSync(source, target, { recursive: true })
}

function flagSvgPath(code: string) {
  const file = `${code.toLowerCase()}.svg`
  const absolute = path.join(process.cwd(), "public/flags/4x3", file)
  return existsSync(absolute) ? `/flags/4x3/${file}` : ""
}

async function seedCountries() {
  copyFlagIcons()

  for (const country of countries) {
    const code = country.cca2.toUpperCase()
    const nameEn = country.name.common
    const nameRu = country.translations.rus?.common ?? nameEn
    await prisma.country.upsert({
      where: { code },
      update: {
        code3: country.cca3.toUpperCase(),
        numeric: country.ccn3 || null,
        nameEn,
        nameRu,
        flagEmoji: country.flag ?? "",
        flagSvg: flagSvgPath(code),
        region: country.region || null,
      },
      create: {
        code,
        code3: country.cca3.toUpperCase(),
        numeric: country.ccn3 || null,
        nameEn,
        nameRu,
        flagEmoji: country.flag ?? "",
        flagSvg: flagSvgPath(code),
        region: country.region || null,
      },
    })
  }
}

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@legends.local"
  const adminPassword = process.env.ADMIN_PASSWORD || "legends"
  const passwordHash = await bcrypt.hash(adminPassword, 10)

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: "Админ",
      role: "ADMIN",
      active: true,
    },
    create: {
      email: adminEmail,
      name: "Админ",
      passwordHash,
      role: "ADMIN",
      twoFactorEnabled: false,
      active: true,
    },
  })

  await prisma.user.upsert({
    where: { email: "user@legends.local" },
    update: {},
    create: {
      email: "user@legends.local",
      name: "Юзер",
      passwordHash: await bcrypt.hash("user123", 10),
      role: "USER",
      twoFactorEnabled: false,
      active: true,
    },
  })

  await seedCountries()
}

main()
  .then(async () => {
    const count = await prisma.country.count()
    console.log(`Countries seeded: ${count}`)
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
