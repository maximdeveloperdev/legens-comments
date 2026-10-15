CREATE TABLE "FacebookDebugArtifact" (
    "filename" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "farmJobId" TEXT,
    CONSTRAINT "FacebookDebugArtifact_pkey" PRIMARY KEY ("filename")
);

CREATE INDEX "FacebookDebugArtifact_farmJobId_idx" ON "FacebookDebugArtifact"("farmJobId");
ALTER TABLE "FacebookDebugArtifact" ADD CONSTRAINT "FacebookDebugArtifact_farmJobId_fkey"
    FOREIGN KEY ("farmJobId") REFERENCES "FarmJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Recover legacy queue screenshots only from the exact screenshot log message.
-- A URL or error mentioning another file must never establish ownership.
-- Ambiguous or missing run intervals remain unassigned (admin access only).
WITH screenshots AS (
    SELECT "createdAt", "profileId",
        substring(detail FROM '^[^:\r\n]+: Debug сохранён: [^\r\n]*/\.debug/facebook-errors/([a-zA-Z0-9_.-]+\.png)$') AS filename
    FROM "ActionLog"
    WHERE source = 'adspower' AND action = 'Очередь' AND level = 'info'
), recovered AS (
    SELECT s.filename, min(s."createdAt") AS "createdAt",
        CASE WHEN count(DISTINCT j.id) = 1 AND bool_and(j.id IS NOT NULL)
            THEN min(j.id) ELSE NULL END AS "farmJobId"
    FROM screenshots s
    LEFT JOIN "FarmJob" j ON j."profileId" = s."profileId"
        AND j."startedAt" <= s."createdAt" AND j."finishedAt" >= s."createdAt"
    WHERE s.filename IS NOT NULL
    GROUP BY s.filename
)
INSERT INTO "FacebookDebugArtifact" ("filename", "createdAt", "farmJobId")
SELECT filename, "createdAt", "farmJobId" FROM recovered;
