-- AlterTable
ALTER TABLE "ActionLog" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'adspower';

-- CreateIndex
CREATE INDEX "ActionLog_source_createdAt_idx" ON "ActionLog"("source", "createdAt");
