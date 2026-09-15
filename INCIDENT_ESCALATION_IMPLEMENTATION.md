# Incident escalation API

All paths below use the existing `/api` prefix. This repository contains the backend; the frontend tabs and modals must consume these endpoints.

Settings code lives in `src/modules/admin/escalation-matrices` and `src/modules/admin/incident-types`, each with its own controller, service, routes, and DTO files. Incident execution stays in `src/modules/incident-report`. Routes reuse the existing `auth.middleware.ts` and `rbac.middleware.ts`. Controllers handle their HTTP error responses locally, and services use the shared Prisma client directly.

## Configuration

`GET/POST /api/admin/escalation-matrices`, `GET/PATCH/DELETE /api/admin/escalation-matrices/:id`

`GET/POST /api/admin/incident-types`, `GET/PATCH/DELETE /api/admin/incident-types/:id`

Lists accept `page`, `limit` (1–100), `search`, and optional `active=true|false`; omitted `active` includes both statuses. Fetch subsequent pages until `pagination.totalPages` is exhausted. Responses use `{success,data,pagination?}`. Creation returns 201. Deletion returns `{success:true,data:{id,deleted:true}}`.

Matrix fields: `name`, `description`, `isActive`, `allowPeerResolution`, `levels`. PATCH may include `version` as an optimistic concurrency precondition; every successful PATCH increments the version. `levels`, when supplied, is the complete consecutive sequence, saved atomically. Existing level IDs may be retained; new levels omit `id`. Read-only labels must not be sent back as input. The last level must be final and has null SLA; other levels require positive SLA. DAYS accepts whole working days, HOURS accepts positive elapsed hours. Configuration SLA is capped at 36500 units.

Supported assignments: `REQUESTER_BU_HEAD`, `PROJECT_BU_HEAD`, `PROJECT_OWNER`, `ROLE` (`roleId`), `SPECIFIC_USER` (`userId`), `DIRECT_EMAIL` (`email`). Rules: `ANY_ONE` (default), `ALL`. No parallel or self-approval options are accepted.

Incident Type fields: `name`, `description`, `defaultCriticality` (`LOW|MEDIUM|HIGH|CRITICAL`), required `escalationMatrixId`, `isActive`. PATCH may omit an unchanged matrix link. Newly chosen matrices must be active. A deactivation-only PATCH is allowed when the linked matrix is inactive.

Neither resource has `isDefault`, a star action, or a `set-default` endpoint. Incident Type defaults remain out of scope.

Dropdowns: `/api/admin/escalation-matrices?active=true`, `/api/roles?active=true`, `/api/users?active=true`. Existing role/user lists return all results as arrays. User lists omit password and refresh-token fields. Matrix lists are paginated.

## Incident workflow

- `GET /api/incident-types?projectId=...`: paginated selectable types whose linked matrix is also active; project access is checked when provided.
- `POST /api/incidents`: requires `incidentTypeId`; severity comes from its criticality. Existing source fields and attachments are supported. The authenticated user is always the creator.
- `GET /api/incidents/:id`: adds `incidentTypeId`, `escalation`, and `permissions`. Assigned resolvers can access incident details and attachments outside their project membership, subject to incident READ permission.
- `PATCH /api/incidents/:id/resolve`: `{activeLevelId,remarks}`. Resolution timestamps and users are server-controlled. ANY_ONE completes immediately; ALL keeps PENDING and SLA running until every confirmation exists. Identical-user retries for the same level are idempotent. Previous-level confirmations never carry forward.
- `GET /api/incidents/:id/escalation-history?page=1&limit=20`: events have `id`, `incidentId`, `eventType`, `timestamp`, `levelId`, `actorId`, and `details` containing recipients, reasons, SLA or notification information.

Errors: `{success:false,error:{code,message,fields?}}`. Invalid input 400; unauthenticated 401; forbidden 403; missing 404; stale level/version or in-use deletion 409.

## Runtime decisions

- DAYS uses project weekday flags and global holidays. Existing `includeHolidays=true` means holidays are excluded from workdays. The calendar is captured at submission, including holidays. Later schedule/holiday edits do not change that incident's deadlines.
- Projects currently lack timezone settings, so calendar dates use Asia/Manila. A working-day SLA advances from the activation date, preserving local time; the activation date itself is not counted. Weekend activation advances to the next eligible working day. HOURS uses elapsed time.
- Responsible users are determined afresh at each level activation. Active users and active roles are required. Creator conflicts are always removed. When peer resolution is disabled, ROLE compares the creator's role with the configured role; context/user assignments compare with the assigned users' roles.
- Project BU matching follows the existing approval convention: BU id/code/name, falling back to the owner's BU only when the project has no BU value. Ambiguous BU matches produce no assignee.
- Missing assignments and creator conflicts have separate skip reasons. Notification-only email levels send notification and skip immediately. Matching an email grants authority only when that authenticated user's role also has incident UPDATE permission.
- If all levels are exhausted, keep PENDING with `escalation.exception=NO_ELIGIBLE_RESOLVER`; notify active SUPERADMIN users without granting them resolution authority.
- Deactivation blocks new submissions but preserves existing snapshots. Pre-feature incidents retain their original resolution process. New workflow incidents cannot be hard-deleted; cancel instead to preserve the audit trail.
- The server runs a worker every 15 seconds (plus processing time). Expired levels transition when processed; the next SLA starts at actual activation. Row locks and serializable transactions coordinate concurrent transitions and confirmations across server instances.

## Permissions and rollout

The migration creates `settings_escalation_matrices` and `settings_incident_types`. It copies matching action grants from existing approval-flow administrators and grants the four actions to SUPERADMIN. Adjust role permissions as needed. Creating/editing types also permits reading the active matrix list for their dropdown. Incident operations retain `incident_reports` CRUD grants; being an administrator does not bypass resolver governance.

Apply the reviewed migration with `npx prisma migrate deploy`, then run `npx prisma generate` and restart the backend. Stop the running development server first if Windows reports a locked Prisma engine DLL. The migration does not assign types to existing incidents.

In-app notifications reuse the Notification table. Email is handled exclusively by the frontend through its existing email API. This backend does not send, queue, retry, or cancel email and requires no email delivery configuration. Notification audit details include `emailRecipients` and `emailDelivery: "FRONTEND"` as recipient metadata, not evidence of email delivery. DIRECT_EMAIL remains an assignment option for the frontend contract. The background worker only processes SLA escalation; frontend email API calls must be implemented in the frontend repository.

Validation: `npm run build`, `npm run test:incidents`. The test suite uses a fake persistence adapter to exercise business rules; it does not prove PostgreSQL locking or deployment migration behavior.
