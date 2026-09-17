import { PrismaClient } from "@prisma/client"

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
            fanName: "Jacopo Morandi",
            url: "https://www.facebook.com/100094647666827/posts/935699659594948/",
            message: "Parang may kulang pa sa kwento nila.",
          },
        ],
      },
    },
  })
  console.log(task.id)
}

main().finally(() => prisma.$disconnect())
