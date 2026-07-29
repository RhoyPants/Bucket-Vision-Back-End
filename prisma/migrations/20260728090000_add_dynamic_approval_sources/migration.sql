-- Dynamic approver resolution and requester self-approval policy.
ALTER TABLE "ApprovalFlow"
ADD COLUMN IF NOT EXISTS "selfApprovalMode" TEXT NOT NULL DEFAULT 'THROUGH_HIGHEST_STEP';

ALTER TABLE "ApprovalStep"
ADD COLUMN IF NOT EXISTS "approverSource" TEXT NOT NULL DEFAULT 'ROLE';

-- Approval flows already accept configurable role names, so approval history
-- must not be restricted to only the legacy BU_HEAD and OP enum values.
ALTER TABLE "ProjectApproval"
ALTER COLUMN "level" TYPE TEXT USING "level"::TEXT;

ALTER TABLE "ApprovalAuditLog"
ALTER COLUMN "level" TYPE TEXT USING "level"::TEXT;

-- Preserve the meaning of legacy steps that explicitly assigned users.
UPDATE "ApprovalStep"
SET "approverSource" = 'SPECIFIC_USERS'
WHERE "useSpecificUsers" = true;

-- The standard BU_HEAD step now resolves the head from the project's BU.
UPDATE "ApprovalStep" AS step
SET "approverSource" = 'PROJECT_BU_HEAD'
FROM "ApprovalFlow" AS flow
WHERE step."flowId" = flow."id"
  AND flow."isDefault" = true
  AND step."role" = 'BU_HEAD'
  AND step."useSpecificUsers" = false;
