-- CreateEnum
CREATE TYPE "FarmJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'ERROR');

-- CreateTable
CREATE TABLE "FarmTask" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "FarmTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "status" "FarmJobStatus" NOT NULL DEFAULT 'PENDING',
    "action" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "fanName" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "error" TEXT,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "FarmJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FarmJob_status_createdAt_idx" ON "FarmJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FarmJob_taskId_createdAt_idx" ON "FarmJob"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "FarmJob" ADD CONSTRAINT "FarmJob_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "FarmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
