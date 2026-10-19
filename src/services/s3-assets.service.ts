import crypto from "crypto";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const ASSET_CATEGORIES = [
  "projects",
  "progress",
  "incidents",
  "org-chart-photos",
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type AssetsEnvironment = "dev" | "prod";

export interface StoredFileReference {
  fileKey: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  caption?: string;
  section?: string;
  actionId?: string;
  sortOrder?: number;
}

const region = process.env.AWS_REGION || "ap-southeast-1";
const bucket = process.env.AWS_S3_ASSETS_BUCKET || "visions-assets-prod";
const assetsBaseUrl = (
  process.env.ASSETS_BASE_URL ||
  "https://assets.vision.globalvisionsinc.com.ph"
).replace(/\/+$/, "");
const expiresIn = 60;

export function parseAssetsEnvironment(value: unknown): AssetsEnvironment {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized !== "dev" && normalized !== "prod") {
    throw new Error('Invalid ASSETS_ENV configuration. Expected exactly "dev" or "prod".');
  }
  return normalized;
}

const assetsEnvironment = parseAssetsEnvironment(process.env.ASSETS_ENV);

const s3 = new S3Client({ region });

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const maxFileSize = 50 * 1024 * 1024;

function invalid(message: string): never {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  throw error;
}

export function sanitizeFileName(value: string) {
  const leaf = value.replace(/\\/g, "/").split("/").pop()?.trim() || "";
  if (!leaf || leaf === "." || leaf === ".." || leaf.length > 180) {
    invalid("Invalid fileName");
  }
  const safe = leaf
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  if (!safe) invalid("Invalid fileName");
  return safe;
}

function normalizeEntityId(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    invalid("Invalid entityId");
  }
  return normalized;
}

export function validateUploadMetadata(input: any) {
  const fileName = sanitizeFileName(String(input?.fileName || ""));
  const contentType = String(input?.contentType || "").toLowerCase().trim();
  const fileSize = Number(input?.fileSize);
  const category = String(input?.category || "") as AssetCategory;
  const entityId = normalizeEntityId(String(input?.entityId || ""));

  if (!allowedTypes.has(contentType)) invalid("Unsupported contentType");
  if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > maxFileSize) {
    invalid("fileSize must be between 1 byte and 50 MB");
  }
  if (!ASSET_CATEGORIES.includes(category)) invalid("Invalid storage category");
  if (category === "org-chart-photos" && !contentType.startsWith("image/")) {
    invalid("Organization chart photos must be images");
  }
  if (category === "org-chart-photos" && fileSize > 5 * 1024 * 1024) {
    invalid("Organization chart photos must not exceed 5 MB");
  }

  return { fileName, contentType, fileSize, category, entityId };
}

export function buildAssetUrl(fileKey: string) {
  return `${assetsBaseUrl}/${fileKey.split("/").map(encodeURIComponent).join("/")}`;
}

export function isManagedFileKey(value: string) {
  const parts = value.split("/");
  const categoryIndex = parts[0] === "dev" || parts[0] === "prod" ? 1 : 0;
  return ASSET_CATEGORIES.includes(parts[categoryIndex] as AssetCategory) &&
    parts.length > categoryIndex + 2 &&
    !value.includes("..") &&
    !value.startsWith("/");
}

export function isCurrentEnvironmentFileKey(value: string) {
  return isManagedFileKey(value) && value.startsWith(`${assetsEnvironment}/`);
}

export function fileKeyFromStoredValue(value: string) {
  if (isManagedFileKey(value)) return value;
  try {
    const url = new URL(value);
    if (url.origin === new URL(assetsBaseUrl).origin) {
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      return isManagedFileKey(key) ? key : null;
    }
  } catch {
    // External values are not managed S3 keys.
  }
  return null;
}

export function buildObjectKey(
  metadata: ReturnType<typeof validateUploadMetadata>,
  environment: AssetsEnvironment = assetsEnvironment,
  timestamp = Date.now(),
  uniqueId = crypto.randomUUID(),
) {
  return `${environment}/${metadata.category}/${metadata.entityId}/${timestamp}-${uniqueId}-${metadata.fileName}`;
}

export async function createPresignedUpload(input: any) {
  const metadata = validateUploadMetadata(input);
  const fileKey = buildObjectKey(metadata);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fileKey,
    ContentType: metadata.contentType,
    Metadata: {
      "original-name": encodeURIComponent(metadata.fileName),
      "declared-size": String(metadata.fileSize),
    },
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn });
  return { uploadUrl, fileKey, fileUrl: buildAssetUrl(fileKey), expiresIn };
}

export function validateStoredFileReference(value: any, expectedCategory: AssetCategory, expectedEntityId?: string): StoredFileReference {
  const fileKey = String(value?.fileKey || "");
  const fileName = sanitizeFileName(String(value?.fileName || ""));
  const contentType = String(value?.contentType || value?.mimeType || "").toLowerCase().trim();
  const fileSize = Number(value?.fileSize ?? value?.size);
  const expectedPrefix = `${assetsEnvironment}/${expectedCategory}/`;
  if (!isCurrentEnvironmentFileKey(fileKey) || !fileKey.startsWith(expectedPrefix)) {
    invalid("Invalid fileKey for this attachment category");
  }
  if (expectedEntityId && !fileKey.startsWith(`${expectedPrefix}${normalizeEntityId(expectedEntityId)}/`)) {
    invalid("fileKey does not belong to this entity");
  }
  if (!allowedTypes.has(contentType)) invalid("Unsupported contentType");
  if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > maxFileSize) {
    invalid("Invalid fileSize");
  }
  return { ...value, fileKey, fileName, contentType, fileSize };
}

export async function assertUploadedObject(reference: StoredFileReference) {
  const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: reference.fileKey }));
  if (result.ContentLength !== reference.fileSize) invalid("Uploaded object size does not match fileSize");
  if (result.ContentType && result.ContentType !== reference.contentType) {
    invalid("Uploaded object content type does not match contentType");
  }
}

export async function deleteManagedAsset(storedValue: string) {
  const fileKey = fileKeyFromStoredValue(storedValue);
  if (!fileKey) {
    console.info(`[S3 DELETE] skipped non-S3 reference environment=${assetsEnvironment}`);
    return false;
  }
  if (!isCurrentEnvironmentFileKey(fileKey)) {
    const error = new Error(`Refusing to delete asset outside ${assetsEnvironment}/ environment`);
    console.error(`[S3 DELETE] refused environment=${assetsEnvironment} key=${fileKey}`);
    throw error;
  }
  console.info(`[S3 DELETE] environment=${assetsEnvironment} key=${fileKey}`);
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: fileKey }));
    console.info(`[S3 DELETE] success key=${fileKey}`);
    return true;
  } catch (error) {
    console.error(`[S3 DELETE] failed key=${fileKey}`, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export const assetConfiguration = { region, bucket, assetsBaseUrl, assetsEnvironment, expiresIn };
