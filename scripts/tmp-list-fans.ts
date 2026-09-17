import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const fans = await prisma.facebookFan.findMany({ orderBy: { position: "asc" }, take: 8 })
  const jobs = await prisma.farmJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { status: true, fanName: true, action: true, error: true },
  })
  const running = await prisma.farmJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } })
  console.log("FANS", fans.map((f) => `${f.position}:${f.name}:${f.adsPowerUserId}`).join(" | "))
  console.log("JOBS", jobs.map((j) => `${j.action} ${j.fanName} ${j.status} ${j.error || ""}`).join(" || "))
  console.log("ACTIVE", running)
}

main().finally(() => prisma.$disconnect())
