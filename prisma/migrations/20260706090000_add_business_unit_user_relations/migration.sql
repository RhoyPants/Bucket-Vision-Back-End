-- Add real user references for business unit heads
ALTER TABLE "BusinessUnit"
ADD COLUMN IF NOT EXISTS "buHeadUserId" TEXT,
ADD COLUMN IF NOT EXISTS "assistantHeadUserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BusinessUnit_buHeadUserId_fkey'
  ) THEN
    ALTER TABLE "BusinessUnit"
    ADD CONSTRAINT "BusinessUnit_buHeadUserId_fkey"
    FOREIGN KEY ("buHeadUserId") REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BusinessUnit_assistantHeadUserId_fkey'
  ) THEN
    ALTER TABLE "BusinessUnit"
    ADD CONSTRAINT "BusinessUnit_assistantHeadUserId_fkey"
    FOREIGN KEY ("assistantHeadUserId") REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BusinessUnit_buHeadUserId_idx" ON "BusinessUnit"("buHeadUserId");
CREATE INDEX IF NOT EXISTS "BusinessUnit_assistantHeadUserId_idx" ON "BusinessUnit"("assistantHeadUserId");
