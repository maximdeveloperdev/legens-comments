-- CreateTable
CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "profileId" TEXT,

    CONSTRAINT "ActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookFan" (
    "id" TEXT NOT NULL,
    "adsPowerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacebookFan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionLog_createdAt_idx" ON "ActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "FacebookFan_adsPowerUserId_idx" ON "FacebookFan"("adsPowerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookFan_adsPowerUserId_position_key" ON "FacebookFan"("adsPowerUserId", "position");
