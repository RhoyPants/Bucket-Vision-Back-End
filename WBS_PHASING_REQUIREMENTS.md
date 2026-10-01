# WBS Phasing — Business and System Requirements

## 1. Purpose

This document defines the requirements for adding optional phasing to the project Work Breakdown Structure (WBS) while preserving all existing or legacy projects.

Phasing allows a project to repeat the same delivery process across multiple iterations. For example, Phase 1, Phase 2, and Phase 3 may each contain their own Scoping, Development, Migration, Testing, and Deployment work.

## 2. WBS Structures

### 2.1 Non-phased project

When `isPhasing = false`, the existing WBS structure remains unchanged:

```text
Project
└── Scope
    └── Task
        └── Subtask
```

This is the default structure and applies to all legacy projects unless phasing is explicitly enabled.

### 2.2 Phased project

When `isPhasing = true`, Phase is added as a grouping level between Project and Scope:

```text
Project
└── Phase
    └── Scope
        └── Task
            └── Subtask
```

Example:

```text
Project
├── Phase 1
│   ├── Scoping
│   ├── Development
│   ├── Migration
│   ├── Testing
│   └── Deployment
├── Phase 2
│   ├── Scoping
│   ├── Development
│   ├── Migration
│   ├── Testing
│   └── Deployment
└── Phase 3
    ├── Scoping
    ├── Development
    ├── Migration
    ├── Testing
    └── Deployment
```

Scopes, tasks, and subtasks with the same names may exist in different phases. They are separate records and may have different schedules, budgets, assignees, statuses, dependencies, and progress.

## 3. Business Requirements

### BR-001 — Optional project phasing

The system shall allow a project to use either the existing non-phased WBS or the new phased WBS.

### BR-002 — Legacy-project protection

All projects created before this feature is deployed shall remain non-phased and shall continue to operate without requiring data conversion or user action.

### BR-003 — Default behavior

New and existing projects shall have `isPhasing = false` by default unless the user explicitly enables phasing during an allowed project operation.

### BR-004 — Phase as a grouping layer

A phase shall group a complete Scope → Task → Subtask hierarchy. Adding phasing shall not replace or change the meaning of the existing WBS levels.

### BR-005 — Repeatable WBS content

Different phases may contain scopes, tasks, and subtasks with identical names. Uniqueness rules shall not prevent repeated WBS names across different phases.

### BR-006 — Independent phase records

Each phase and all WBS records under it shall be independent. Updating work in one phase shall not automatically update equivalent work in another phase.

### BR-007 — Irreversible activation

After a project has been saved with `isPhasing = true`, phasing shall not be disabled for that project.

### BR-008 — Version inheritance

When a new version is created from a phased project, the new version shall inherit `isPhasing = true`. A user shall not be allowed to make the new version non-phased.

### BR-009 — Version cloning

Creating a new version of a phased project shall clone its phases and the complete WBS hierarchy under each phase.

### BR-010 — New phases in new versions

Users shall be allowed to add new phases to a newly created version. Adding a phase to the new version shall not modify earlier versions.

Example:

```text
Version 1: Phase 1, Phase 2
Version 2: Phase 1, Phase 2, Phase 3
```

### BR-011 — Version independence

Each project version shall have its own phase and WBS records. Changes made in one version shall not mutate the records of another version.

### BR-012 — Project rollup

For phased projects, project-level progress, budget, schedule, dashboards, and reports shall include work from all applicable phases. Phase-level figures shall be calculated only from the WBS records belonging to that phase.

### BR-013 — Existing functionality

Existing project operations, permissions, approvals, reporting, progress updates, and versioning behavior shall continue to work for non-phased projects.

## 4. Business Rules

| ID | Rule |
|---|---|
| RULE-001 | `isPhasing = false` uses Project → Scope → Task → Subtask. |
| RULE-002 | `isPhasing = true` uses Project → Phase → Scope → Task → Subtask. |
| RULE-003 | A saved `true` value cannot be changed to `false`. |
| RULE-004 | A version cloned from a phased project must also be phased. |
| RULE-005 | A scope in a phased project must belong to exactly one phase. |
| RULE-006 | A scope in a non-phased project must not require a phase. |
| RULE-007 | A phase belongs to exactly one project version. |
| RULE-008 | WBS names may repeat across phases. |
| RULE-009 | Cloned phases and WBS items receive new IDs. |
| RULE-010 | Relationships inside a cloned hierarchy must point to the corresponding cloned records, not the source-version records. |
| RULE-011 | New phases may be added to a new version after cloning. |
| RULE-012 | Earlier project versions remain unchanged when a new version is edited. |

## 5. System Requirements

### SR-001 — Project phasing field

The Project entity shall contain a non-null Boolean field named `isPhasing` with a database default of `false`.

### SR-002 — Phase entity

The system shall provide a Phase entity that, at minimum, supports:

- Unique identifier
- Parent project/version identifier
- Name or title
- Display order
- Optional description
- Created and updated timestamps
- The repository's applicable audit and soft-delete fields

### SR-003 — Scope-to-phase relationship

Scope shall support a nullable phase relationship for backward compatibility:

- Non-phased project: `phaseId = null`
- Phased project: `phaseId` references a phase owned by the same project/version

### SR-004 — Referential validation

The backend shall reject any operation that assigns a scope to a phase belonging to another project or project version.

### SR-005 — Phased-scope validation

The backend shall reject creation or update of a scope without a valid phase when its project has `isPhasing = true`.

### SR-006 — Non-phased-scope validation

The backend shall reject a phase assignment when its project has `isPhasing = false`.

### SR-007 — Irreversible-setting validation

Project update services shall reject an attempt to change `isPhasing` from `true` to `false`, even if a client bypasses the frontend.

### SR-008 — Version-creation validation

The new-version service shall determine phasing from the source project/version. A request payload shall not be allowed to override a source value of `true` with `false`.

### SR-009 — Transactional cloning

Cloning a phased project version shall occur in a database transaction and shall clone, as applicable:

1. Project/version data
2. Phases
3. Scopes assigned to each phase
4. Tasks assigned to each scope
5. Subtasks assigned to each task
6. Supported child records and internal relationships currently included by project version cloning

If any required cloning step fails, the system shall roll back the entire new-version operation.

### SR-010 — Clone ID mapping

The cloning service shall maintain source-to-clone ID mappings for phases, scopes, tasks, and subtasks so that all cloned foreign keys and internal dependencies reference records in the new version.

### SR-011 — Phase management

For authorized users, the backend shall support creating, reading, updating, ordering, and deleting phases subject to project status, permissions, and data-integrity rules.

Deleting a phase shall not leave orphaned scopes or WBS descendants. The final delete/archive behavior must follow the repository's existing deletion and approval conventions.

### SR-012 — API responses

Project detail and WBS APIs shall expose `isPhasing`. For phased projects, the API shall provide phases with their nested WBS content or provide equivalent phase-aware endpoints. Existing non-phased response behavior shall remain compatible with current clients.

### SR-013 — Progress rollup

For phased projects, progress shall roll up in this order:

```text
Subtask → Task → Scope → Phase → Project
```

Non-phased progress shall continue to roll up using the current calculation path:

```text
Subtask → Task → Scope → Project
```

Budgeted and non-budgeted calculation policies shall remain applicable at every supported level.

### SR-014 — Budget validation and rollup

Where budget allocation is enabled, phase and project totals shall follow the project's existing budget-percentage and total-budget rules. Validation shall prevent phase-aware allocations from exceeding the permitted parent allocation.

### SR-015 — Schedule rollup

Phase schedule values shall be derived from or validated against their descendant WBS dates according to existing schedule rules. Project schedule reporting shall include all applicable phases.

### SR-016 — Dashboard and reports

Dashboards, S-curves, summaries, exports, and reports shall include phase context for phased projects and shall not combine same-named WBS items from different phases as if they were one record.

### SR-017 — Search and filtering

Where WBS records are listed or searched, phased projects shall expose sufficient phase identification to distinguish repeated scope, task, and subtask names.

### SR-018 — Authorization

Phase operations shall use the same project access and project-status restrictions that govern WBS maintenance. Client-provided project IDs shall not bypass ownership, membership, role, or approval controls.

### SR-019 — Database migration

The deployment migration shall:

1. Add `Project.isPhasing` as non-null with default `false`.
2. Create the Phase table and its indexes/constraints.
3. Add nullable `Scope.phaseId` and its foreign key/index.
4. Leave all existing projects as `isPhasing = false`.
5. Leave all existing scopes with `phaseId = null`.
6. Avoid deleting, renaming, or re-parenting existing WBS data.

### SR-020 — Auditability

Phase creation, modification, deletion/archive, and cloning shall participate in the repository's applicable audit/activity logging behavior.

### SR-021 — Error handling

The API shall return a clear validation error for at least the following cases:

- Attempting to disable phasing after it was enabled and saved
- Creating a scope without a phase in a phased project
- Assigning a phase to a scope in a non-phased project
- Assigning a scope to a phase from another project/version
- Attempting to override phased mode during version creation
- Referencing a missing, deleted, or inaccessible phase

### SR-022 — Concurrency and consistency

Phase creation, ordering, WBS moves, and version cloning shall preserve consistent parent-child relationships under concurrent requests. Multi-record structural changes shall use transactions.

## 6. API Behavior Summary

### Create project

- Omitted `isPhasing`: store `false`.
- Explicit `isPhasing = false`: create a standard project.
- Explicit `isPhasing = true`: create a phased project and require phase-aware WBS input when WBS content is supplied.

### Update project

- Omitted `isPhasing`: preserve the stored value.
- `false → true`: allowed only under the agreed project-status and conversion workflow.
- `true → false`: always rejected after the project has been saved as phased.

### Create new version

- Source is non-phased: clone the existing non-phased WBS and keep `isPhasing = false`.
- Source is phased: force `isPhasing = true` and clone Phase → Scope → Task → Subtask.
- After cloning a phased version: authorized users may add new phases without modifying the source version.

## 7. Acceptance Criteria

### AC-001 — Legacy project remains operational

Given a project created before the phasing feature,
when the migration is deployed,
then `isPhasing` is `false`, its scopes retain no phase assignment, and its existing WBS operations continue to work.

### AC-002 — New non-phased project

Given a user creates a project without enabling phasing,
when the project is saved,
then its structure remains Project → Scope → Task → Subtask.

### AC-003 — New phased project

Given a user enables phasing,
when the project and WBS are saved,
then each scope belongs to a phase and the structure is Project → Phase → Scope → Task → Subtask.

### AC-004 — Repeated WBS names

Given Phase 1 already contains a scope named Development,
when a user creates another Development scope in Phase 2,
then the operation succeeds and the two scopes remain independent.

### AC-005 — Phasing cannot be disabled

Given a project was saved with `isPhasing = true`,
when any update request attempts to set it to `false`,
then the backend rejects the request and no project or WBS data changes.

### AC-006 — Phased version cloning

Given Version 1 is phased and contains multiple phases,
when Version 2 is created,
then Version 2 is phased and contains cloned phases and complete cloned WBS hierarchies with new IDs.

### AC-007 — New phase in a cloned version

Given Version 2 was cloned from a phased Version 1,
when a user adds Phase 3 to Version 2,
then Phase 3 exists only in Version 2 and Version 1 remains unchanged.

### AC-008 — Cross-project assignment blocked

Given a phase belongs to Project A,
when a request assigns a Project B scope to that phase,
then the backend rejects the request.

### AC-009 — Rollup includes all phases

Given a phased project has work in multiple phases,
when project progress, budget, schedule, dashboard, or reports are calculated,
then all applicable phases are included using the configured project calculation rules.

### AC-010 — Transaction rollback

Given an error occurs while cloning a phased project version,
when the transaction fails,
then no partial project version, phase, scope, task, or subtask clone remains.

## 8. Required Test Coverage

- Database migration against representative legacy data
- Project creation with omitted, false, and true `isPhasing` values
- Attempted `true → false` update through the API
- Scope validation for phased and non-phased projects
- Cross-project and cross-version phase assignment attempts
- Phase CRUD authorization and project-status restrictions
- Full phased-version cloning and source-to-clone relationship checks
- Adding a new phase to a cloned version
- Verification that the source version remains unchanged
- Budgeted and non-budgeted progress rollups
- S-curve, dashboard, report, search, and export behavior
- Transaction rollback during a forced mid-clone failure
- Regression tests for existing non-phased project workflows

## 9. Implementation Clarifications

The following details should be confirmed before implementation if they are not already governed by existing project rules:

1. Whether a non-phased saved project may later be converted from `false` to `true`.
2. If conversion is allowed, whether existing scopes are placed into an automatically created initial phase or a user-selected phase.
3. Whether phases use soft deletion, hard deletion, or archive behavior.
4. Whether phase names must be unique within one project version.
5. Whether a phase has its own manually entered budget and dates or only calculated rollups.
6. Which project statuses allow adding, editing, reordering, or deleting phases.

