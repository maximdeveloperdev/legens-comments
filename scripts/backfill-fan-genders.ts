import { PrismaClient } from "@prisma/client"
import { inferFanGenders } from "../src/lib/fan-gender"

const prisma = new PrismaClient()

function argValue(name: string) {
  const prefix = `${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? ""
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

function numberArg(name: string) {
  const value = Number(argValue(name))
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

async function main() {
  const all = hasArg("--all")
  const dryRun = hasArg("--dry-run")
  const noOpenAi = hasArg("--no-openai")
  const limit = numberArg("--limit")

  const fans = await prisma.facebookFan.findMany({
    where: all ? undefined : { gender: null },
    orderBy: [{ adsPowerUserId: "asc" }, { position: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      gender: true,
      adsPowerUserId: true,
      position: true,
    },
  })

  if (fans.length === 0) {
    console.log("No fans to analyze.")
    return
  }

  const result = await inferFanGenders(
    fans.map((fan) => ({
      key: fan.id,
      name: fan.name,
    })),
    { useOpenAi: !noOpenAi },
  )

  const updates = fans
    .map((fan) => ({ fan, guess: result.guesses.get(fan.id) }))
    .filter(({ guess }) => guess?.gender)

  if (!dryRun && updates.length > 0) {
    await prisma.$transaction(
      updates.map(({ fan, guess }) =>
        prisma.facebookFan.update({
          where: { id: fan.id },
          data: { gender: guess?.gender ?? null },
        }),
      ),
    )
  }

  const unknown = fans
    .map((fan) => ({ fan, guess: result.guesses.get(fan.id) }))
    .filter(({ guess }) => !guess?.gender)

  console.log(
    JSON.stringify(
      {
        analyzed: fans.length,
        updated: dryRun ? 0 : updates.length,
        wouldUpdate: dryRun ? updates.length : undefined,
        dryRun,
        openAiUsed: result.openAiUsed,
        openAiError: result.openAiError,
        counts: result.counts,
        unknownSample: unknown.slice(0, 20).map(({ fan }) => ({
          id: fan.id,
          profileId: fan.adsPowerUserId,
          position: fan.position,
          name: fan.name,
        })),
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
