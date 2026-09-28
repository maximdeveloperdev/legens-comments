CREATE TABLE "FbAutouploadBindingGroup" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FbAutouploadBindingGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FbAutouploadBinding" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT,
    "config" JSONB NOT NULL,
    "groupId" INTEGER,

    CONSTRAINT "FbAutouploadBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FbAutouploadUpload" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "payload" JSONB,
    "groupId" INTEGER,

    CONSTRAINT "FbAutouploadUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FbAutouploadBindingGroup_createdAt_idx" ON "FbAutouploadBindingGroup"("createdAt");

CREATE INDEX "FbAutouploadBinding_createdAt_idx" ON "FbAutouploadBinding"("createdAt");

CREATE INDEX "FbAutouploadBinding_groupId_idx" ON "FbAutouploadBinding"("groupId");

CREATE INDEX "FbAutouploadUpload_createdAt_idx" ON "FbAutouploadUpload"("createdAt");

CREATE INDEX "FbAutouploadUpload_groupId_idx" ON "FbAutouploadUpload"("groupId");

CREATE INDEX "FbAutouploadUpload_status_idx" ON "FbAutouploadUpload"("status");

ALTER TABLE "FbAutouploadBinding" ADD CONSTRAINT "FbAutouploadBinding_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "FbAutouploadBindingGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FbAutouploadUpload" ADD CONSTRAINT "FbAutouploadUpload_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "FbAutouploadBindingGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
