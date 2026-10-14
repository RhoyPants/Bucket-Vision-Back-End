# Frontend handoff: direct uploads to S3

The backend no longer accepts file bytes for application attachments. The frontend must keep selected `File` objects in browser state and perform the upload only from the screen's final Save, Submit, Add Photo, or Upload action.

## Required environment-backed backend configuration

The backend deployment must provide:

```text
AWS_REGION=ap-southeast-1
AWS_S3_ASSETS_BUCKET=visions-assets-prod
ASSETS_BASE_URL=https://assets.vision.globalvisionsinc.com.ph
ASSETS_ENV=dev
```

AWS credentials are resolved by the AWS SDK credential-provider chain. Do not add AWS credentials to frontend or source-controlled environment files.

The backend process must have AWS credentials capable of `s3:PutObject`, `s3:GetObject` (also used by S3 `HeadObject`), and `s3:DeleteObject` for the configured asset prefixes. Production should use its EC2/ECS IAM role. Local development may use a configured AWS CLI profile selected with `AWS_PROFILE`; never commit access keys to `.env`.

`ASSETS_ENV` is mandatory and must be exactly `dev` or `prod`. The backend alone selects it; the frontend must never send an environment field. Production deployments must use `ASSETS_ENV=prod`.

## Upload sequence

1. Keep the selected `File` in component state. Do not call an API from the file input `onChange`.
2. On the final action, validate the form and files.
3. Request one presigned URL per file.
4. PUT each original `File` directly to the returned `uploadUrl`.
5. Only after every required PUT succeeds, send the normal business request with attachment reference objects.
6. If the business request fails after a PUT, report the failure. The uploaded object is an orphan candidate for later cleanup.

## Presign endpoint

```http
POST /api/uploads/presign
Authorization: Bearer <VISION token>
Content-Type: application/json
```

```json
{
  "fileName": "site-photo.jpg",
  "contentType": "image/jpeg",
  "fileSize": 2458102,
  "category": "incidents",
  "entityId": "<entity ID or client-generated upload batch UUID>"
}
```

Allowed categories:

- `projects`
- `progress`
- `daily-reports`
- `weekly-reports`
- `incidents`
- `org-chart-photos`

For existing entities, `entityId` must be the actual entity ID expected below. For create screens where the database ID does not exist yet, use one client-generated UUID as the upload batch ID for all files in that submission.

Successful response:

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://...temporary-presigned-url...",
    "fileKey": "dev/incidents/INCIDENT_ID/1760...-uuid-site-photo.jpg",
    "fileUrl": "https://assets.vision.globalvisionsinc.com.ph/dev/incidents/INCIDENT_ID/1760...-uuid-site-photo.jpg",
    "expiresIn": 60
  }
}
```

Upload directly to S3 using the exact content type used in the presign request:

```ts
const response = await fetch(uploadUrl, {
  method: "PUT",
  headers: { "Content-Type": file.type },
  body: file,
});
if (!response.ok) throw new Error(`Upload failed (${response.status})`);
```

Do not send the VISION authorization header to S3.

## Stable attachment reference

Business endpoints accept JSON, not `FormData`:

```json
{
  "fileKey": "dev/incidents/INCIDENT_ID/1760...-uuid-site-photo.jpg",
  "fileName": "site-photo.jpg",
  "contentType": "image/jpeg",
  "fileSize": 2458102
}
```

Incident references may additionally include `section`, `actionId`, and `caption`.

The backend checks that the S3 object exists and that its size and content type match before storing the key.

## Endpoint-specific payloads

### Project creation

Presign with category `projects` and a client-generated batch UUID. Include the resulting references in the existing project create request:

```json
{ "...projectFields": "...", "attachments": ["<reference objects>"] }
```

For an existing project, presign with `entityId = projectId`, then:

```http
POST /api/projects/:projectId/attachments
```

```json
{ "attachments": ["<reference objects>"] }
```

### Progress

Presign with category `progress` and `entityId = subtaskId`. Send JSON to the existing create/update progress endpoint with:

```json
{ "...progressFields": "...", "attachments": ["<reference objects>"] }
```

Existing `attachmentUpdates` and `removeAttachmentIds` remain supported as JSON arrays.

### Daily and weekly reports

For report creation, presign with a client-generated batch UUID and include the reference objects in the existing create request's `attachments` array. The report and its attachment rows are then created in the same database operation.

For an existing report, presign with the report ID and call:

```http
POST /api/daily-reports/:reportId/attachments
POST /api/weekly-reports/:reportId/attachments
```

with `{ "attachments": [...] }`.

### Incidents

For incident creation, use a client-generated batch UUID and include references in the create request's `attachments` array.

For an existing incident, presign with `entityId = incidentId`, then call:

```http
POST /api/incidents/:incidentId/attachments
```

```json
{
  "attachments": [
    {
      "fileKey": "dev/incidents/INCIDENT_ID/...",
      "fileName": "evidence.jpg",
      "contentType": "image/jpeg",
      "fileSize": 12345,
      "section": "INITIAL_REPORT",
      "caption": "Optional caption"
    }
  ]
}
```

### Organization-chart photos

Presign with category `org-chart-photos` and `entityId = projectId`. Keep the file and local preview in state. On Save, upload it, then call:

```http
POST /api/projects/:projectId/org-chart-builder/photo
```

with the single reference object as the JSON request body. The response contains both `photoUrl` (the stored key) and `fileUrl` (the CloudFront delivery URL). Save `photoUrl` on the chart node; use `fileUrl` for immediate display.

## Display and downloads

Existing authenticated `/file` endpoints remain valid for S3-backed records and redirect to CloudFront. Non-S3 references return HTTP 410 because legacy file-storage retrieval has been removed.

New code may also display the `fileUrl` returned by presign immediately. Never persist `uploadUrl`.

## Selection and preview rules

- Do not presign or upload from file-input `onChange` or drag/drop.
- Use `URL.createObjectURL(file)` for local image previews and revoke it when removed, replaced, unmounted, or submitted.
- Allow removal and replacement before the final action.
- Clear browser state on cancellation; no server cleanup is needed because no upload occurred.
- For multiple files, fail the final operation if any required PUT fails.
- The organization-chart screen must stop its current immediate-on-selection upload behavior.

## Current limits

- General files: 1 byte through 50 MB.
- Organization-chart photos: JPEG, PNG, WebP, or GIF through 5 MB.
- Supported general MIME types include common images, PDF, text/CSV, Word, and Excel formats.
- Presigned PUT URLs expire after 60 seconds.

## Existing non-S3 records

Historical non-S3 values may still exist in the database, but the backend no longer contains a legacy file-storage reader. Their `/file` endpoints return HTTP 410 until those records are migrated or removed.
