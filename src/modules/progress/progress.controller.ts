import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { addProgressLog, deleteProgressLog, ProgressRuleError, updateProgressLog } from "./progress.service";
import { parseDailyPercent, roundProgress } from "./progress-precision";
import { getSCurve as getSCurveData } from "./scurve.service";
import {
  fetchSharePointFile,
  uploadBufferToSharePoint,
} from "../../services/sharepoint-upload.service";

import {
  GetBySubtaskParamsDTO,
  CreateProgressDTO,
  UpdateAttachmentInputDTO,
  UpdateProgressAttachmentsDTO,
  UpdateProgressDTO,
  UpdateProgressParamsDTO,
  DeleteProgressParamsDTO,
  GetSCurveParamsDTO,
  ProgressResponseDTO,
} from "./porogress.dto";

const prisma = new PrismaClient();
const MAX_PROGRESS_UPDATE_ATTEMPTS = 2;

function sendProgressError(res: Response, error: any) {
  const status = error instanceof ProgressRuleError ? error.httpStatus : 400;
  return res.status(status).json({
    success: false,
    ...(error?.code ? { error: error.code } : {}),
    message: error?.message || "Invalid progress request",
    ...(error?.data ? { data: error.data } : {}),
  });
}

function serializeProgressLog<T extends Record<string, any> | null>(log: T): T {
  if (!log) return log;
  return { ...log, dailyPercent: roundProgress(log.dailyPercent), cumulativePercent: roundProgress(log.cumulativePercent) };
}

function getProgressDayRange(date: any) {
  const progressDate = new Date(date);

  if (isNaN(progressDate.getTime())) {
    throw new Error("date must be a valid date");
  }

  const dayStart = new Date(progressDate);
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return { dayStart, dayEnd };
}

async function checkProgressAddEligibility(params: {
  subtaskId: string;
  date: any;
  userId: string;
}) {
  const { subtaskId, date, userId } = params;
  const { dayStart, dayEnd } = getProgressDayRange(date);

  if (!subtaskId) {
    throw new Error("subtaskId is required");
  }

  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: { id: true },
  });

  if (!subtask) {
    return {
      canAdd: false,
      reason: "SUBTASK_NOT_FOUND",
      message: "Subtask not found.",
      dayStart,
      dayEnd,
      existingLog: null,
    };
  }

  const assignee = await prisma.subtaskAssignee.findFirst({
    where: { subtaskId, userId },
    select: { userId: true },
  });

  if (!assignee) {
    return {
      canAdd: false,
      reason: "NOT_ASSIGNED",
      message: "You cannot add progress because you are not assigned to this subtask.",
      dayStart,
      dayEnd,
      existingLog: null,
    };
  }

  const existingLog = await prisma.progressLog.findFirst({
    where: {
      subtaskId,
      userId,
      date: {
        gte: dayStart,
        lt: dayEnd,
      },
    },
    select: {
      id: true,
      subtaskId: true,
      userId: true,
      date: true,
      dailyPercent: true,
      cumulativePercent: true,
      remarks: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (existingLog) {
    return {
      canAdd: false,
      reason: "ALREADY_ADDED",
      message: "You cannot add progress because you already added progress for this subtask today.",
      dayStart,
      dayEnd,
      existingLog,
    };
  }

  return {
    canAdd: true,
    reason: null,
    message: "You can add progress for this subtask today.",
    dayStart,
    dayEnd,
    existingLog: null,
  };
}

// ========================================
// GET ALL PROGRESS LOGS FOR SUBTASK
// ========================================
export async function getBySubtask(req: Request, res: Response) {
  try {
    let { subtaskId } = req.params as unknown as GetBySubtaskParamsDTO;

    if (Array.isArray(subtaskId)) {
      subtaskId = subtaskId[0];
    }

    const logs = await prisma.progressLog.findMany({
      where: { subtaskId },
      orderBy: { date: "asc" },
      include: { 
        attachments: { orderBy: { sortOrder: "asc" } },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      },
    });

    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : "";

    const logsWithProxy = logs.map((rawLog) => {
      const log = serializeProgressLog(rawLog);
      return {
        ...log,
        attachments: log.attachments.map((attachment) => ({
          ...attachment,
          proxyUrl: `/api/progress/attachments/${attachment.id}/file${
            bearerToken ? `?token=${encodeURIComponent(bearerToken)}` : ""
          }`,
        })),
      };
    });

    res.json({
      success: true,
      data: logsWithProxy,
    } as ProgressResponseDTO);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

// ========================================
// CHECK IF CURRENT ASSIGNEE CAN ADD PROGRESS
// ========================================
export async function canAddProgress(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        canAdd: false,
        reason: "UNAUTHORIZED",
        message: "Unauthorized",
        data: null,
      });
    }

    const subtaskId = String(req.query.subtaskId || "");
    const date = req.query.date || new Date();
    const eligibility = await checkProgressAddEligibility({ subtaskId, date, userId });

    res.json({
      success: true,
      canAdd: eligibility.canAdd,
      reason: eligibility.reason,
      message: eligibility.message,
      data: {
        subtaskId,
        date: eligibility.dayStart,
        existingLog: eligibility.existingLog,
        viewUrl: eligibility.existingLog
          ? `/api/progress/subtask/${subtaskId}`
          : null,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      canAdd: false,
      reason: "INVALID_REQUEST",
      message: error.message,
      data: null,
    });
  }
}

// ========================================
// ADD / UPSERT PROGRESS (🔥 FIXED)
// ========================================
export async function addProgress(req: Request, res: Response) {
  try {
    const { subtaskId, date, dailyPercent, remarks } = req.body;

    const rawFiles = (req as any).files;
    const files: Express.Multer.File[] = Array.isArray(rawFiles)
      ? rawFiles
      : [
          ...((rawFiles?.attachments as Express.Multer.File[]) ?? []),
          ...((rawFiles?.photo as Express.Multer.File[]) ?? []),
        ];
    const userId = (req as any).user?.id;

    if (!userId) {
      throw new Error("Unauthorized");
    }

    // 🔥 FIX: parse everything properly
    const parsedDaily = parseDailyPercent(dailyPercent);
    const parsedLat = req.body.lat ? Number(req.body.lat) : null;
    const parsedLng = req.body.lng ? Number(req.body.lng) : null;

    // 🔥 VALIDATION (IMPORTANT)
    const eligibility = await checkProgressAddEligibility({ subtaskId, date, userId });

    if (!eligibility.canAdd) {
      throw new Error(eligibility.message);
    }

    // Upload all files to SharePoint in parallel
    const uploadedAttachments = await Promise.all(
      files.map(async (file, i) => {
        const result = await uploadBufferToSharePoint({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          folder: "progress",
        });
        return {
          url: result.downloadUrl || result.webUrl || "",
          name: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          sortOrder: i,
        };
      })
    );

    const progressData: CreateProgressDTO = {
      subtaskId,
      date: eligibility.dayStart,
      dailyPercent: parsedDaily, // ✅ FIXED
      remarks: remarks || null,
      latitude: parsedLat,
      longitude: parsedLng,
      userId,
      attachments: uploadedAttachments,
    };

    const createdLog = await addProgressLog(progressData);

    res.json({
      success: true,
      message: "Progress updated successfully",
      data: serializeProgressLog(createdLog),
    } as ProgressResponseDTO);
  } catch (error: any) {
    sendProgressError(res, error);
  }
}

// ========================================
// UPDATE EXISTING PROGRESS ENTRY
// ========================================
export async function updateProgress(req: Request, res: Response) {
  try {
    let { id } = req.params as unknown as UpdateProgressParamsDTO;

    if (Array.isArray(id)) {
      id = id[0];
    }

    const existingLog = await prisma.progressLog.findUnique({
      where: { id },
      include: {
        attachments: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!existingLog) {
      throw new Error("Progress log not found");
    }

    const currentUpdateAttempts = existingLog.dayNumber ?? 0;
    if (currentUpdateAttempts >= MAX_PROGRESS_UPDATE_ATTEMPTS) {
      return res.status(400).json({
        success: false,
        message: `Update limit reached. You can only update/resubmit this progress ${MAX_PROGRESS_UPDATE_ATTEMPTS} times.`,
        error: "UPDATE_LIMIT_REACHED",
      });
    }

    const body = req.body ?? {};

    const updateData: UpdateProgressDTO = {};

    if (body.dailyPercent !== undefined && body.dailyPercent !== "") {
      updateData.dailyPercent = parseDailyPercent(body.dailyPercent);
    }

    if (body.remarks !== undefined) {
      updateData.remarks = body.remarks || null;
    }

    if (body.latitude !== undefined || body.lat !== undefined) {
      const latitudeValue = body.latitude ?? body.lat;
      updateData.latitude = latitudeValue === "" || latitudeValue === null
        ? null
        : Number(latitudeValue);
      if (updateData.latitude !== null && isNaN(updateData.latitude)) {
        throw new Error("latitude must be a number");
      }
    }

    if (body.longitude !== undefined || body.lng !== undefined) {
      const longitudeValue = body.longitude ?? body.lng;
      updateData.longitude = longitudeValue === "" || longitudeValue === null
        ? null
        : Number(longitudeValue);
      if (updateData.longitude !== null && isNaN(updateData.longitude)) {
        throw new Error("longitude must be a number");
      }
    }

    const rawFiles = (req as any).files;
    const files: Express.Multer.File[] = Array.isArray(rawFiles)
      ? rawFiles
      : [
          ...((rawFiles?.attachments as Express.Multer.File[]) ?? []),
          ...((rawFiles?.photo as Express.Multer.File[]) ?? []),
        ];

    const log = await updateProgressLog(id, {
        ...updateData,
        dayNumber: currentUpdateAttempts + 1,
    });

    // Optional metadata updates for existing attachments.
    // Accepts either JSON string or parsed array in multipart/form-data.
    const attachmentUpdatesRaw = body.attachmentUpdates;
    let attachmentUpdates: UpdateAttachmentInputDTO[] = [];
    const removeAttachmentIdsRaw = body.removeAttachmentIds;
    let removeAttachmentIds: string[] = [];

    const attachmentPayload: UpdateProgressAttachmentsDTO = {};

    if (attachmentUpdatesRaw) {
      if (typeof attachmentUpdatesRaw === "string") {
        try {
          attachmentUpdates = JSON.parse(attachmentUpdatesRaw);
        } catch {
          throw new Error("attachmentUpdates must be a valid JSON array");
        }
      } else if (Array.isArray(attachmentUpdatesRaw)) {
        attachmentUpdates = attachmentUpdatesRaw;
      } else {
        throw new Error("attachmentUpdates must be an array");
      }

      attachmentPayload.attachmentUpdates = attachmentUpdates;
    }

    if (removeAttachmentIdsRaw) {
      if (typeof removeAttachmentIdsRaw === "string") {
        try {
          removeAttachmentIds = JSON.parse(removeAttachmentIdsRaw);
        } catch {
          throw new Error("removeAttachmentIds must be a valid JSON array");
        }
      } else if (Array.isArray(removeAttachmentIdsRaw)) {
        removeAttachmentIds = removeAttachmentIdsRaw;
      } else {
        throw new Error("removeAttachmentIds must be an array");
      }

      attachmentPayload.removeAttachmentIds = removeAttachmentIds;
    }

    if (attachmentPayload.removeAttachmentIds && attachmentPayload.removeAttachmentIds.length > 0) {
      const existingAttachmentIds = new Set(existingLog.attachments.map((a) => a.id));
      const invalidIds = attachmentPayload.removeAttachmentIds.filter(
        (attachmentId) => !existingAttachmentIds.has(attachmentId)
      );

      if (invalidIds.length > 0) {
        throw new Error("One or more removeAttachmentIds are invalid for this progress log");
      }

      await prisma.progressLogAttachment.deleteMany({
        where: {
          progressLogId: id,
          id: {
            in: attachmentPayload.removeAttachmentIds,
          },
        },
      });
    }

    if (attachmentPayload.attachmentUpdates && attachmentPayload.attachmentUpdates.length > 0) {
      const existingAttachmentIds = new Set(existingLog.attachments.map((a) => a.id));

      for (const update of attachmentPayload.attachmentUpdates) {
        if (!update?.id || !existingAttachmentIds.has(update.id)) {
          throw new Error("One or more attachment ids are invalid for this progress log");
        }

        const patch: { name?: string; sortOrder?: number } = {};

        if (update.name !== undefined) {
          patch.name = String(update.name);
        }

        if (update.sortOrder !== undefined) {
          const parsedSort = Number(update.sortOrder);
          if (isNaN(parsedSort)) {
            throw new Error("attachment sortOrder must be a number");
          }
          patch.sortOrder = parsedSort;
        }

        if (Object.keys(patch).length > 0) {
          await prisma.progressLogAttachment.update({
            where: { id: update.id },
            data: patch,
          });
        }
      }
    }

    // Optional new files to append as attachments during update.
    if (files.length > 0) {
      const latestAttachments = await prisma.progressLogAttachment.findMany({
        where: { progressLogId: id },
        orderBy: { sortOrder: "desc" },
        take: 1,
      });
      const baseSortOrder = latestAttachments[0]?.sortOrder ?? -1;

      const uploadedAttachments = await Promise.all(
        files.map(async (file, i) => {
          const result = await uploadBufferToSharePoint({
            buffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            folder: "progress",
          });
          return {
            progressLogId: id,
            url: result.downloadUrl || result.webUrl || "",
            name: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            sortOrder: baseSortOrder + i + 1,
          };
        })
      );

      await prisma.progressLogAttachment.createMany({
        data: uploadedAttachments,
      });
    }

    const updatedLog = await prisma.progressLog.findUnique({
      where: { id },
      include: {
        attachments: { orderBy: { sortOrder: "asc" } },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      },
    });

    res.json({
      success: true,
      message: "Progress updated",
      data: serializeProgressLog(updatedLog),
    } as ProgressResponseDTO);
  } catch (error: any) {
    sendProgressError(res, error);
  }
}

// ========================================
// DELETE PROGRESS ENTRY
// ========================================
export async function deleteProgress(req: Request, res: Response) {
  try {
    let { id } = req.params as unknown as DeleteProgressParamsDTO;

    if (Array.isArray(id)) {
      id = id[0];
    }

    if (typeof id !== "string") {
      throw new Error("Invalid id parameter");
    }

    await deleteProgressLog(id);

    res.json({
      success: true,
      message: "Progress deleted",
    } as ProgressResponseDTO);
  } catch (error: any) {
    sendProgressError(res, error);
  }
}

// ========================================
// SCURVE CONTROLLER (FIXED)
// ========================================
export async function getSCurve(req: Request, res: Response) {
  try {
    // ✅ SAFE PARAM EXTRACTION
    let { projectId } = req.params as unknown as GetSCurveParamsDTO;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "projectId is required",
      });
    }

    // ========================================
    // GET DATA
    // ========================================
    const { data, status: computedStatus } =
      await getSCurveData(projectId);

    // ========================================
    // FALLBACK STATUS (SAFETY)
    // ========================================
    let status: "ON_TRACK" | "AHEAD" | "DELAYED" =
      (computedStatus as "ON_TRACK" | "AHEAD" | "DELAYED") || "ON_TRACK";

    if (!computedStatus && data.length > 0) {
      const latest = data[data.length - 1];

      // 🔥 ADD TOLERANCE (VERY IMPORTANT)
      const diff = latest.actual - latest.planned;

      if (diff > 5) status = "AHEAD";
      else if (diff < -5) status = "DELAYED";
      else status = "ON_TRACK";
    }

    // ========================================
    // RESPONSE
    // ========================================
    res.json({
      success: true,
      data,
      status,
    });
  } catch (error: any) {
    console.error("❌ SCurve error:", error);

    res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
}

// ========================================
// DELETE A SINGLE ATTACHMENT
// ========================================
export async function deleteProgressAttachment(req: Request, res: Response) {
  try {
    let { attachmentId } = req.params;
    if (Array.isArray(attachmentId)) attachmentId = attachmentId[0];

    await prisma.progressLogAttachment.delete({
      where: { id: attachmentId },
    });

    res.json({ success: true, message: "Attachment deleted" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// ========================================
// STREAM A SINGLE ATTACHMENT (CORS-SAFE)
// ========================================
export async function streamProgressAttachment(req: Request, res: Response) {
  try {
    let { attachmentId } = req.params;
    if (Array.isArray(attachmentId)) attachmentId = attachmentId[0];

    const attachment = await prisma.progressLogAttachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
      });
    }

    const file = await fetchSharePointFile(attachment.url);
    const contentType = attachment.mimeType || file.contentType;

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(attachment.name)}"`
    );
    res.setHeader("Cache-Control", "private, max-age=300");

    res.send(file.buffer);
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
}
