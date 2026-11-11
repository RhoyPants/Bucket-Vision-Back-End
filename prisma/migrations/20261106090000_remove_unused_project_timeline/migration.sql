-- Retire unused snapshots. S-curves and progress sync use project structure
-- and ProgressLog, not this table. Apply with the matching backend revision.
DROP TABLE "ProjectTimeline";
