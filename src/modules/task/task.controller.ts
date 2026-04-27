import { Request, Response } from "express";
import prisma from "../../config/prisma";
import { generateProjectTimeline } from "../timeline/timeline.service";

import {
  CreateTaskDTO,
  TaskParamsDTO,
  UpdateTaskDTO,
  GetTasksByCategoryParamsDTO,
} from "./task.dto";
async function recomputeCategoryProgress(categoryId: string) {
  const tasks = await prisma.task.findMany({
    where: { categoryId },
  });

  if (tasks.length === 0) {
    await prisma.category.update({
      where: { id: categoryId },
      data: { progress: 0 },
    });
    return;
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (const t of tasks) {
    const weight = t.budgetPercent ?? 1;

    totalWeight += weight;
    weightedSum += (t.progress || 0) * weight;
  }

  const progress = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const category = await prisma.category.update({
    where: { id: categoryId },
    data: { progress },
  });

  // 🔥 CASCADE TO PROJECT
  const categories = await prisma.category.findMany({
    where: { projectId: category.projectId },
  });

  let total = 0;
  let sum = 0;

  for (const c of categories) {
    const weight = c.budgetPercent ?? 1;
    total += weight;
    sum += (c.progress || 0) * weight;
  }

  const projectProgress = total > 0 ? sum / total : 0;

  await prisma.project.update({
    where: { id: category.projectId },
    data: { progress: projectProgress },
  });
}
export class TaskController {
  // CREATE TASK
  static async create(req: Request<{}, {}, CreateTaskDTO>, res: Response) {
    try {
      const { title, description, categoryId, budgetAllocated, budgetPercent, order } =
        req.body;

      // Calculate next order if not provided
      let nextOrder = order ?? 0;
      if (order === undefined) {
        const maxOrder = await prisma.task.findFirst({
          where: { categoryId },
          orderBy: { order: "desc" },
          select: { order: true }
        });
        nextOrder = (maxOrder?.order ?? -1) + 1;
      }

      const task = await prisma.task.create({
        data: {
          title,
          description,
          categoryId,
          order: nextOrder,
          budgetAllocated,
          budgetPercent,
        },
      });

      await recomputeCategoryProgress(categoryId);

      // 🔥 REGENERATE S-CURVE AFTER CREATE
      const category = await prisma.category.findUnique({
        where: { id: categoryId },
        select: { projectId: true },
      });
      if (category?.projectId) {
        try {
          await generateProjectTimeline(category.projectId, "daily");
        } catch (timelineError) {
          console.warn("⚠️ Timeline regeneration failed:", timelineError);
        }
      }

      res.json(task);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // 🔥 GET TASKS BY CATEGORY (FIXED)
  static async getByCategory(
    req: Request<GetTasksByCategoryParamsDTO>,
    res: Response,
  ) {
    try {
      const { categoryId } = req.params;

      const tasks = await prisma.task.findMany({
        where: { categoryId },
        orderBy: {
          order: "asc",
        },
      });

      res.json(tasks);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET SINGLE TASK
  static async getById(req: Request<TaskParamsDTO>, res: Response) {
    try {
      const { id } = req.params;

      const task = await prisma.task.findUnique({
        where: { id },
        include: {
          subtasks: {
            include: {
              assignees: { include: { user: true } },
              checklists: true,
              progressLogs: true, // 🔥 ADD THIS
            },
            orderBy: [{ order: "asc" }],
          },
        },
      });

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json(task);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // UPDATE TASK (SAFE 🔥)
  static async update(
    req: Request<TaskParamsDTO, {}, UpdateTaskDTO>,
    res: Response,
  ) {
    try {
      const { id } = req.params;

      const { title, description, budgetAllocated, budgetPercent, order } = req.body;

      const updated = await prisma.task.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(description !== undefined && { description }),
          ...(order !== undefined && { order }),
          ...(budgetAllocated !== undefined && { budgetAllocated }),
          ...(budgetPercent !== undefined && { budgetPercent }),
        },
      });

      // Get category and project info for s-curve regeneration
      const task = await prisma.task.findUnique({
        where: { id },
        include: { category: true }
      });

      if (task) {
        // Regenerate s-curve after updating task
        try {
          await generateProjectTimeline(task.category.projectId, "daily");
        } catch (timelineError) {
          console.warn("⚠️ Timeline regeneration failed:", timelineError);
        }
      }

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // DELETE TASK (FULL CASCADE CLEANUP)
  static async delete(req: Request<TaskParamsDTO>, res: Response) {
    try {
      const { id } = req.params;

      const existing = await prisma.task.findUnique({
        where: { id },
        include: {
          subtasks: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ message: "Task not found" });
      }

      const categoryId = existing.categoryId;
      
      // Get projectId for s-curve regeneration
      const category = await prisma.category.findUnique({
        where: { id: categoryId },
        select: { projectId: true },
      });

      // 🔥 DELETE BOTTOM → TOP
      for (const subtask of existing.subtasks) {
        // Delete all subtask children
        await prisma.progressLog.deleteMany({
          where: { subtaskId: subtask.id },
        });
        await prisma.checklist.deleteMany({
          where: { subtaskId: subtask.id },
        });
        await prisma.subtaskAssignee.deleteMany({
          where: { subtaskId: subtask.id },
        });
        await prisma.comment.deleteMany({
          where: { subtaskId: subtask.id },
        });
        await prisma.attachment.deleteMany({
          where: { subtaskId: subtask.id },
        });
        await prisma.activityLog.deleteMany({
          where: { subtaskId: subtask.id },
        });

        // Delete subtask
        await prisma.subtask.delete({
          where: { id: subtask.id },
        });
      }

      // Delete task assignees
      await prisma.taskAssignee.deleteMany({
        where: { taskId: id },
      });

      // Delete task
      await prisma.task.delete({
        where: { id },
      });

      // 🔥 RECOMPUTE CATEGORY PROGRESS
      await recomputeCategoryProgress(categoryId);

      // 🔥 REGENERATE S-CURVE
      if (category?.projectId) {
        try {
          await generateProjectTimeline(category.projectId, "daily");
        } catch (timelineError) {
          console.warn("⚠️ Timeline regeneration failed:", timelineError);
          // Don't fail the delete operation
        }
      }

      res.json({
        success: true,
        message: "Task deleted successfully (full cascade cleanup + s-curve updated)",
      });
    } catch (error: any) {
      console.error("❌ Task delete error:", error);
      res.status(400).json({ message: error.message });
    }
  }
}
