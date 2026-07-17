-- Add real user references for business unit heads
ALTER TABLE "BusinessUnit"
ADD COLUMN "buHeadUserId" TEXT,
ADD COLUMN "assistantHeadUserId" TEXT;

ALTER TABLE "BusinessUnit"
ADD CONSTRAINT "BusinessUnit_buHeadUserId_fkey"
FOREIGN KEY ("buHeadUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "BusinessUnit"
ADD CONSTRAINT "BusinessUnit_assistantHeadUserId_fkey"
FOREIGN KEY ("assistantHeadUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "BusinessUnit_buHeadUserId_idx" ON "BusinessUnit"("buHeadUserId");
CREATE INDEX "BusinessUnit_assistantHeadUserId_idx" ON "BusinessUnit"("assistantHeadUserId");
