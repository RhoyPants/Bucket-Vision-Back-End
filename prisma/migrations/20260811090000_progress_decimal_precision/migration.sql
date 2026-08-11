-- Capture legacy subtasks that the old application already displayed as 100%.
-- This must happen before FLOAT columns are converted and before log totals are rebuilt.
CREATE TEMP TABLE "LegacyCompletedSubtask" ON COMMIT DROP AS
SELECT id
FROM "Subtask"
WHERE progress::numeric >= 99.9990;

-- Normalize legacy binary floating-point values before changing their type.
-- Historical cumulative values >= 99.9990 are grandfathered as exactly 100.00.
-- Example: a historical 0.009 daily entry becomes 0.01 and 99.999... becomes 100.00.
ALTER TABLE "ProgressLog"
  ALTER COLUMN "dailyPercent" TYPE DECIMAL(5,2) USING ROUND("dailyPercent"::numeric, 2),
  ALTER COLUMN "cumulativePercent" TYPE DECIMAL(5,2) USING LEAST(100.00, GREATEST(0.00,
    CASE
      WHEN "cumulativePercent"::numeric >= 99.9990 THEN 100.00
      ELSE ROUND("cumulativePercent"::numeric, 2)
    END
  ));

ALTER TABLE "Project"
  ALTER COLUMN "progress" TYPE DECIMAL(5,2) USING LEAST(100.00, GREATEST(0.00, ROUND("progress"::numeric, 2)));
ALTER TABLE "Scope"
  ALTER COLUMN "progress" TYPE DECIMAL(5,2) USING LEAST(100.00, GREATEST(0.00, ROUND("progress"::numeric, 2)));
ALTER TABLE "Task"
  ALTER COLUMN "progress" TYPE DECIMAL(5,2) USING LEAST(100.00, GREATEST(0.00, ROUND("progress"::numeric, 2)));
ALTER TABLE "Subtask"
  ALTER COLUMN "progress" TYPE DECIMAL(5,2) USING LEAST(100.00, GREATEST(0.00, ROUND("progress"::numeric, 2)));

-- Rebuild every stored running total from the normalized daily values.
WITH running AS (
  SELECT id,
         CASE
           -- Preserve the explicit legacy-completion normalization above even
           -- when rounded daily entries add up to 99.99.
           WHEN "cumulativePercent" = 100.00 THEN 100.00
           ELSE LEAST(100.00, SUM("dailyPercent") OVER (
             PARTITION BY "subtaskId"
             ORDER BY date, "createdAt", id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ))
         END AS cumulative
  FROM "ProgressLog"
)
UPDATE "ProgressLog" p
SET "cumulativePercent" = running.cumulative
FROM running
WHERE p.id = running.id;

ALTER TABLE "ProgressLog"
  ADD CONSTRAINT "ProgressLog_dailyPercent_range" CHECK ("dailyPercent" > 0.00 AND "dailyPercent" <= 100.00) NOT VALID,
  ADD CONSTRAINT "ProgressLog_cumulativePercent_range" CHECK ("cumulativePercent" >= 0.00 AND "cumulativePercent" <= 100.00);

-- Synchronize the denormalized subtask value. Legacy rows normalized to 100%
-- are grandfathered as Done. Future API mutations still enforce the checklist.
WITH totals AS (
  SELECT DISTINCT ON ("subtaskId") "subtaskId", "cumulativePercent"
  FROM "ProgressLog"
  ORDER BY "subtaskId", date DESC, "createdAt" DESC, id DESC
)
UPDATE "Subtask" s
SET progress = totals."cumulativePercent",
    status = CASE
      WHEN totals."cumulativePercent" = 100.00 THEN 2
      WHEN totals."cumulativePercent" > 0.00 THEN 1
      ELSE 0
    END
FROM totals
WHERE s.id = totals."subtaskId";

-- The subtask's old stored progress is the final authority for grandfathering.
-- This fixes records that returned progress ~= 99.99999 with status = 1 even
-- when their historical log totals do not reconstruct to exactly 100.00.
UPDATE "Subtask" s
SET progress = 100.00,
    status = 2
FROM "LegacyCompletedSubtask" legacy
WHERE s.id = legacy.id;
