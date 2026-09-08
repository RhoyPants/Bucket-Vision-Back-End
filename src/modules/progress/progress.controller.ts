import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  addProgressLog,
  cancelProgressUpdateRequest,
  changeProgressValue,
  deleteProgressLog,
  ProgressRuleError,
  reviewProgressUpdateRequest,
  updateProgressLog,
} from "./progress.service";
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

    const body = req.body ?? {};
    const userId = (req as any).user?.id;
    if (!userId) throw new ProgressRuleError("Unauthorized", 401, "UNAUTHORIZED");
    if (existingLog.userId !== userId) {
      throw new ProgressRuleError("You can only update your own progress entry.", 403, "PROGRESS_NOT_OWNED");
    }

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

    let log: any;
    let progressAudit: any = null;
    if (updateData.dailyPercent !== undefined) {
      if (
        updateData.dailyPercent < Number(existingLog.dailyPercent) &&
        (files.length > 0 || body.attachmentUpdates || body.removeAttachmentIds)
      ) {
        throw new ProgressRuleError(
          "Attachments cannot be changed as part of a pending progress decrease request.",
          400,
          "PENDING_UPDATE_ATTACHMENTS_NOT_ALLOWED",
        );
      }
      const { dailyPercent: requestedPercent, ...immediateData } = updateData;
      const result = await changeProgressValue({
        progressLogId: id,
        requestedById: userId,
        requestedPercent,
        remarks: body.remarks,
        immediateData,
      });
      if (result.requiresApproval) {
        return res.status(202).json({
          success: true,
          message: "Progress decrease submitted for BU Head approval",
          data: { request: result.request, progressLog: serializeProgressLog(existingLog as any) },
        });
      }
      log = result.log;
      progressAudit = result.request;
    } else {
      log = await updateProgressLog(id, { ...updateData });
    }

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
      audit: progressAudit,
    } as ProgressResponseDTO);
  } catch (error: any) {
    sendProgressError(res, error);
  }
}

const progressUpdateRequestInclude = {
  requestedBy: { select: { id: true, name: true, email: true } },
  assignedApprover: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  businessUnit: { select: { id: true, name: true } },
  progressLog: {
    select: {
      id: true,
      subtaskId: true,
      date: true,
      dailyPercent: true,
      cumulativePercent: true,
      subtask: {
        select: {
          id: true,
          title: true,
          task: {
            select: {
              id: true,
              title: true,
              scope: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
            },
          },
        },
      },
    },
  },
} as const;

const progressUpdateStatuses = ["PENDING", "APPLIED", "APPROVED", "REJECTED", "CANCELLED"];

function parseUpdateRequestStatus(value: unknown, fallback?: string) {
  const status = value ? String(value).trim().toUpperCase() : fallback;
  if (status && !progressUpdateStatuses.includes(status)) {
    throw new ProgressRuleError("Invalid progress update request status.", 400, "INVALID_UPDATE_REQUEST_STATUS");
  }
  return status;
}

function parsePagination(query: Request["query"]) {
  const requestedPage = Number(query.page || 1);
  const requestedLimit = Number(query.limit || 20);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100)
    : 20;
  return { page, limit };
}

function formatProgressDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function progressUpdateSearchWhere(search: unknown) {
  const term = String(search || "").trim();
  if (!term) return {};
  const contains = { contains: term, mode: "insensitive" as const };
  return {
    OR: [
      { requestedBy: { name: contains } },
      { progressLog: { subtask: { title: contains } } },
      { progressLog: { subtask: { task: { title: contains } } } },
      { progressLog: { subtask: { task: { scope: { name: contains } } } } },
      { progressLog: { subtask: { task: { scope: { project: { name: contains } } } } } },
    ],
  };
}

function serializeProgressUpdateRequest(request: any, userId: string) {
  const subtask = request.progressLog.subtask;
  const task = subtask.task;
  const scope = task.scope;
  const project = scope.project;
  return {
    id: request.id,
    status: request.status,
    currentPercent: request.currentPercent,
    requestedPercent: request.requestedPercent,
    difference: request.difference,
    remarks: request.remarks,
    reviewRemarks: request.reviewRemarks,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    reviewedAt: request.reviewedAt,
    cancelledAt: request.cancelledAt,
    appliedAt: request.appliedAt,
    canCancel: request.status === "PENDING" && request.requestedById === userId,
    canReview: request.status === "PENDING" && request.assignedApproverId === userId,
    requestedBy: request.requestedBy,
    assignedApprover: request.assignedApprover,
    reviewedBy: request.reviewedBy,
    progressLog: {
      id: request.progressLog.id,
      subtaskId: request.progressLog.subtaskId,
      date: formatProgressDate(request.progressLog.date),
      dailyPercent: request.progressLog.dailyPercent,
      cumulativePercent: request.progressLog.cumulativePercent,
    },
    subtask: { id: subtask.id, title: subtask.title },
    task: { id: task.id, title: task.title },
    scope: { id: scope.id, name: scope.name },
    project: { id: project.id, name: project.name },
    businessUnit: request.businessUnit,
  };
}

async function listProgressUpdateRequests(req: Request, res: Response, mode: "mine" | "inbox") {
  try {
    const userId = (req as any).user?.id;
    if (!userId) throw new ProgressRuleError("Unauthorized", 401, "UNAUTHORIZED");
    const status = parseUpdateRequestStatus(req.query.status);
    const { page, limit } = parsePagination(req.query);
    const where: any = {
      ...(mode === "mine" ? { requestedById: userId } : { assignedApproverId: userId }),
      ...(status ? { status } : {}),
      ...progressUpdateSearchWhere(req.query.search),
    };
    const [total, requests] = await prisma.$transaction([
      prisma.progressUpdateRequest.count({ where }),
      prisma.progressUpdateRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: progressUpdateRequestInclude,
      }),
    ]);
    res.json({
      success: true,
      data: requests.map((request) => serializeProgressUpdateRequest(request, userId)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    sendProgressError(res, error);
  }
}

export async function getMyProgressUpdateRequests(req: Request, res: Response) {
  return listProgressUpdateRequests(req, res, "mine");
}

export async function getProgressUpdateInbox(req: Request, res: Response) {
  return listProgressUpdateRequests(req, res, "inbox");
}

export async function getSubtaskProgressUpdateRequests(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) throw new ProgressRuleError("Unauthorized", 401, "UNAUTHORIZED");
    const subtaskId = String(req.params.subtaskId || "");
    const status = parseUpdateRequestStatus(req.query.status, "PENDING");
    const requests = await prisma.progressUpdateRequest.findMany({
      where: {
        progressLog: { subtaskId },
        status: status as any,
        OR: [{ requestedById: userId }, { assignedApproverId: userId }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: progressUpdateRequestInclude,
    });
    res.json({
      success: true,
      data: requests.map((request) => serializeProgressUpdateRequest(request, userId)),
    });
  } catch (error: any) {
    sendProgressError(res, error);
  }
}

export async function approveProgressUpdate(req: Request, res: Response) {
  try {
    const request = await reviewProgressUpdateRequest({
      requestId: String(req.params.id), reviewerId: (req as any).user?.id,
      decision: "APPROVED", reviewRemarks: req.body?.remarks,
    });
    res.json({ success: true, message: "Progress decrease approved and applied", data: request });
  } catch (error: any) { sendProgressError(res, error); }
}

export async function rejectProgressUpdate(req: Request, res: Response) {
  try {
    const request = await reviewProgressUpdateRequest({
      requestId: String(req.params.id), reviewerId: (req as any).user?.id,
      decision: "REJECTED", reviewRemarks: req.body?.remarks,
    });
    res.json({ success: true, message: "Progress decrease rejected; current progress was retained", data: request });
  } catch (error: any) { sendProgressError(res, error); }
}

export async function cancelProgressUpdate(req: Request, res: Response) {
  try {
    const request = await cancelProgressUpdateRequest(String(req.params.id), (req as any).user?.id);
    res.json({ success: true, message: "Progress update request cancelled", data: request });
  } catch (error: any) { sendProgressError(res, error); }
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

// ========================================
// UNIFIED PROGRESS HISTORY (COMBINED LOGS + UPDATE REQUESTS)
// ========================================
export async function getSubtaskProgressHistory(req: Request, res: Response) {
  try {
    const subtaskId = String(req.params.subtaskId || "");
    const { page, limit } = parsePagination(req.query);

    if (!subtaskId) {
      throw new ProgressRuleError("subtaskId is required", 400, "MISSING_SUBTASK_ID");
    }

    // Fetch all progress logs for this subtask
    const logs = await prisma.progressLog.findMany({
      where: { subtaskId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        updateRequests: {
          include: {
            requestedBy: { select: { id: true, name: true, email: true } },
            assignedApprover: { select: { id: true, name: true, email: true } },
            reviewedBy: { select: { id: true, name: true, email: true } },
            businessUnit: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });

    // Build unified timeline by combining logs and their update requests
    const events: any[] = [];

    for (const log of logs) {
      // Add PROGRESS_CREATED event
      events.push({
        type: "PROGRESS_CREATED",
        timestamp: log.createdAt,
        date: log.date,
        id: `log-${log.id}`,
        logId: log.id,
        value: roundProgress(log.dailyPercent),
        cumulativePercent: roundProgress(log.cumulativePercent),
        performedBy: log.user,
        remarks: log.remarks,
        attachmentsCount: log.updateRequests?.length ?? 0,
      });

      // Add events for each update request associated with this log
      if (log.updateRequests && log.updateRequests.length > 0) {
        for (const request of log.updateRequests) {
          const baseEvent = {
            timestamp: request.createdAt,
            id: request.id,
            requestId: request.id,
            logId: log.id,
            date: log.date,
            currentPercent: roundProgress(request.currentPercent),
            requestedPercent: roundProgress(request.requestedPercent),
            difference: roundProgress(request.difference),
            remarks: request.remarks,
            businessUnit: request.businessUnit,
            requestedBy: request.requestedBy,
          };

          if (request.status === "APPLIED") {
            events.push({
              ...baseEvent,
              type: "PROGRESS_UPDATED",
              appliedAt: request.appliedAt,
            });
          } else if (request.status === "PENDING") {
            events.push({
              ...baseEvent,
              type: "DECREASE_REQUESTED",
              assignedApprover: request.assignedApprover,
            });
          } else if (request.status === "APPROVED") {
            events.push({
              ...baseEvent,
              type: "DECREASE_APPROVED",
              approvedBy: request.reviewedBy,
              approvedAt: request.reviewedAt,
              reviewRemarks: request.reviewRemarks,
            });
          } else if (request.status === "REJECTED") {
            events.push({
              ...baseEvent,
              type: "DECREASE_REJECTED",
              rejectedBy: request.reviewedBy,
              rejectedAt: request.reviewedAt,
              rejectionRemarks: request.reviewRemarks,
            });
          } else if (request.status === "CANCELLED") {
            events.push({
              ...baseEvent,
              type: "DECREASE_CANCELLED",
              cancelledAt: request.cancelledAt,
              cancelledBy: request.requestedBy,
            });
          }
        }
      }
    }

    // Sort all events chronologically (newest first)
    events.sort((a, b) => {
      const timeA = a.timestamp.getTime();
      const timeB = b.timestamp.getTime();
      if (timeA !== timeB) return timeB - timeA; // Reverse for newest first
      // If same timestamp, order by type priority (reverse)
      const typePriority: Record<string, number> = {
        PROGRESS_CREATED: 1,
        PROGRESS_UPDATED: 2,
        DECREASE_REQUESTED: 3,
        DECREASE_APPROVED: 4,
        DECREASE_REJECTED: 5,
        DECREASE_CANCELLED: 6,
      };
      return (typePriority[b.type] || 99) - (typePriority[a.type] || 99);
    });

    // Apply pagination
    const total = events.length;
    const skip = (page - 1) * limit;
    const paginatedEvents = events.slice(skip, skip + limit);

    res.json({
      success: true,
      data: paginatedEvents,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    sendProgressError(res, error);
  }
}
