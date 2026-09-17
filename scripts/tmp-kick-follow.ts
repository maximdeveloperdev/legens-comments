import { PrismaClient } from "@prisma/client"
import { kickFarmQueue } from "../src/lib/farm-queue"

const prisma = new PrismaClient()

async function main() {
  const task = await prisma.farmTask.create({
    data: {
      createdBy: "follow-fix",
      action: "subscribe",
      total: 1,
      jobs: {
        create: [
          {
            action: "subscribe",
            profileId: "k1gxjo0k",
            fanName: "Emanuele Ferraro",
            url: "https://www.facebook.com/100094647666827/posts/935699659594948/",
            message: "Grabe, curious ako kung anong next move nila.",
          },
        ],
      },
    },
  })
  console.log("TASK", task.id)
  kickFarmQueue()

  for (let i = 0; i < 80; i += 1) {
    const job = await prisma.farmJob.findFirst({ where: { taskId: task.id } })
    console.log(`tick ${i} ${job?.status} ${job?.error || ""}`)
    if (job && (job.status === "DONE" || job.status === "ERROR")) {
      const logs = await prisma.actionLog.findMany({
        where: { createdAt: { gte: job.createdAt } },
        orderBy: { createdAt: "asc" },
        take: 100,
        select: { level: true, detail: true },
      })
      for (const log of logs) {
        if (/Emanuele|Follow|Автор|подпис|лайк|коммент|Действуем|профиль|фото|у поста|карточк|ошиб|Готово/i.test(log.detail)) {
          console.log(`[${log.level}] ${log.detail}`)
        }
      }
      return
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
}

main().finally(() => prisma.$disconnect())
