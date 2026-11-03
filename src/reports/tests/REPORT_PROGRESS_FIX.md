# Historical report progress verification

Verified against project `0e0676c0-75a1-4371-83bf-8a57dd5af0bc`, daily report
for October 23, 2026, Asia/Manila. Database operations were read-only.

## Root cause and trace

1. `ProgressLog.dailyPercent` and `cumulativePercent` are PostgreSQL
   `Decimal(5,2)` fields. Prisma returns `Prisma.Decimal` instances.
2. The report query included those fields without converting them. The
   calculation interface incorrectly described the cumulative value as a number.
3. `recordedProgressAt` passed the raw Decimal to `validProgress`, whose strict
   number check returned null. Audit called that same validator directly.
   `dailyProgress` appeared correct because it explicitly used `Number()`.
4. Strict aggregation propagated the missing actual into task, scope, project,
   period delivery, variance, and S-curve values. The health evaluator correctly
   classified its invalid input as UNCLASSIFIED.
5. Audit only checked mismatches when cumulative progress was non-null, so it
   produced no warning and incorrectly called unavailable sequencing CONSISTENT.

`addProgressLog`, `updateProgressLog`, approved correction requests, and deletion
all invoke `recomputeSubtaskProgressInTx`. Daily progress is an incremental
percentage, not a cumulative percentage. The writer sums integer hundredths and
stores a cumulative snapshot per row, ordered by `date`, `createdAt`, `id`.
An edit changes the existing row and recomputes following snapshots; it is not
another increment. Pending/rejected requests do not add delivered progress.
Reports formerly sorted ties by `updatedAt`, which does not match that contract.

## Fix and historical semantics

- Convert database Decimals and supported numeric JSON strings to validated
  numbers at the shared report calculation boundary, and use the same conversion
  for audit. Null, blank, boolean, non-finite, and out-of-range values remain null.
- Sort snapshots using the writer's effective-date/creation/ID order. Use the
  latest snapshot at cutoff; never sum snapshots or read today's subtask progress.
- October 23 cutoff is `2026-10-23T15:59:59.999Z`; opening cutoff is
  `2026-10-22T15:59:59.999Z`. Audit checks increments in integer hundredths.
- Existing no-log history retains the domain's zero/not-started baseline. An
  existing log with missing or invalid progress is unavailable, never zero.
- Evaluate schedule health V2 at cutoff without changing its thresholds or labels.
- Missing sequencing inputs emit `INCOMPLETE_PROGRESS_DATA` and REVIEW_REQUIRED.
  Valid reconciled data may be CONSISTENT while its schedule health is WARNING.
- PDF consumes preview data. Both Excel template paths preserve unavailable
  actuals, use historical membership, and suppress future actual timeline values.

Historical reports reflect currently approved log contents by effective date,
including approved later corrections. They do not reconstruct what the database
contained before a correction. Immutable regeneration needs versioned logs,
schedules, and weights; this change does not claim that capability.

## Corrected daily output

| Metric | management | Dismantling…Concrete Sink | Project |
| --- | ---: | ---: | ---: |
| Previous cumulative | 70.89 | 10 | — |
| Daily/period delivered | 4.17 | 5 | 0.83 |
| Actual cumulative | 75.06 | 15 | 10.32 |
| Expected | 80 | 28.57 | 13.29 |
| Variance (percentage points) | -4.94 | -13.57 | -2.97 |
| Health | WARNING | WARNING | WARNING |

Both subtasks return `Actual progress is behind expected progress.`, ONGOING,
BELOW_PLAN, and CONSISTENT with no sequencing warnings. All stored cumulative
values for both records reconcile with their daily increments. Project health
counts: 14 total, 5 warning, 9 not started, 0 unclassified. October 23 actual
S-curve value is 10.32. No stored-data repair is necessary or performed.

Weekly preview for October 19–25: opening 6.78, closing 11.36, delivered 4.59,
expected 17.18, variance -5.82, DANGER (1 danger, 4 warning, 9 not started).
Period delivery is computed before display rounding, so rounded closing minus
rounded opening can differ by 0.01.

## Validation

- `npm run test:reports`: foundation tests and new offline regression tests pass.
  Covers real Decimal fixtures for both IDs, invalid/missing data versus zero,
  edits, same-day contributors, stable creation/ID ties, cumulative mismatch,
  historical cutoffs, Philippine midnight edges, daily/weekly hierarchy and
  S-curve agreement, PDF rendering and Excel values/gaps.
- `npm run test:reports:progress-records`: read-only database checks pass. Generated
  both daily/weekly PDFs and Excel workbooks; checked PDF source values and actual
  numeric workbook cells. Chromium requires subprocess access outside the sandbox.
- `tsc --noEmit`: passes.
- `npm run test:health`: evaluator tests pass, but the existing dashboard/API test
  fails because its dashboard trend query mock omits `progressLogs`. It also
  retains an assertion that `trends` is absent despite the dashboard returning
  trends. This report change does not modify that separate test or dashboard.
