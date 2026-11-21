# Project Discussions (backend)

Per-project threaded discussions. Each project has its own threads; threads can be tagged to one or more subtasks of the **same** project.

Code: `src/modules/discussion/` (`access`, `service`, `controller`, `routes`, `test`).
Migration: `prisma/migrations/20261120090000_add_project_discussions`.
Tests: `npm run test:discussions` (Prisma is mocked, no database needed).
Frontend notes: `bucket-vision-api/docs/discussions.md`.

## Data model

| Table | Purpose |
|---|---|
| `Discussion` | Thread: `projectId`, `authorId`, `title`, `body`, `status` (`OPEN`/`RESOLVED`/`CLOSED`), `resolvedAt`, `editedAt`, soft delete via `deletedAt`. |
| `DiscussionSubtask` | Join table: thread to subtask tags (many to many). |
| `DiscussionReply` | Reply: `parentReplyId` (one level of nesting), `isAnswer` (reserved for Phase 2), soft delete. |
| `DiscussionLike` | One row per user per discussion **or** per reply (toggle). |
| `DiscussionRead` | When a user last opened a thread (`lastReadAt`). Drives "new" markers. |
| `DiscussionAttachment` | A file on a post (`replyId` null) or on a reply: S3 `fileKey`, name, type, size, who added it. Removing sets `deletedAt` and also deletes the file from S3. |
| `DiscussionMention` | A user @mentioned in a post (`replyId` null) or in a reply, with `createdAt`. Only ever added to. |

## API

Base: `/api/projects/:projectId/discussions` (all routes require a Bearer token).
Responses: `{ success: true, data }`, lists add `meta: { page, limit, total }`; errors are `{ success: false, error: { code, message } }`.

| Method and path | Description |
|---|---|
| `GET /` | List (each item includes `replyCount` and `lastReply: { author, createdAt }`). Query: `subtaskId`, `status`, `authorId`, `mine=true`, `q`, `sort=latest\|newest\|liked`, `page`, `limit` (max 50). |
| `GET /counts?subtaskIds=a,b` | Map of subtaskId to thread count (for the "Discuss (n)" button). |
| `GET /subtask-options` | Taggable subtasks of the project: `{ id, title, taskTitle, scopeName }` (for the tag picker). |
| `POST /` | Create. Body: `body` (the caption, required), `subtaskIds[]` (optional), `title` (optional, normally omitted: it is derived from the first line of the caption, max 120 chars). |
| `GET /:discussionId` | Thread with replies, like counts and `likedByMe`. |
| `PATCH /:discussionId` | Edit `title`, `body`, `subtaskIds` (author only, not when closed). |
| `PATCH /:discussionId/status` | Body `{ status }` (author only). |
| `DELETE /:discussionId` | Soft delete (author only). |
| `POST /:discussionId/like` | Toggle like. |
| `GET /:discussionId/likes` | Who liked the thread: `[{ user: { id, name }, likedAt }]`, newest first (max 200). |
| `GET /:discussionId/replies/:replyId/likes` | Same, for a reply. |
| `GET /mention-candidates` | People who can be @mentioned: `[{ id, name, position }]` (owner, members, approvers). |
| `POST /:discussionId/read` | Marks the thread read for the caller (opening a thread calls this). |
| `POST /:discussionId/pin`, `DELETE /:discussionId/pin` | Pin or unpin a thread (project owner or co-owner only, at most 3 pinned per project). Pinned threads always sort first. |
| `DELETE /:discussionId/attachments/:attachmentId` | Removes a file: marks the row and deletes it from S3. The person who added it, or a project owner or co-owner. |
| `POST /:discussionId/replies` | Body `{ body, parentReplyId? }`. |
| `PATCH /:discussionId/replies/:replyId` | Edit reply (author only). |
| `DELETE /:discussionId/replies/:replyId` | Soft delete reply (author only). |
| `POST /:discussionId/replies/:replyId/like` | Toggle like on a reply. |

## Viscussion inbox (header message icon)

Separate from transaction notifications (`/api/notifications`). Mounted at `/api/viscussion`, not tied to one project:

| Method and path | Description |
|---|---|
| `GET /api/viscussion/summary` | `{ totalUnread, projects: [{ projectId, projectName, unreadCount, unreadThreads, lastActivityAt, lastSnippet }] }`, newest activity first. |
| `GET /api/viscussion/threads?projectId=&unread=1` | Threads that matter to the caller: `{ id, projectId, projectName, unreadCount, lastActivityAt, snippet }`. |

Code: `discussion.inbox.ts` (logic), `viscussion-inbox.routes.ts`. The list endpoint also returns `unread` and `unreadCount` per thread.

**What counts as new** (`computeUnreadFor`): a thread matters to you if you started it, replied in it, or were @mentioned in it. New = replies by other people since you last looked, plus mentions of you since then. Your own post or reply, or opening the thread, counts as looking. A mention inside a reply that is already counted as new is not counted twice. Projects you can no longer access are left out.

Limits: the inbox looks at the 300 most recently active relevant threads and is computed on request (polled once a minute by the UI), which is fine at current volumes; cache or precompute if it ever gets heavy.

## Mentions

Stored in the text as `@[Display Name](user-id)`; the UI shows them as highlighted names. On create, reply and edit the server keeps only mentions of real project participants (owner, members, approvers) and never the author, and records them in `DiscussionMention`. List previews, titles and inbox snippets show them as plain `@Name`.

## Attachments

Files are uploaded by the browser straight to S3 and only their references reach this API (same flow as the other attachments: `POST /api/uploads/presign`, then the business request). For Viscussion the presign category is `discussions` and the entity is the **project id**; it is authorised by project access (not a page permission), and the key must start with `<env>/discussions/<projectId>/`.

- **Limits:** 5 MB per file (`DISCUSSION_MAX_FILE_BYTES`, enforced at presign, on the stored reference and against the real object in S3), up to 10 files per post or reply. Allowed types are the general upload list (shared by every upload category): pictures, PDF, text and CSV, Word, Excel and PowerPoint. Executables, archives and scripts are not allowed. The browser shrinks big pictures before upload so they fit.
- **Where:** `POST /` (create) and `POST /:id/replies` take `attachments: [{ fileKey, fileName, contentType, fileSize }]`. A thread still needs its caption; a reply may be only files.
- **Checked on save** (`discussion.attachments.ts`): valid key for this project and category, type and size allowed, and `HeadObject` confirms the object exists with the declared size and type.
- **Returned:** `attachments: [{ id, fileName, contentType, fileSize, url, isImage, uploadedBy, createdAt, canDelete }]` on the thread and on each reply; the list gives `attachmentCount` and the first 6 of the post's own `attachments` (not the replies') so the feed can show a preview.
- **Removing** marks the row (`deletedAt`, kept as a record) and deletes the file from S3 (`deleteManagedAsset`), so it is no longer reachable by its link and stops taking space. If S3 refuses, the attachment is still removed from the thread and the failure is logged. Files uploaded but never posted are not touched.

## Pinned threads

`pinnedAt` and `pinnedById` on `Discussion`. Only the project's owner or a co-owner may pin (`isProjectManager`, the same rule as editing the project), up to 3 per project (`PIN_LIMIT`). The list orders `pinnedAt desc, nulls last` before whatever sort was chosen. The thread detail returns `isPinned` and `canPin`.

## Rules

- **Caption-only UI:** the interface never shows or asks for a title. The `title` column is kept (old rows, search, list previews). On create it is derived from the caption; when the caption is edited it is re-derived unless a `title` is sent explicitly.
- **Who can access/post:** project owner and members, BU head for their BU, SUPERADMIN/OP, and project approvers (assigned approver, approval-flow step user, or step role). A generic "projects READ" role permission does **not** grant access.
- **Status changes, edit, delete:** only the thread's creator.
- **Closed threads:** no new or edited replies. `RESOLVED` threads still accept replies.
- **Tags:** every `subtaskId` must belong to the same project and not be deleted (otherwise `400 INVALID_SUBTASK_TAG`). Editing tags replaces the tag links of that thread only.
- **Nesting:** a reply to a reply is attached to the top-level reply (one level).
- **Deleted replies:** shown as a placeholder only if live replies hang under them.
- **Default sort:** `OPEN`, then `RESOLVED`, then `CLOSED`, each by latest activity (a new reply bumps `updatedAt`).

## Not built (on purpose)

Left out to keep the feature small; none of it is needed yet:

- "Mark as answer" (the `isAnswer` column exists, there is no endpoint or button).
- Moderation by the project owner or a co-owner: only the author can edit, resolve, close or delete a thread (owners and co-owners can only pin and remove attachments).
- Adding or changing files on a post after it was created, and editing a reply's files.
- Real-time updates, email or push for mentions and replies, reactions other than like, copy link, follow or mute a thread, search inside replies.
- Cleaning up files that were uploaded but never posted.
