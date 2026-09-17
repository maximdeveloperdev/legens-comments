-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "code3" TEXT NOT NULL,
    "numeric" TEXT,
    "nameEn" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "flagEmoji" TEXT NOT NULL,
    "flagSvg" TEXT NOT NULL,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Country_code3_key" ON "Country"("code3");
