# Remove unused ProjectTimeline snapshots

Current frontend charts use progress S-curve and project-dashboard endpoints,
which calculate from project structure and progress logs. They do not consume
persisted ProjectTimeline snapshots.

Removed: `/api/timeline/*` routes (including the live `/today` route), snapshot
cloning, version detail's `timelines`, creation summary's `timelinesCloned`,
and snapshot cleanup in project/user/draft deletion.

Retained: ProgressLog, version progress synchronization, project schedule dates,
S-curves, report calculations, and ProjectDashboardSnapshot.

## Dev deployment

The migration drops the ProjectTimeline table and all its rows and indexes.
Preparing this change does not execute any database migration.

1. Back up dev and verify DATABASE_URL points to dev. Review pending migrations:
   `npx prisma migrate status`. Deploy applies all pending migrations.
2. Stop the backend while updating code/schema. Old code queries the removed
   table; new deletion flows require its foreign key to be removed.
3. Run `npx prisma generate` and `npm run build` from this revision.
4. Run `npx prisma migrate deploy`, then restart the rebuilt backend.
5. Check charts, version detail, version creation, parent progress sync, and
   draft/project deletion on dev fixtures. Removed timeline routes return 404.

Do not manually drop the table before running the migration. If it was already
dropped in an experiment, reconcile migration state before deployment.

The manual `ProjectTimeline_backup_before_cleanup` table, if present, is retained
and still occupies storage. Decide separately when to delete that backup after
verification. It is not removed by this migration.

Rollback needs the previous code/schema/client and restoration of the table from
backup. Reverting code alone does not restore deleted data.

## Local dev execution (2026-11-11)

Applied only this migration to `bucket_vision` on `127.0.0.1:5433` using
`prisma db execute --file prisma/migrations/20261106090000_remove_unused_project_timeline/migration.sql --schema prisma/schema.prisma`,
then recorded it with
`prisma migrate resolve --applied 20261106090000_remove_unused_project_timeline`.
The unrelated pending legacy-report deletion was not applied. Migration history
also reports a database migration absent from this checkout:
`20260828093000_add_project_org_chart_node_coordinates`. Reconcile that history
separately before a general migration deployment.

Before removal, all 7,801 remaining rows were confirmed present in the existing
56,877-row backup table. After removal, the original table is absent, the backup
remains, and ProgressLog still has 186 rows. No production migration was run.
