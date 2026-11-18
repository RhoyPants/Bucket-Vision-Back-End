# bucket-vision-backend

The REST API for Project VISION. The frontend is [../bucket-vision-api](../bucket-vision-api/).

## Stack

- Node + Express 5, TypeScript (CommonJS)
- Prisma 5 → PostgreSQL (63 models and enums-heavy schema, 71 migrations)
- Auth: Microsoft ID token verification + app-issued JWT (`jsonwebtoken`), `bcrypt`
- Files: AWS S3 (presigned direct uploads), email via AWS SES
- Reports: Handlebars + Puppeteer (PDF), ExcelJS (Excel)
- Background worker: incident workflow/escalation (`startIncidentWorkflowWorker`)

## Getting started

```bash
npm install
# create .env (see "Environment variables" below)
npx prisma migrate deploy      # or: npx prisma migrate dev
npx prisma generate
npm run seed                   # roles, modules, permissions, base data
npm run dev                    # ts-node-dev on PORT (default 5000)
npm run build                  # tsc → dist/
```

Other seeds: `seed:work-breakdown`, `seed:completed-surevax-local`.

## Structure

```text
src/
  app.ts            Express app, CORS allow-list, route mounting
  server.ts         Boot, incident worker, graceful shutdown
  config/prisma.ts  Shared Prisma client
  middleware/       auth.middleware.ts (JWT), rbac.middleware.ts (authorize(module, action))
  modules/          Feature modules: *.routes.ts → *.controller.ts → *.service.ts
  reports/          Report pipeline (controllers, routes, services, templates, tests)
  services/         s3-assets.service.ts
  utils/            schedule-health, duration-calculator
prisma/             schema.prisma, migrations/, seeds, data/
data/               Reference JSON (regions, provinces, cities, barangays, business units, WBS maintenance)
```

### Modules and route prefixes

| Prefix | Module |
|---|---|
| `/api/auth` | Microsoft SSO login, SSO registration + review, token refresh |
| `/api/users`, `/api/roles`, `/api/modules` | Users, hierarchy, roles/permissions, module registry |
| `/api/projects` | Projects, drafts, versions, structure mode (standard/phased), budgeted flag |
| `/api/phases`, `/api/scopes`, `/api/tasks`, `/api/subtasks` | WBS levels |
| `/api/progress` | Progress logs, update requests, attachments |
| `/api/approvals`, `/api/admin/approval-flows`, `/api/admin/projects`, `/api/admin/approval/steps` | Approval workflow |
| `/api/versioning` | Project versions |
| `/api/project-dashboards`, `/api/dashboard` | Project and personal dashboards, KPIs, notes, snapshots |
| `/api/incidents`, `/api/incident-types`, `/api/admin/incident-*`, `/api/admin/escalation-notification-matrices` | Incident management |
| `/api/reports` | Daily/weekly reports, PDF/Excel export, calendar export |
| `/api/uploads` | Presign / confirm S3 uploads |
| `/api/notifications`, `/api/emails` | In-app notifications, email send |
| `/api/pin-masters` | Pin master data from SharePoint |
| `/api/geographical`, `/api/business-units`, `/api/admin/holidays`, `/api/calendar` | Reference data |
| `/api/admin/work-breakdown-maintenance` | Template scopes/tasks/subtasks per business unit |

`GET /` is a basic liveness response. `GET /test-auth` is a dev probe.

## Authentication and authorization

1. Frontend gets a Microsoft ID token (MSAL) and calls the auth endpoint.
2. Backend validates issuer/audience/tenant against `AZURE_*`, finds the user, and returns an access token, a refresh token, and the role's `permissions` / `pagePermissions`.
3. `authenticate` reads `Authorization: Bearer <token>` (it also accepts `?token=` / `?accessToken=` in the query string, used for file/PDF links).
4. `authorize("module", "ACTION")` looks up `RolePermission` for the user's role. `VIEW` is treated as `READ`. Project-scoped resources resolve their `projectId` from params/body.

## Environment variables

Names only. Never commit values.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (Supabase pooler or direct) |
| `PORT` | HTTP port (default 5000) |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` | Validate Microsoft ID tokens |
| `SP_TENANT_ID`, `SP_CLIENT_ID`, `SP_CLIENT_SECRET`, `SP_SITE_ID`, `SP_PIN_SITE_ID`, `SP_PIN_LIST_ID` | SharePoint (pin master) |
| `ASSETS_ENV`, `AWS_REGION`, `AWS_S3_ASSETS_BUCKET`, `ASSETS_BASE_URL`, `AWS_PROFILE` | S3 asset storage (see [S3_BACKEND_MIGRATION.md](S3_BACKEND_MIGRATION.md)) |
| `AWS_SES_FROM_EMAIL`, `AWS_SES_REGION` | Email |
| `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_NO_SANDBOX` | PDF rendering on servers |
| `REPORT_EXCEL_TEMPLATE_PATH`, `REPORT_IMAGE_ALLOWED_HOSTS` | Report export |
| `REPORT_TEST_PROJECT_ID`, `STRUCTURE_MODE_TEST_DATABASE_URL` | Integration tests only |

## Tests

`npm test` is a placeholder. Tests are standalone `ts-node` scripts:

```bash
npm run test:progress | test:cpm | test:health | test:assets | test:incidents
npm run test:project-structure | test:project-deletion
npm run test:reports | test:reports:integration | test:reports:pdf | test:reports:excel
```

The `*:integration` scripts need a real database.

## Feature documentation

- [APPROVAL_FLOW_IMPLEMENTATION.md](APPROVAL_FLOW_IMPLEMENTATION.md)
- [INCIDENT_ESCALATION_IMPLEMENTATION.md](INCIDENT_ESCALATION_IMPLEMENTATION.md)
- [NON_BUDGETED_PROJECTS.md](NON_BUDGETED_PROJECTS.md)
- [WBS_PHASING_REQUIREMENTS.md](WBS_PHASING_REQUIREMENTS.md)
- [PROJECT_TIMELINE_REMOVAL.md](PROJECT_TIMELINE_REMOVAL.md)
- [S3_BACKEND_MIGRATION.md](S3_BACKEND_MIGRATION.md), [S3_ATTACHMENT_DELETION.md](S3_ATTACHMENT_DELETION.md), [S3_FRONTEND_HANDOFF.md](S3_FRONTEND_HANDOFF.md)
- [EMAIL_FRONTEND_HANDOFF.md](EMAIL_FRONTEND_HANDOFF.md)

## Known issues and risks

1. **Hardcoded JWT secrets** in `src/middleware/auth.middleware.ts` and `src/modules/auth/auth.service.ts` (`"access_secret"`, `"refresh_secret"`). Forgeable tokens. Use env vars and rotate.
2. **Token in query string** is accepted on every authenticated route; it ends up in logs and browser history.
3. **`POST /api/emails/send` is unauthenticated.**
4. **CORS origins are hardcoded** in `app.ts`; changing environments needs a code change.
5. Dead code was cleaned in BV-040 (see [CLEANUP_LOG.md](CLEANUP_LOG.md)). Still open: routes with no known caller (`/api/calendar`, `PATCH /api/modules/:moduleId`, `holidays/range`, `/test-auth`) pending access-log review.
6. `POST /api/auth/refresh` exists but the frontend never calls it.
7. 27 unused declarations under `--noUnusedLocals`.
8. `.env` is present locally; confirm it is covered by `.gitignore` and was never committed. `uploads/` and `dist/` should be ignored too.
9. No CI and no unified test runner.
