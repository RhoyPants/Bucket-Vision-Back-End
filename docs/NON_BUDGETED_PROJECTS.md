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

## Computed schedule health (budgeted and non-budgeted)

Schedule-health V2 requires no additional migration or record conversion. Both project types use the same fixed deadline-aware evaluator, project working days, holiday exclusions, and Asia/Manila calendar days. An October 29 deadline becomes overdue on October 30. Reports evaluate at their historical cutoff.

Health-bearing responses identify `healthRulesVersion: 2`. Summary counters are `total`, `danger`, `warning`, `healthy`, `notStarted`, and `unclassified`; evaluated rows include `statusReason`. `UNCLASSIFIED` displays as Unavailable. Completion at 100% is Healthy; incomplete overdue work is Danger; pre-deadline variance, missed-start, or available forecast risk is Warning. Missing or invalid actual progress/schedules are not replaced with artificial zeros. Forecasts are optional; the evaluator accepts valid forecast dates but does not invent forecasts for unlinked work.

`warningBelow` is computed as 0. Configuration PUT accepts only `{ "warningBelow": 0 }`; non-zero or non-numeric tolerance is rejected. Reset does not delete legacy settings. Custom targets accept omitted/zero tolerance and preserve saved legacy threshold columns on updates. No V2 health is written to legacy dashboard snapshots, and V2 trends are omitted. Main-dashboard `breakdownProjects` contains all accessible active projects, while `topProjects` remains a five-project preview.

Report PDF/Excel downloads expose `X-Health-Rules-Version: 2` through CORS. Frontends should make tolerance controls read-only in this fixed-rule phase. CPM critical-path terminology, subtask workflow status, and incident Critical severity are unchanged.

Schedule-health verification: `npm run test:health`, `npm run test:cpm`, `npm run test:reports`, `npm run test:reports:integration`, `npm run test:reports:pdf`, `npm run test:reports:excel`, and `npm run build`.
