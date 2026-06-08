import crypto from "crypto";

const {
  SP_TENANT_ID,
  SP_CLIENT_ID,
  SP_CLIENT_SECRET,
  SP_SITE_ID,
  SP_DRIVE_ID,
  SP_UPLOAD_FOLDER,
} = process.env;

let resolvedDriveId: string | null = null;

function assertSharePointConfig() {
  const missing: string[] = [];

  if (!SP_TENANT_ID) missing.push("SP_TENANT_ID");
  if (!SP_CLIENT_ID) missing.push("SP_CLIENT_ID");
  if (!SP_CLIENT_SECRET) missing.push("SP_CLIENT_SECRET");
  if (!SP_SITE_ID) missing.push("SP_SITE_ID");

  if (missing.length > 0) {
    throw new Error(`Missing SharePoint config: ${missing.join(", ")}`);
  }
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function encodePath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function graphGet(token: string, url: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.ok) {
    return { ok: true, data: await res.json() };
  }

  if (res.status === 404) {
    return { ok: false, status: 404 };
  }

  const data = await res.text();
  throw new Error(`SharePoint GET failed (${res.status}): ${data}`);
}

async function graphPost(token: string, url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.text();
    throw new Error(`SharePoint POST failed (${res.status}): ${data}`);
  }

  return await res.json();
}

async function resolveDriveId(token: string) {
  if (resolvedDriveId) return resolvedDriveId;

  if (SP_DRIVE_ID) {
    resolvedDriveId = SP_DRIVE_ID;
    return resolvedDriveId;
  }

  const url = `https://graph.microsoft.com/v1.0/sites/${SP_SITE_ID}/drive`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  if (!res.ok || !data?.id) {
    throw new Error(`Unable to resolve SharePoint drive ID: ${JSON.stringify(data)}`);
  }

  resolvedDriveId = data.id;
  return resolvedDriveId;
}

async function ensureFolderPath(token: string, folderPath: string) {
  if (!folderPath) return;

  const driveId = await resolveDriveId(token);

  const segments = folderPath.split("/").filter(Boolean);
  let currentPath = "";

  for (const segment of segments) {
    const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
    const encodedNextPath = encodePath(nextPath);
    const checkUrl = `https://graph.microsoft.com/v1.0/sites/${SP_SITE_ID}/drives/${driveId}/root:/${encodedNextPath}`;

    const exists = await graphGet(token, checkUrl);
    if (!exists.ok && exists.status === 404) {
      const parentPath = currentPath;
      const createUrl = parentPath
        ? `https://graph.microsoft.com/v1.0/sites/${SP_SITE_ID}/drives/${driveId}/root:/${encodePath(parentPath)}:/children`
        : `https://graph.microsoft.com/v1.0/sites/${SP_SITE_ID}/drives/${driveId}/root/children`;

      await graphPost(token, createUrl, {
        name: segment,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      });
    }

    currentPath = nextPath;
  }
}

async function getAccessToken() {
  assertSharePointConfig();

  const url = `https://login.microsoftonline.com/${SP_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: SP_CLIENT_ID!,
    client_secret: SP_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error_description || "Failed to get Graph token");
  }

  return data.access_token as string;
}

export async function uploadBufferToSharePoint(params: {
  buffer: Buffer;
  originalName: string;
  mimeType?: string;
  folder?: string;
}) {
  assertSharePointConfig();

  const token = await getAccessToken();
  const driveId = await resolveDriveId(token);
  const now = Date.now();
  const ext = params.originalName.includes(".")
    ? params.originalName.substring(params.originalName.lastIndexOf("."))
    : "";
  const baseName = params.originalName.replace(ext, "");
  const safeName = sanitizeFilename(baseName);
  const fileName = `${now}-${crypto.randomUUID()}-${safeName}${ext}`;

  const rootFolder = (SP_UPLOAD_FOLDER || "progress-uploads").replace(/^\/+|\/+$/g, "");
  const subFolder = (params.folder || "").replace(/^\/+|\/+$/g, "");
  const fullFolderPath = [rootFolder, subFolder].filter(Boolean).join("/");

  // Ensure folder path exists so callers don't need to pre-create it in SharePoint.
  await ensureFolderPath(token, fullFolderPath);

  const relativePath = [rootFolder, subFolder, fileName].filter(Boolean).join("/");

  const encodedPath = encodePath(relativePath);
  const url = `https://graph.microsoft.com/v1.0/sites/${SP_SITE_ID}/drives/${driveId}/root:/${encodedPath}:/content`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": params.mimeType || "application/octet-stream",
    },
    body: new Uint8Array(params.buffer),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`SharePoint upload failed: ${JSON.stringify(data)}`);
  }

  return {
    id: data.id as string | undefined,
    name: data.name as string | undefined,
    webUrl: data.webUrl as string | undefined,
    downloadUrl: data["@microsoft.graph.downloadUrl"] as string | undefined,
    path: relativePath,
  };
}
