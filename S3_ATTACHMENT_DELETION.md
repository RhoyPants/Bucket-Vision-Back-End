# VISION S3 attachment deletion behavior

## Goal

Deleting a persisted VISION attachment must remove both its managed S3 object and its database reference. The implementation is intentionally fail-safe: S3 deletion happens first, and the database record is removed only after S3 confirms the delete request.

This behavior applies only to already persisted attachments. Removing a newly selected browser `File` before Save or Submit is a frontend state change and must not call the backend or S3.

## Root cause addressed

The direct-upload path correctly placed files in S3, but some removal paths deleted only database rows or relied on database cascades. Those paths left orphaned S3 objects. Progress update removal, parent report/incident deletion, and organization-chart photo replacement/removal required explicit cleanup behavior in addition to the individual attachment delete endpoints.

## Central deletion helper

All migrated modules reuse `deleteManagedAsset()` from `src/services/s3-assets.service.ts`.

Its responsibilities are:

1. Convert a stored managed asset URL or stable key into an S3 key.
2. Detect non-S3 or historical external references.
3. Enforce the current `ASSETS_ENV` prefix.
4. Call S3 `DeleteObject` with the configured bucket and shared S3 client.
5. Log success, refusal, skip, or failure without logging credentials.
6. Propagate managed-object deletion failures to the caller.

Representative logs:

```text
[S3 DELETE] environment=dev key=dev/progress/...
[S3 DELETE] success key=dev/progress/...
```

Failure or refusal:

```text
[S3 DELETE] refused environment=dev key=prod/progress/...
[S3 DELETE] failed key=dev/progress/... <error>
```

Historical/external record:

```text
[S3 DELETE] skipped non-S3 reference environment=dev
```

## Individual attachment deletion flow

```text
Frontend DELETE request
        ↓
Authenticate and authorize user
        ↓
Load attachment by database ID
        ↓
Validate ownership/module access
        ↓
Read the stored key from the database
        ↓
Validate managed key and environment
        ↓
S3 DeleteObject
        ↓ success
Delete database attachment row
        ↓
Return success
```

The frontend does not supply the S3 key to a delete endpoint. The backend loads the authoritative value from the attachment record.

Current attachment delete routes include:

```http
DELETE /api/projects/attachments/:attachmentId
DELETE /api/progress/attachments/:attachmentId
DELETE /api/incidents/attachments/:attachmentId
```

These routes retain their existing authentication and role-based authorization middleware.

## Failure semantics

### Managed S3 deletion fails

The request returns an error and the database row is preserved. This makes the attachment retryable and prevents a silent orphan caused by deleting the reference first.

Common local cause: an expired AWS SSO token. Refresh it with:

```powershell
aws sso login --profile vision-dev
```

### Key belongs to another environment

Deletion throws before any S3 request. For example, a backend with `ASSETS_ENV=dev` refuses `prod/*`.

### Historical or external reference

The helper does not issue `DeleteObject`. It logs that the value is not a managed S3 reference, and the existing database deletion may proceed. This prevents S3 cleanup logic from breaking historical SharePoint rows or unrelated HTTP links.

## Replacement behavior

Replacement follows this order:

1. Upload the new file to S3.
2. Verify the new object.
3. Persist the new reference or save the updated entity.
4. Delete the old managed object.

The old working attachment is not deleted before the replacement has been uploaded and saved.

Progress updates first create their new attachment rows and then clean up attachments listed in `removeAttachmentIds`. Organization-chart saves persist the new chart state before deleting photos no longer referenced by any node.

## Parent-record deletion

Database cascade deletion alone cannot clean S3. Parent delete flows explicitly enumerate persisted files first:

- Incident report: authorize, delete each S3 object and attachment row, then delete the incident.
- Organization chart: collect unique node photo references, delete managed S3 objects, then delete the chart.

If an S3 deletion fails, the normal parent deletion does not continue past that failed cleanup operation.

## Module coverage

- Project attachments
- Progress attachments and `removeAttachmentIds`
- Daily-report attachments and parent deletion
- Weekly-report attachments and parent deletion
- Incident attachments and parent deletion
- Organization-chart photo replacement and chart deletion

## IAM requirement

The local AWS profile or production workload role needs `s3:DeleteObject` for its permitted prefix. No AWS access key is embedded in code or accepted from the frontend.

Example development resource scope:

```text
arn:aws:s3:::visions-assets-prod/dev/*
```

## Automated verification

Run:

```powershell
npm run build
npm run test:assets
npm run test:progress
npm run test:incidents
npm run test:reports
```

The asset tests cover environment-specific key creation, invalid environment rejection, recognition of managed keys, skipping external references, and refusing cross-environment deletion before an S3 request.

## Manual end-to-end verification

1. Ensure the local AWS SSO session is valid.
2. Upload a file through the VISION UI.
3. Confirm its key begins with `dev/` and the exact object exists in S3.
4. Confirm the attachment appears in VISION and has a database record.
5. Delete the persisted attachment through the UI.
6. Confirm the API succeeds.
7. Confirm the database row is gone.
8. Confirm the exact S3 object no longer exists.

Also verify:

- Selecting and removing an unsaved file produces no presign, PUT, or DELETE request.
- A `dev` backend refuses a `prod/*` key.
- An induced S3 failure preserves the database attachment row.
- Deleting a historical SharePoint/external attachment does not call S3.
- Replacing an attachment keeps the old object until the new reference has been saved.

## Operational note

S3 `DeleteObject` is idempotent: AWS can return success even if the object is already absent. The database cleanup can therefore safely proceed after a successful delete response. Server logs should be used to correlate the environment and exact key during incident investigation.
