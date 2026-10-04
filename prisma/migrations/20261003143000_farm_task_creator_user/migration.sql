ALTER TABLE "FarmTask" ADD COLUMN "createdByUserId" TEXT;

CREATE INDEX "FarmTask_createdByUserId_idx" ON "FarmTask"("createdByUserId");

ALTER TABLE "FarmTask" ADD CONSTRAINT "FarmTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
