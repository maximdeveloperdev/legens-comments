CREATE TABLE "FanFormatJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "status" "FarmJobStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "profileId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "fans" JSONB NOT NULL,
    "formatted" JSONB,
    "pending" JSONB,
    "failed" JSONB,
    "message" TEXT NOT NULL DEFAULT '',
    "error" TEXT,

    CONSTRAINT "FanFormatJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FanFormatJob_status_createdAt_idx" ON "FanFormatJob"("status", "createdAt");
CREATE INDEX "FanFormatJob_profileId_createdAt_idx" ON "FanFormatJob"("profileId", "createdAt");
CREATE INDEX "FanFormatJob_createdByUserId_createdAt_idx" ON "FanFormatJob"("createdByUserId", "createdAt");

ALTER TABLE "FanFormatJob" ADD CONSTRAINT "FanFormatJob_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
