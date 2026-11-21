# VISION backend: S3 asset-storage migration

## Purpose

VISION attachment storage has been migrated from backend-mediated SharePoint uploads to direct browser uploads in Amazon S3. The backend now authorizes uploads, validates uploaded objects, stores stable S3 keys, serves files through the configured asset domain, and removes managed objects when persisted attachments are deleted.

This document is for backend, DevOps, and QA. Frontend implementation details are in [S3_FRONTEND_HANDOFF.md](./S3_FRONTEND_HANDOFF.md).

## Architecture

```text
Frontend ──POST /api/uploads/presign──> VISION backend
Frontend <────presigned PUT URL─────── VISION backend
Frontend ─────────PUT file────────────> Amazon S3
Frontend ──business JSON + fileKey────> VISION backend
VISION backend ─────HeadObject────────> Amazon S3
VISION backend ──stores stable key────> Database
Browser/API client ─────GET───────────> CloudFront asset domain
```

The backend never returns AWS credentials and no AWS secret belongs in frontend code. A presigned URL is temporary authorization for one object upload; the stable `fileKey` is what is persisted.

## Backend configuration

Required runtime variables:

```dotenv
AWS_REGION=ap-southeast-1
AWS_S3_ASSETS_BUCKET=visions-assets-prod
ASSETS_BASE_URL=https://assets.vision.globalvisionsinc.com.ph
ASSETS_ENV=dev
```

`ASSETS_ENV` is mandatory and accepts only `dev` or `prod`.

For local development, credentials may be resolved from an AWS CLI/SSO profile:

```dotenv
AWS_PROFILE=vision-dev
```

Production should use the workload's IAM role, such as an EC2 instance profile or ECS task role. Do not put access keys in source control or frontend environment files.

### Environment separation

Objects use this format:

```text
<environment>/<category>/<entity-or-batch-id>/<timestamp>-<uuid>-<safe-file-name>
```

Example:

```text
dev/progress/f562620d-f388-436d-b672-7eae22a68a93/1791957793230-uuid-progress.jpg
```

A `dev` backend creates and deletes only `dev/*` objects. A `prod` backend creates and deletes only `prod/*` objects. The frontend must not send or choose the environment.

## AWS permissions

The backend identity requires the following actions for its environment prefix:

- `s3:PutObject` to create presigned PUT requests.
- `s3:GetObject` for object verification via `HeadObject`.
- `s3:DeleteObject` for persisted attachment cleanup.

Scope production and development identities to their respective prefixes where possible.

Example resource scope for development:

```text
arn:aws:s3:::visions-assets-prod/dev/*
```

The browser does not receive IAM permissions. It can perform only the operation authorized by the short-lived presigned URL.

## S3 CORS

The bucket must permit browser PUT requests from the approved frontend origins. The current required behavior is:

- Allowed origins: local frontend and production VISION frontend.
- Allowed methods: `PUT`, `GET`, and `HEAD`.
- Allowed headers: all request headers needed by the upload, including `Content-Type`.
- Exposed header: `ETag`.
- Preflight cache: 3600 seconds.

A successful presign followed by a browser preflight `403` indicates an S3 CORS or origin mismatch, not a presign failure.

## Presign API

```http
POST /api/uploads/presign
Authorization: Bearer <VISION token>
Content-Type: application/json
```

Request:

```json
{
  "fileName": "site-photo.jpg",
  "contentType": "image/jpeg",
  "fileSize": 2458102,
  "category": "incidents",
  "entityId": "incident-id-or-client-batch-uuid"
}
```

Allowed categories:

- `projects`
- `progress`
- `incidents`
- `org-chart-photos`

The endpoint requires authentication and the applicable module `CREATE` or `UPDATE` permission.

Response:

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://temporary-presigned-url",
    "fileKey": "dev/incidents/entity-id/1791957793230-uuid-site-photo.jpg",
    "fileUrl": "https://assets.vision.globalvisionsinc.com.ph/dev/incidents/entity-id/1791957793230-uuid-site-photo.jpg",
    "expiresIn": 60
  }
}
```

## Persisting an uploaded file

After S3 returns success for the PUT, the frontend sends this stable reference to the relevant business endpoint:

```json
{
  "fileKey": "dev/incidents/entity-id/1791957793230-uuid-site-photo.jpg",
  "fileName": "site-photo.jpg",
  "contentType": "image/jpeg",
  "fileSize": 2458102
}
```

Before inserting the database row, the backend:

1. Validates the key category and current-environment prefix.
2. Validates the entity ID when the endpoint has an existing entity.
3. Calls S3 `HeadObject`.
4. Confirms the object size and content type match the declared metadata.
5. Stores the stable key in the module's existing URL/path column.

Business endpoints accept JSON references and no longer accept multipart file bytes.

## Validation and limits

- General attachments: 1 byte through 50 MB.
- Organization-chart photos: an allowed image MIME type (`image/jpeg`, `image/png`, `image/webp`, or `image/gif`) through 5 MB.
- General types: common images, PDF, text/CSV, Word, and Excel formats.
- Presigned PUT lifetime: 60 seconds.
- File names are reduced to a safe leaf name and normalized before key generation.

## Modules migrated

- Project attachments and project-creation attachments
- Progress attachments/photos
- Daily-report attachments
- Weekly-report attachments
- Incident attachments/photos
- Project organization-chart photos
- Report/PDF consumers of stored attachment references

## Legacy behavior removed

- The SharePoint upload service was removed.
- The Multer upload middleware was removed.
- Attachment APIs no longer accept backend multipart uploads.
- Historical non-S3 references are not uploaded, fetched, or deleted through the old SharePoint storage implementation.
- Existing authenticated `/file` routes redirect managed S3 records to the configured asset URL. Unsupported historical references return HTTP `410 Gone`.

Microsoft/Entra authentication and unrelated SharePoint-backed business integrations, such as PIN catalog synchronization, are outside this storage migration.

## Common failures

### `AWS_CREDENTIALS_UNAVAILABLE` / HTTP 503

The backend process cannot resolve valid AWS credentials. For local SSO development, refresh the configured profile:

```powershell
aws sso login --profile vision-dev
```

Then restart the backend process if necessary. Production should verify its IAM role attachment and permissions.

### Presign succeeds but S3 PUT preflight is `403`

Check the bucket CORS origins and ensure the browser origin exactly matches an allowed origin. Also use the exact `Content-Type` supplied during presigning.

### Business save rejects the reference

Confirm that:

- the PUT finished successfully;
- the `fileKey` is from the current presign response;
- the category and entity ID are correct;
- the declared size and MIME type match the uploaded object;
- the backend environment matches the key prefix.

## Verification commands

```powershell
npm run build
npm run test:assets
npm run test:progress
npm run test:incidents
npm run test:reports
```

For end-to-end QA, upload through the UI, confirm the object exists under the correct environment prefix, confirm the database stores its key, open/download it, then delete it and verify both the database reference and S3 object are gone.

