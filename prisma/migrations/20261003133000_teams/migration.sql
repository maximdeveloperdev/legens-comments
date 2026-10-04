ALTER TYPE "UserRole" ADD VALUE 'TEAM_LEAD';

CREATE TABLE "Team" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "marker" TEXT NOT NULL,
  "teamLeadId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamBuyer" (
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "TeamBuyer_pkey" PRIMARY KEY ("teamId", "userId")
);

CREATE UNIQUE INDEX "Team_marker_key" ON "Team"("marker");
CREATE INDEX "Team_teamLeadId_idx" ON "Team"("teamLeadId");
CREATE INDEX "TeamBuyer_userId_idx" ON "TeamBuyer"("userId");

ALTER TABLE "Team" ADD CONSTRAINT "Team_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamBuyer" ADD CONSTRAINT "TeamBuyer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamBuyer" ADD CONSTRAINT "TeamBuyer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
