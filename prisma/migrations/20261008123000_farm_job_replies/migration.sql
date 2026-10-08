ALTER TABLE "FarmJob" ADD COLUMN "replyToJobId" TEXT;

ALTER TABLE "FarmJob"
  ADD CONSTRAINT "FarmJob_replyToJobId_fkey"
  FOREIGN KEY ("replyToJobId") REFERENCES "FarmJob"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FarmJob_replyToJobId_idx" ON "FarmJob"("replyToJobId");
