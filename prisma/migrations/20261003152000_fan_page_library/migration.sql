CREATE TYPE "FanPageAssetType" AS ENUM ('AVATAR', 'COVER');

CREATE TABLE "FanPageAsset" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "FanPageAssetType" NOT NULL,
    "geoCode" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "FanPageAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FanPageAsset_type_idx" ON "FanPageAsset"("type");
CREATE INDEX "FanPageAsset_geoCode_idx" ON "FanPageAsset"("geoCode");
CREATE INDEX "FanPageAsset_teamId_idx" ON "FanPageAsset"("teamId");
CREATE INDEX "FanPageAsset_createdAt_idx" ON "FanPageAsset"("createdAt");

ALTER TABLE "FanPageAsset" ADD CONSTRAINT "FanPageAsset_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FanPageAsset" ADD CONSTRAINT "FanPageAsset_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
