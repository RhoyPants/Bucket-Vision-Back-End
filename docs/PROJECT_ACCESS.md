# Project Access (which projects a role can see)

Configurable per role in **Settings > Roles > Edit Role > Project Access**. It replaces the role names that used to be hard-coded (`SUPERADMIN`, `OP`, `BU_HEAD`) wherever the app decides which projects someone can see.

Code: `src/modules/project-access/` (`keys`, `service`, `routes`, tests, parity script) and `src/modules/project/project-access.ts` (`buildAccessibleProjectWhere`).
Migration: `prisma/migrations/20261122090000_add_role_project_access` (creates the table only; **no seed**).
Frontend: `bucket-vision-api/docs/discussions.md` is unrelated; the tab is `RoleProjectAccessTab.tsx` inside `RoleModal.tsx`.

## The rule

A person always sees the projects they **own** or are a **member** of, in any status. A role can add:

| Setting | Adds |
|---|---|
| `scope.business_unit` | Every project of the business unit the person belongs to |
| `scope.all` | Every project (includes the business unit scope) |
| `status.<STATUS>` (one per project status) | Limits which statuses the two wider scopes show. Own/member projects are never limited |
| `list.status.<STATUS>` | Which statuses the Projects page lists (see below) |

The `status.*` group is **hidden** in Settings (`hidden: true` in the definitions). It is not something an admin chooses: every save or sync writes all of its keys ticked, whatever the screen sent, so every role (including new ones) can open every status of the projects it has access to. The keys are still stored and enforced, so the group can be shown again later by removing `hidden`. A role saved earlier with some status unticked keeps that until it is saved or synced once. The Projects page list (`list.status.*`) is the only status setting shown.

## Stored as keys

`RoleProjectAccess(roleId, key)`: one row per ticked setting, plus `meta.configured` once the role was saved or synced on purpose. The checklist shown in Settings is built from `GET /api/project-access/definitions`, so adding a setting means adding a key in `project-access.keys.ts` and reading it in `resolveConfig`; no migration and no screen change.

## What the Projects page lists

A third group, `list.status.<STATUS>`, sets which statuses the **Projects page** (the project directory) lists for the role. It is about what you browse, not what you may open: a person can still open any project they have access to (from My Drafts, a link, the project dashboard).

Before this, the browser forced `status: ACTIVE` for every role except BU_HEAD and SUPERADMIN (that is why OP only saw Active projects there although the server returned everything). Now the server enforces it in `GET /projects/directory`, and the page asks `GET /api/project-access/me` for the statuses to offer in its filter. Defaults reproduce the old behaviour exactly: SUPERADMIN and BU_HEAD list every status, any other role (OP, PIC, LEADER, MEMBER, new roles) lists only Active.

Roles that were saved before this group existed have no `meta.list_configured` marker, so they use those defaults for this group until saved again; nothing disappears from the Projects page on deploy. Once saved, what is ticked wins, including nothing.

## The main Dashboard

The Dashboard (`GET /api/dashboard`) uses the same access rule as everything else, then counts only **Active** projects (plus up to five waiting for review). Verified: for every user the projects it covers equal that user's Active projects under Project Access. Because of that, a BU_HEAD now sees the Active projects of their whole business unit there, where before they saw only the ones they own or belong to.

## Not synced yet = defaults

There is no seed. A role without `meta.configured` uses the defaults, which reproduce how access worked before this feature, so nobody loses access on deploy:

- `SUPERADMIN`, `OP`: all projects
- `BU_HEAD`: projects of their business unit
- any other role: only own/member projects
- every status allowed

`defaultKeysForRoleName` in `project-access.keys.ts` is the **only** place that knows role names. The **Sync** button (per role, with a confirm) saves those defaults to the role, replacing what is ticked. After a role is synced or saved, its saved keys decide, even if nothing is ticked (then it sees only its own projects).

## API

Base `/api/project-access`. Saving and syncing need the `settings_roles` UPDATE permission.

| Method and path | Description |
|---|---|
| `GET /definitions` | The checklist: groups, items, labels, `locked`, `implies`, `enabledWhenAny` |
| `GET /roles/:roleId` | `{ roleId, roleName, configured, keys }` (`scope.own` is always listed) |
| `PUT /roles/:roleId` | Body `{ keys: string[] }`. Writes only the differences |
| `POST /roles/:roleId/sync` | Puts the role back on the defaults |
| `GET /me` | The signed-in user role Projects page statuses: `{ listStatuses, listAllStatuses }` |

Safety checks (`400`): unknown key; `SELF_LOCKOUT` (you cannot remove "All projects" from your own role); `LAST_ALL_PROJECTS` (at least one role must keep it). Every save or sync writes an `ActivityLog` row (`PROJECT_ACCESS_UPDATED` / `PROJECT_ACCESS_SYNCED`, with before and after). A role's answer is cached for 15 seconds and cleared at once when it is saved.

## Who can change a project vs who can see it

Seeing a project (above) is separate from changing it.

**Changing is for the project's owner or a co-owner only**, whatever their system role (`src/middleware/project-role.middleware.ts`, `requireProjectManager`). A BU Head, OP or Superadmin who is not the owner or a co-owner of that project is refused (`403`, code `PROJECT_MANAGER_ONLY`). It runs after the page permission (`authorize("projects", "UPDATE")`), which says whether the role may edit at all. Applied to: `PUT /projects/:id`, CPM save, org-chart builder (clone, photo, save, delete), and team assign / remove / change role.

**Reading a project's details** (`GET /projects/:id` and `/projects/:id/full`) needs Project Access **or** being one of the project's approvers (`requireProjectReadAccess`, `canReadProject`). Approvers are included because they read the project they must review (activation reads `/full`). Anyone else gets `404`. Unlike `canViewProjectForApproval`, a general "projects READ" page permission does not open every project.

Not covered on purpose: project attachments, subtasks, scopes, tasks and phases (members work with them every day), and lifecycle actions that already check the owner in the controller (cancel, resume). `GET` lists such as members, CPM, org chart and team chart are still open to anyone with the page permission; tighten them next if wanted.

Consequence: a project whose owner has left and has no co-owner can no longer be edited through the API by anyone else. Assign a co-owner first, or decide on an admin override.

## Where it is enforced

`buildAccessibleProjectWhere(userId, roleId)` is the single answer. It is used by the 18 places that already called it, and now also by: the project dashboard access check, report access, `getAll`, `getDirectory`, `getByStatus`, Viscussion access, and the @mention candidates (people whose role can see the project).

Changes in behaviour when this was introduced (checked with `npm run parity:project-access`, read-only): nobody loses access; a `BU_HEAD` now also sees, in project lists, projects they are a **member** of outside their business unit (the dashboard already allowed opening them); `getByStatus` now follows the same rule for OP and BU_HEAD instead of treating them as ordinary users.

## Still hard-coded on purpose or not yet moved

- **Approval workflow levels** (`BU_HEAD` / `OP` as approval steps) and the SUB_OWNER-must-be-BU_HEAD rule: a process, not visibility.
- **Actions only SUPERADMIN may do** (incident evidence, KPI configuration, and similar): permissions, not visibility.
- **Incident visibility** (`incident-*.service.ts`): its own rules.

## Tests

`npm run test:project-guards` (mocked): the owner or co-owner guard and the read guard. `npm run test:project-access` (mocked Prisma): defaults, the query for each kind of role, configured roles, saving, only-differences writes, audit, lock-out guards, sync. `npm run parity:project-access` compares the old rules with the new ones for every user and project in the database.
