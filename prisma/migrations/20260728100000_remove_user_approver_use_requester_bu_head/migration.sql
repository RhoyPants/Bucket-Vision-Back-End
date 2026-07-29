-- Requester approval is resolved dynamically from the requester's Business Unit.
UPDATE "ApprovalStep"
SET "approverSource" = 'REQUESTER_BU_HEAD'
WHERE "approverSource" = 'REQUESTER_APPROVER';

ALTER TABLE "User"
DROP COLUMN IF EXISTS "approverId";
