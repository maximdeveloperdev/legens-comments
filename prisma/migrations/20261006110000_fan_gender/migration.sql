CREATE TYPE "Gender" AS ENUM ('ANY', 'MALE', 'FEMALE');

ALTER TABLE "FacebookFan" ADD COLUMN "gender" "Gender";

ALTER TABLE "FanPageAsset" ADD COLUMN "gender" "Gender" NOT NULL DEFAULT 'ANY';

CREATE INDEX "FacebookFan_gender_idx" ON "FacebookFan"("gender");
CREATE INDEX "FanPageAsset_gender_idx" ON "FanPageAsset"("gender");
