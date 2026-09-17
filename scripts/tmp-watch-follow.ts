import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const taskId = process.argv[2]

async function main() {
  const job = await prisma.farmJob.findFirst({ where: { taskId } })
  console.log("STATUS", job?.status, job?.fanName, job?.error || "")
  if (!job) return
  const logs = await prisma.actionLog.findMany({
    where: { createdAt: { gte: job.createdAt } },
    orderBy: { createdAt: "asc" },
    take: 80,
    select: { level: true, detail: true },
  })
  for (const log of logs) {
    if (/Jacopo|Follow|Автор|подпис|лайк|коммент|Действуем|профиль|фото|у поста|карточк|ошиб|Готово|Запускаем|__name/i.test(log.detail)) {
      console.log(`[${log.level}] ${log.detail}`)
    }
  }
}

main().finally(() => prisma.$disconnect())
