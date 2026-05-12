-- Remove FK constraint from Project to WorkSchedule
ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_workScheduleId_fkey";

-- Drop Holiday table
DROP TABLE IF EXISTS "Holiday";

-- Drop WorkSchedule table
DROP TABLE IF EXISTS "WorkSchedule";

-- Add schedule day fields to Project
ALTER TABLE "Project" ADD COLUMN "monday" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN "tuesday" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN "wednesday" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN "thursday" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN "friday" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN "saturday" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "sunday" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "includeHolidays" BOOLEAN NOT NULL DEFAULT true;

-- Remove workScheduleId column
ALTER TABLE "Project" DROP COLUMN "workScheduleId";

-- Remove index
DROP INDEX IF EXISTS "Project_workScheduleId_idx";
