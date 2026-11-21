import {
  assertUploadedObject,
  buildAssetUrl,
  validateStoredFileReference,
} from "../../services/s3-assets.service";
import { DiscussionApiError } from "./discussion.access";

/**
 * Attachments on posts and replies. The browser uploads each file straight to S3 (category
 * "discussions", entity = the project) and then sends the stable references here; nothing about the
 * file bytes passes through the API. Each reference is checked: it must belong to this project, be an
 * allowed type, be at most 5 MB, and really exist in S3 with the size and type that were declared.
 */
export const MAX_ATTACHMENTS = 10;

export interface CleanAttachment {
  fileKey: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

const invalid = (message: string, code = "INVALID_ATTACHMENT") => new DiscussionApiError(400, code, message);

export async function cleanAttachments(value: unknown, projectId: string): Promise<CleanAttachment[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid("attachments must be an array");
  if (value.length > MAX_ATTACHMENTS) throw invalid("You can attach at most " + MAX_ATTACHMENTS + " files at a time");

  const seen = new Set<string>();
  const clean: CleanAttachment[] = [];
  for (const item of value) {
    let reference;
    try {
      reference = validateStoredFileReference(item, "discussions", projectId);
    } catch (error: any) {
      throw invalid(error?.message || "Invalid attachment");
    }
    if (seen.has(reference.fileKey)) continue;
    seen.add(reference.fileKey);
    try {
      await assertUploadedObject(reference);
    } catch (error: any) {
      // A missing or mismatched object: the upload did not finish, or the details were changed.
      throw invalid(
        error?.status ? error.message : "A file was not uploaded correctly. Please attach it again.",
        "ATTACHMENT_NOT_UPLOADED",
      );
    }
    clean.push({
      fileKey: reference.fileKey,
      fileName: reference.fileName,
      contentType: reference.contentType,
      fileSize: reference.fileSize,
    });
  }
  return clean;
}

export const attachmentSelect = {
  id: true,
  fileKey: true,
  fileName: true,
  contentType: true,
  fileSize: true,
  createdAt: true,
  uploadedById: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

/** What the screens receive: a ready-to-use URL, whether it is a picture, and whether this person may remove it. */
export function mapAttachment(a: any, userId: string, isManager: boolean) {
  return {
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    fileSize: a.fileSize,
    url: buildAssetUrl(a.fileKey),
    isImage: String(a.contentType).startsWith("image/"),
    uploadedBy: a.uploadedBy,
    createdAt: a.createdAt,
    canDelete: a.uploadedById === userId || isManager,
  };
}
