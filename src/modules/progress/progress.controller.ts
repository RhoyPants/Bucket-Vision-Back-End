import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { addProgressLog, recomputeSubtaskProgress } from "./progress.service";
import { getSCurve as getSCurveData } from "./scurve.service";
import { uploadBufferToSharePoint } from "../../services/sharepoint-upload.service";

import {
  GetBySubtaskParamsDTO,
  CreateProgressDTO,
  UpdateProgressDTO,
  UpdateProgressParamsDTO,
  DeleteProgressParamsDTO,
  GetSCurveParamsDTO,
  ProgressResponseDTO,
} from "./porogress.dto";

const prisma = new PrismaClient();

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
    });

    res.json({
      success: true,
      data: logs,
    } as ProgressResponseDTO);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

// ========================================
// ADD / UPSERT PROGRESS (🔥 FIXED)
// ========================================
export async function addProgress(req: Request, res: Response) {
  try {
    const { subtaskId, date, dailyPercent, remarks } = req.body;

    const file = (req as any).file;
    const userId = (req as any).user?.id;

    // 🔥 FIX: parse everything properly
    const parsedDaily = Number(dailyPercent);
    const parsedLat = req.body.lat ? Number(req.body.lat) : null;
    const parsedLng = req.body.lng ? Number(req.body.lng) : null;

    // 🔥 VALIDATION (IMPORTANT)
    if (isNaN(parsedDaily)) {
      throw new Error("dailyPercent must be a number");
    }

    if (parsedDaily < 0 || parsedDaily > 100) {
      throw new Error("dailyPercent must be between 0 and 100");
    }

    let photoUrl: string | undefined;

    if (file?.buffer) {
      const uploaded = await uploadBufferToSharePoint({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        folder: "progress",
      });

      photoUrl = uploaded.webUrl || uploaded.downloadUrl || undefined;
    }

    const progressData: CreateProgressDTO = {
      subtaskId,
      date: new Date(date),
      dailyPercent: parsedDaily, // ✅ FIXED
      remarks: remarks || null,
      photoUrl,
      latitude: parsedLat,
      longitude: parsedLng,
      userId,
    };

    const createdLog = await addProgressLog(progressData);

    res.json({
      success: true,
      message: "Progress updated successfully",
      data: createdLog,
    } as ProgressResponseDTO);
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
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

    const body = req.body;

    const updateData: UpdateProgressDTO = {
      ...body,
      dailyPercent: body.dailyPercent
        ? Number(body.dailyPercent)
        : undefined,
    };

    const log = await prisma.progressLog.update({
      where: { id },
      data: updateData,
    });

    await recomputeSubtaskProgress(log.subtaskId);

    res.json({
      success: true,
      message: "Progress updated",
    } as ProgressResponseDTO);
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
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

    const log = await prisma.progressLog.delete({
      where: { id },
    });

    await recomputeSubtaskProgress(log.subtaskId);

    res.json({
      success: true,
      message: "Progress deleted",
    } as ProgressResponseDTO);
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
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