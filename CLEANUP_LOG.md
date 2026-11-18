# Cleanup log: unused code removal

Date: 2026-11-18
Source of findings: workspace-level unused-code audit (2026-10-08), re-verified on 2026-11-18 before deleting.

## How to read this

- **Before:** what existed.
- **Why removed:** the evidence that it was unused.
- **Restore:** every deleted file was committed, so it can be brought back with
  `git checkout HEAD -- <path>` inside the repo that owns it (`bucket-vision-api` for frontend, `bucket-vision-backend` for backend). Nothing here was committed by this cleanup; review with `git status` / `git diff`.

## Verification after cleanup

| Check | Before | After |
|---|---|---|
| Frontend `tsc --noEmit` | 0 errors | 0 errors |
| Backend `tsc --noEmit` | 0 errors | 0 errors |
| Frontend `next build --webpack` | not run | passes (all routes generated) |

Not run: ESLint, the `tests/*.cjs` scripts, backend `ts-node` tests, and any manual UI check. The frontend `tests/` folder has no reference to any removed file.

---

## Frontend (`bucket-vision-api`): 6,548 lines removed in 37 files

Method: for every file, a repository search (`app/`, `tests/`, `docs/`, root configs) for its name found no importer other than other files in the same removed group. Paths are relative to `app/`.

### Legacy project tabs (7 files, 284 lines)
`(pages)/projects/components/` — `ActiveProjectsTab` (22), `AllProjectsTab` (24), `ArchivedProjectsTab` (42), `DraftProjectsTab` (24), `ForApprovalTab` (64), `ForReviewTab` (62), `PendingProjectsTab` (46).
**Why:** nothing imports them; the projects page and the My Requests/Approvals pages replaced them.

### Legacy taskboard cluster (8 files, 1,385 lines)
`(pages)/taskboard/Components/` — `ColumnSection` (55), `GridTableView` (465), `ProgressUpdateModal` (335), `SortableTaskCard` (42), `StatCard` (47), `SubtaskCard` (340), `TaskCard` (87); plus `(pages)/taskboard/taskTypes.ts` (14).
**Why:** `ColumnSection` → `SortableTaskCard` → `TaskCard` / `taskTypes` was a closed chain that nothing imported. The live taskboard uses `BoardCardGrid` and `TaskBoardFilters`.
**Careful:** other files share these names and are **kept**: `teamOverview/components/StatCard`, `projects/[id]/setup/components/{TaskCard,SubtaskCard}`, `approvals/[projectId]/components/SubtaskCard`.

### Work-schedule feature, frontend half (4 files, 884 lines)
`(pages)/settings/components/WorkScheduleForm.tsx` (391), `api-service/workScheduleService.ts` (103), `redux/controllers/workScheduleController.ts` (290), `redux/slices/workScheduleSlice.ts` (100); and the `workSchedule` entry in `redux/store.ts`.
**Why:** no page rendered the form, and the backend router it called was never mounted (see backend section). The feature was never reachable.
**Kept:** the per-project `workSchedule` field used by `CreateProject` and `ProjectSetupWizard`; that is a different, working feature.

### Approval step user Redux code (2 files, 249 lines)
`redux/controllers/approvalStepUserController.ts` (172), `redux/slices/approvalStepUserSlice.ts` (77); and the `approvalStepUser` entry in `redux/store.ts`.
**Why:** the approval-flow form calls `approvalStepUserService` directly; the slice was used only by this controller.
**Kept:** `api-service/approvalStepUserService.ts`.

### Personal dashboard remnants (3 files, 301 lines)
`(pages)/personalDashboard/components/` — `ChartConfigDialog` (111), `SummaryTile` (39), `modals/DashboardModal` (151, and its now-empty `modals/` folder).
**Why:** nothing imports them.

### Standalone unused components (13 files, 3,445 lines)
| File | Lines | Note |
|---|---|---|
| `(pages)/settings/components/UserRequests.tsx` | 869 | `settings/page.tsx` imports `UserRequestsPanel` instead |
| `components/shared/selectors/ScopeSelector.tsx` | 681 | |
| `components/shared/progress/ProgressInputCard.tsx` | 454 | stale mention removed from `docs/direct-s3-attachments.md` |
| `components/shared/email/EmailNotificationModal.tsx` | 267 | only a code comment mentioned it |
| `components/shared/modals/ViewDetails.tsx` | 244 | |
| `components/shared/modals/AddTaskModal.tsx` | 234 | |
| `components/shared/project-version/ProjectVersionDrawer.tsx` | 140 | |
| `(pages)/teamOverview/components/TeamRoles.tsx` | 135 | |
| `components/shared/SummaryBar.tsx` | 132 | |
| `components/shared/calendar/DayCell.tsx` | 91 | only importer of `SubtaskBar` |
| `components/shared/calendar/SubtaskBar.tsx` | 75 | |
| `components/shared/selectors/ProjectSelector.tsx` | 64 | |
| `redux/selector.ts` | 59 | |

### Dependencies removed from `package.json` / lockfile
`@dnd-kit/modifiers`, `@mui/x-date-pickers`, `crypto-js`, `pdfjs-dist`, `react-calendar`.
**Why:** no import or reference in `app/`, `tests/`, or config files. `pdfjs-dist` was a risk (the PDF viewer's worker loads from a CDN, not this package), and the build passes without it.

### Public assets removed
`public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`.
**Why:** `create-next-app` template leftovers, referenced nowhere.

### Docs touched
`docs/direct-s3-attachments.md`: removed the `ProgressInputCard.tsx` bullet.

---

## Backend (`bucket-vision-backend`)

### Unmounted work-schedule API (3 files, 668 lines)
`src/modules/admin/work-schedule/` — `work-schedule.controller.ts` (266), `.routes.ts` (81), `.service.ts` (321).
**Why:** never imported or mounted in `src/app.ts`, so its nine endpoints under `/api/admin/work-schedules` were unreachable. Removed together with the frontend half above. No other backend file imported it. Project-level `WorkSchedule` types in `utils/schedule-health.ts` are unrelated and kept.

### Duplicate route removed
`src/modules/subtask/subtask.routes.ts`: the second `GET /task/:taskId` (previously at about line 113, with authentication commented out). Express always used the first, authenticated registration, so this was dead code and behavior is unchanged.

### Dependency removed
`bcryptjs` from `package.json` / lockfile. No source file imports it; the code uses `bcrypt`.

---

## Intentionally NOT removed (needs a decision or outside evidence)

| Item | Why it stays |
|---|---|
| `/api/calendar/*` (4 routes), `PATCH /api/modules/:moduleId`, `GET /api/admin/holidays/range` and `/:id`, `GET /test-auth` | No frontend caller, but other apps may call this API. Check production access logs first. |
| `POST /api/auth/refresh` | Unused by the frontend, but likely an unfinished feature rather than junk. |
| `GET /api/project-dashboards/:projectId/source-preview` | The frontend only uses POST; confirm no external consumer, then remove GET. |
| `POST /api/emails/send` | Used by other apps (confirmed by the owner). |
| FT Sterling fonts (12 `.otf` in `public/fonts`) | Unreferenced, but depends on whether it is still the brand font. |
| `public/images/BG_DARK.png`, `access-denied-illustration.svg`, `login-brand-bg.png` | Unreferenced in code; need product/design confirmation (may be used in emails or external links). |
| `types/exceljs-browser.d.ts`, `reports/components/index.ts` | A declaration file and a barrel; not worth the risk. |
| ~100 unused imports/variables in the frontend, 27 in the backend | Not deleted in this pass; enable `noUnusedLocals` and fix separately. |
| 812 ESLint errors | Separate backlog. |

## New finding while cleaning (not changed)

In `src/modules/subtask/subtask.routes.ts`, `authenticate` and `authorize` are commented out on `PUT /api/subtasks/:id` and `GET /api/subtasks/:id`. These endpoints are open to unauthenticated callers. Left as is because it changes behavior and needs your decision.
