import { Request, Response } from "express";
import { createPresignedUpload } from "../../services/s3-assets.service";
import prisma from "../../config/prisma";

const categoryModule: Record<string, string> = {
  projects: "projects",
  "org-chart-photos": "projects",
  progress: "progress",
  incidents: "incident_reports",
};

async function canUpload(roleId: string, category: string) {
  const moduleName = categoryModule[category];
  if (!moduleName) return false;
  return Boolean(await prisma.rolePermission.findFirst({
    where: {
      roleId,
      module: { isActive: true, name: { equals: moduleName, mode: "insensitive" } },
      permission: { action: { in: ["CREATE", "UPDATE"] } },
    },
    select: { roleId: true },
  }));
}

export async function presignUpload(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!(await canUpload(user.roleId, String(req.body?.category || "")))) {
      return res.status(403).json({ success: false, message: "You are not authorized to upload files for this category" });
    }
    const data = await createPresignedUpload(req.body);
    res.json({ success: true, data });
  } catch (error: any) {
    if (error?.name === "CredentialsProviderError") {
      console.error("S3 presign failed: AWS credentials are unavailable to the backend process");
      return res.status(503).json({
        success: false,
        code: "AWS_CREDENTIALS_UNAVAILABLE",
        message: "File uploads are temporarily unavailable because backend AWS credentials are not configured",
      });
    }
    console.error("S3 presign failed", {
      name: error?.name || "Error",
      message: error?.message || "Unknown error",
    });
    res.status(error.status || 500).json({
      success: false,
      code: error.status ? "INVALID_UPLOAD_METADATA" : "S3_PRESIGN_FAILED",
      message: error.status ? error.message : "Unable to authorize file upload",
    });
  }
}
