# Budgeted and non-budgeted projects

The Project API accepts and returns `isBudgeted`. It defaults to `true`, including for existing database rows. Create accepts JSON booleans or multipart strings `"true"` / `"false"`; other values are rejected. Updates preserve the setting when omitted. Changing it is allowed only in DRAFT and recalculates progress. New versions inherit the setting.

For `false`, totalBudget is stored as null and progress is the average completion of active subtasks. Task and scope progress average their own descendant subtasks. Empty containers contribute no project weight. Partial completion counts; priority, duration, and budget fields do not change weights. Adding/removing subtasks changes the denominator. Deleted subtasks and subtasks under deleted containers are excluded.

Non-budgeted planned and actual curves use equal subtask weights. Unscheduled subtasks contribute zero planned completion rather than disappearing from the denominator. Budgeted calculation paths remain unchanged.

Frontend integration (frontend source is not in this repository):

- Add a “Budgeted project” switch beside Total Budget, initially on.
- Send `isBudgeted` on creation and when changed in draft.
- When off, hide budget/percentage inputs and remove their required validation throughout the wizard.
- Show “Non-budgeted” in the snapshot and summary instead of a currency amount.
- Explain: “Progress is calculated equally across all subtasks.”
- Disable type changes outside DRAFT.

Deployment: apply `prisma/migrations/20260914090000_add_project_is_budgeted/migration.sql` using the normal migration workflow before starting the updated backend; regenerate Prisma Client. No database migration is executed by the source changes themselves.

Verification: `npx tsc --noEmit`, `npx ts-node src/modules/progress/non-budgeted-progress.test.ts`, `npm run test:progress`, `npm run test:reports`.
