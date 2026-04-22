import { Request, Response } from "express";
import prisma from "../../config/prisma";
import { SubtaskService } from "./subtask.service";

import {
  CreateSubtaskDTO,
  GetSubtasksParamsDTO,
  UpdateSubtaskDTO,
  UpdateSubtaskParamsDTO,
  DeleteSubtaskParamsDTO,
  ToggleChecklistParamsDTO,
  DeleteChecklistItemParamsDTO,
  GetSubtaskByIdParamsDTO,
} from "./subtask.dto";

async function recomputeTask(taskId: string) {
  const subtasks = await prisma.subtask.findMany({
    where: { taskId },
  });

  if (subtasks.length === 0) {
    await prisma.task.update({
      where: { id: taskId },
      data: { progress: 0 },
    });
    return;
  }

  let total = 0;

  for (const s of subtasks) {
    total += s.progress || 0;
  }

  const progress = total / subtasks.length;

  await prisma.task.update({
    where: { id: taskId },
    data: { progress },
  });
}
export class SubtaskController {
  // ========================================
  // CREATE
  // ========================================
  static async create(req: Request<{}, {}, CreateSubtaskDTO>, res: Response) {
    try {
      const {
        taskId,
        title,
        description,
        priority,
        projectedStartDate,
        projectedEndDate,
        budgetAllocated,
        budgetPercent,
        remarks,
      } = req.body;

      const userId = (req as any).user.id;

      const subtask = await prisma.subtask.create({
        data: {
          title,
          description,
          priority,
          remarks,

          projectedStartDate: projectedStartDate
            ? new Date(projectedStartDate)
            : undefined,

          projectedEndDate: projectedEndDate
            ? new Date(projectedEndDate)
            : undefined,

          budgetAllocated,
          budgetPercent,

          order: 0,

          // 🔥 NEW SYSTEM
          status: 0, // PENDING

          task: { connect: { id: taskId } },
          creator: { connect: { id: userId } },
        },
      });
      await recomputeTask(taskId);

      res.json(subtask);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET (KANBAN)
  // ========================================
  static async getByTask(req: Request<GetSubtasksParamsDTO>, res: Response) {
    try {
      const { taskId } = req.params;

      const subtasks = await prisma.subtask.findMany({
        where: { taskId },
        include: {
          assignees: { include: { user: true } },
          checklists: true,
          progressLogs: true,
        },
        orderBy: [
          { status: "asc" }, // 🔥 GROUP BY STATUS
          { order: "asc" },
        ],
      });

      res.json(subtasks);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // UPDATE
  // ========================================
  static async update(
    req: Request<UpdateSubtaskParamsDTO, {}, UpdateSubtaskDTO>,
    res: Response,
  ) {
    try {
      const { id } = req.params;

      const {
        title,
        description,
        priority,
        projectedStartDate,
        projectedEndDate,
        budgetAllocated,
        budgetPercent,
        remarks,
      } = req.body;

      const updated = await prisma.subtask.update({
        where: { id },
        data: {
          title,
          description,
          priority,
          remarks,

          projectedStartDate: projectedStartDate
            ? new Date(projectedStartDate)
            : undefined,

          projectedEndDate: projectedEndDate
            ? new Date(projectedEndDate)
            : undefined,

          budgetAllocated,
          budgetPercent,
        },
      });

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // DELETE
  // ========================================
  static async delete(req: Request<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;

      // 🔥 1. GET SUBTASK FIRST
      const subtask = await prisma.subtask.findUnique({
        where: { id },
        select: { taskId: true },
      });

      if (!subtask) {
        return res.status(404).json({ message: "Subtask not found" });
      }

      const taskId = subtask.taskId;

      // 🔥 2. DELETE PROGRESS LOGS FIRST
      await prisma.progressLog.deleteMany({
        where: { subtaskId: id },
      });

      // 🔥 3. DELETE SUBTASK
      await prisma.subtask.delete({
        where: { id },
      });

      // 🔥 4. RECOMPUTE TASK PROGRESS
      const subtasks = await prisma.subtask.findMany({
        where: { taskId },
      });

      let totalWeight = 0;
      let weightedProgress = 0;

      for (const s of subtasks) {
        const weight = s.budgetPercent || 0;
        const progress = s.progress || 0;

        weightedProgress += progress * weight;
        totalWeight += weight;
      }

      const newProgress = totalWeight > 0 ? weightedProgress / totalWeight : 0;

      await prisma.task.update({
        where: { id: taskId },
        data: {
          progress: newProgress,
        },
      });

      res.json({
        message: "Subtask deleted and progress recalculated",
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // MOVE (OPTIONAL NOW)
  // ========================================
  static async move(req: Request, res: Response) {
    try {
      const subtaskId = Array.isArray(req.params.subtaskId)
        ? req.params.subtaskId[0]
        : req.params.subtaskId;

      const { newOrder } = req.body;
      const userId = (req as any).user.id;

      // 🔥 statusId removed — only reorder now
      const result = await SubtaskService.moveSubtask(
        subtaskId,
        null,
        newOrder,
        userId,
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // TOGGLE CHECKLIST
  // ========================================
  static async toggleChecklist(
    req: Request<ToggleChecklistParamsDTO>,
    res: Response,
  ) {
    try {
      const { checklistId } = req.params;
      const userId = (req as any).user.id;

      const result = await SubtaskService.toggleChecklist(checklistId, userId);

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // ADD CHECKLIST
  // ========================================
  static async addChecklist(req: Request, res: Response) {
    try {
      const { subtaskId, title } = req.body;

      const last = await prisma.checklist.findFirst({
        where: { subtaskId },
        orderBy: { order: "desc" },
      });

      const checklist = await prisma.checklist.create({
        data: {
          title,
          subtaskId,
          order: (last?.order || 0) + 1,
        },
      });

      res.json(checklist);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // DELETE CHECKLIST
  // ========================================
  static async deleteChecklist(
    req: Request<DeleteChecklistItemParamsDTO>,
    res: Response,
  ) {
    try {
      const { checklistId } = req.params;

      await prisma.checklist.delete({
        where: { id: checklistId },
      });

      res.json({ message: "Checklist deleted" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET BY ID
  // ========================================
  static async getById(req: Request<GetSubtaskByIdParamsDTO>, res: Response) {
    try {
      const { id } = req.params;

      const subtask = await prisma.subtask.findUnique({
        where: { id },
        include: {
          progressLogs: true,
          checklists: true,
          assignees: { include: { user: true } },
        },
      });

      if (!subtask) {
        return res.status(404).json({ message: "Subtask not found" });
      }

      res.json(subtask);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
}
