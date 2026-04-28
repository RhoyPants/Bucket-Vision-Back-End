import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { addProgressLog, recomputeSubtaskProgress } from "./progress.service";
import { getSCurve as getSCurveData } from "./scurve.service";

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
    let subtaskId: string | string[] | undefined = (req.params as any).subtaskId;

    if (Array.isArray(subtaskId)) {
      subtaskId = subtaskId[0];
    }

    if (!subtaskId || typeof subtaskId !== "string") {
      return res.status(400).json({
        success: false,
        message: "subtaskId is required",
      });
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
// ADD / UPSERT PROGRESS (ENHANCED)
// ========================================
export async function addProgress(req: Request, res: Response) {
  try {
    const { 
      subtaskId, 
      date, 
      dailyPercent, 
      remarks,
      location,
      latitude,
      longitude,
      dayNumber
    } = req.body;

    const file = (req as any).file;

    // 🔥 VALIDATION
    if (!subtaskId) {
      return res.status(400).json({
        success: false,
        message: "subtaskId is required",
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "date is required",
      });
    }

    const parsedDaily = Number(dailyPercent);
    
    if (isNaN(parsedDaily)) {
      return res.status(400).json({
        success: false,
        message: "dailyPercent must be a number",
      });
    }

    if (parsedDaily < 0 || parsedDaily > 100) {
      return res.status(400).json({
        success: false,
        message: "dailyPercent must be between 0 and 100",
      });
    }

    const parsedLat = latitude ? Number(latitude) : undefined;
    const parsedLng = longitude ? Number(longitude) : undefined;
    const parsedDay = dayNumber ? Number(dayNumber) : undefined;
    const photoUrl = file ? `/uploads/${file.filename}` : undefined;
    const userId = (req as any).user?.id; // Get from authenticated user

    const progressData: CreateProgressDTO = {
      subtaskId,
      date: new Date(date),
      dailyPercent: parsedDaily,
      userId: userId,
      remarks: remarks,
      photoUrl: photoUrl,
      latitude: parsedLat,
      longitude: parsedLng,
      location: location,
      dayNumber: parsedDay,
    };

    await addProgressLog(progressData);
    await recomputeSubtaskProgress(subtaskId);

    res.json({
      success: true,
      message: "Progress logged successfully",
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
    let id: string | string[] | undefined = (req.params as any).id;

    if (Array.isArray(id)) {
      id = id[0];
    }

    if (!id || typeof id !== "string") {
      return res.status(400).json({
        success: false,
        message: "Progress ID is required",
      });
    }

    const body = req.body;
    const file = (req as any).file;
    const updateData: UpdateProgressDTO = {};

    // Safely parse and validate dailyPercent if provided
    if (body.dailyPercent !== undefined && body.dailyPercent !== null) {
      const daily = Number(body.dailyPercent);
      if (isNaN(daily) || daily < 0 || daily > 100) {
        return res.status(400).json({
          success: false,
          message: "dailyPercent must be a number between 0 and 100",
        });
      }
      updateData.dailyPercent = daily;
    }

    // Other fields
    if (body.remarks !== undefined) {
      updateData.remarks = body.remarks;
    }
    if (body.location !== undefined) {
      updateData.location = body.location;
    }
    if (body.latitude !== undefined) {
      updateData.latitude = body.latitude ? Number(body.latitude) : undefined;
    }
    if (body.longitude !== undefined) {
      updateData.longitude = body.longitude ? Number(body.longitude) : undefined;
    }
    if (body.dayNumber !== undefined) {
      updateData.dayNumber = body.dayNumber ? Number(body.dayNumber) : undefined;
    }
    if (file) {
      updateData.photoUrl = `/uploads/${file.filename}`;
    }

    const log = await prisma.progressLog.update({
      where: { id },
      data: updateData,
    });

    // Recompute if dailyPercent changed
    if (updateData.dailyPercent !== undefined) {
      await recomputeSubtaskProgress(log.subtaskId);
    }

    res.json({
      success: true,
      message: "Progress updated successfully",
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
    let id: string | string[] | undefined = (req.params as any).id;

    if (Array.isArray(id)) {
      id = id[0];
    }

    if (!id || typeof id !== "string") {
      return res.status(400).json({
        success: false,
        message: "Progress ID is required",
      });
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
    let projectId: string | string[] | undefined = (req.params as any).projectId;

    if (Array.isArray(projectId)) {
      projectId = projectId[0];
    }

    if (!projectId || typeof projectId !== "string") {
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
// GET SUBTASK WITH PROGRESS DETAILS
// ========================================
export async function getSubtaskWithDetails(req: Request, res: Response) {
  try {
    let subtaskId: string | string[] | undefined = (req.params as any).subtaskId;

    if (Array.isArray(subtaskId)) {
      subtaskId = subtaskId[0];
    }

    if (!subtaskId || typeof subtaskId !== "string") {
      return res.status(400).json({
        success: false,
        message: "subtaskId is required",
      });
    }

    const subtask = await prisma.subtask.findUnique({
      where: { id: subtaskId },
      include: {
        progressLogs: {
          orderBy: { date: "asc" },
        },
        task: true,
      },
    });

    if (!subtask) {
      return res.status(404).json({
        success: false,
        message: "Subtask not found",
      });
    }

    res.json({
      success: true,
      data: subtask,
    } as ProgressResponseDTO);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

// ========================================
// GET TASK WITH SUBTASKS & PROGRESS
// ========================================
export async function getTaskWithProgress(req: Request, res: Response) {
  try {
    let taskId: string | string[] | undefined = (req.params as any).taskId;

    if (Array.isArray(taskId)) {
      taskId = taskId[0];
    }

    if (!taskId || typeof taskId !== "string") {
      return res.status(400).json({
        success: false,
        message: "taskId is required",
      });
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        subtasks: {
          include: {
            progressLogs: {
              orderBy: { date: "asc" },
            },
          },
        },
        category: true,
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    res.json({
      success: true,
      data: task,
    } as ProgressResponseDTO);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

// ========================================
// GET PROJECT COMPLETE OVERVIEW
// ========================================
export async function getProjectOverview(req: Request, res: Response) {
  try {
    let projectId: string | string[] | undefined = (req.params as any).projectId;

    if (Array.isArray(projectId)) {
      projectId = projectId[0];
    }

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({
        success: false,
        message: "projectId is required",
      });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        categories: {
          include: {
            tasks: {
              include: {
                subtasks: {
                  include: {
                    progressLogs: {
                      orderBy: { date: "asc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    res.json({
      success: true,
      data: project,
    } as ProgressResponseDTO);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}