import { Request, Response } from "express";
import prisma from "../../config/prisma";
import { generateProjectTimeline } from "../timeline/timeline.service";
import { resolveTaskSelection } from "../admin/work-breakdown-maintenance/work-breakdown-maintenance.service";

import {
  CreateTaskDTO,
  TaskParamsDTO,
  UpdateTaskDTO,
  GetTasksByScopeParamsDTO,
} from "./task.dto";
async function recomputeScopeProgress(scopeId: string) {
  const tasks = await prisma.task.findMany({
    where: { scopeId },
  });

  if (tasks.length === 0) {
    await prisma.scope.update({
      where: { id: scopeId },
      data: { progress: 0 },
    });
    return;
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (const t of tasks) {
    const weight = t.budgetPercent ?? 1;

    totalWeight += weight;
    weightedSum += Number(t.progress) * weight;
  }

  const progress = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const scope = await prisma.scope.update({
    where: { id: scopeId },
    data: { progress },
  });

  // 🔥 CASCADE TO PROJECT
  const scopes = await prisma.scope.findMany({
    where: { projectId: scope.projectId },
  });

  let total = 0;
  let sum = 0;

  for (const s of scopes) {
    const weight = s.budgetPercent ?? 1;
    total += weight;
    sum += Number(s.progress) * weight;
  }

  const projectProgress = total > 0 ? sum / total : 0;

  await prisma.project.update({
    where: { id: scope.projectId },
    data: { progress: projectProgress },
  });
}
export class TaskController {
  static async create(req: Request<{}, {}, CreateTaskDTO>, res: Response) {
    try {
      const { title, description, scopeId, budgetAllocated, budgetPercent, order } =
        req.body;
      const parentScope = await (prisma.scope.findUnique as any)({ where: { id: scopeId } });
      if (!parentScope) return res.status(404).json({ message: "Scope not found" });
      const selection = await resolveTaskSelection({
        sourceType: req.body.sourceType,
        maintenanceId: req.body.taskMaintenanceId,
        customTitle: title,
        parentScopeMaintenanceId: parentScope.scopeMaintenanceId,
      });

      // Calculate next order if not provided
      let nextOrder = order ?? 0;
      if (order === undefined) {
        const maxOrder = await prisma.task.findFirst({
          where: { scopeId },
          orderBy: { order: "desc" },
          select: { order: true }
        });
        nextOrder = (maxOrder?.order ?? -1) + 1;
      }

      const task = await prisma.task.create({
        data: {
          title: selection.title,
          sourceType: selection.sourceType,
          taskMaintenanceId: selection.maintenanceId,
          description,
          scopeId,
          order: nextOrder,
          budgetAllocated,
          budgetPercent,
        },
      });

      await recomputeScopeProgress(scopeId);

      // 🔥 REGENERATE S-CURVE AFTER CREATE
      const scope = await prisma.scope.findUnique({
        where: { id: scopeId },
        select: { projectId: true },
      });
      if (scope?.projectId) {
        try {
          await generateProjectTimeline(scope.projectId, "daily");
        } catch (timelineError) {
          console.warn("⚠️ Timeline regeneration failed:", timelineError);
        }
      }

      res.json(task);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // 🔥 GET TASKS BY SCOPE (FIXED)
  static async getByScope(
    req: Request<GetTasksByScopeParamsDTO>,
    res: Response,
  ) {
    try {
      const { scopeId } = req.params;

      const tasks = await prisma.task.findMany({
        where: { scopeId },
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
      const existing = await (prisma.task.findUnique as any)({
        where: { id },
        include: { scope: true },
      });
      if (!existing) return res.status(404).json({ message: "Task not found" });
      const selectionChanged =
        req.body.sourceType !== undefined ||
        req.body.taskMaintenanceId !== undefined ||
        title !== undefined;
      const selection = selectionChanged
        ? await resolveTaskSelection({
            sourceType: req.body.sourceType ?? existing.sourceType,
            maintenanceId:
              req.body.taskMaintenanceId !== undefined
                ? req.body.taskMaintenanceId
                : existing.taskMaintenanceId,
            customTitle: title ?? existing.title,
            parentScopeMaintenanceId: existing.scope.scopeMaintenanceId,
          })
        : null;

      const updated = await prisma.task.update({
        where: { id },
        data: {
          ...(selection
            ? {
                title: selection.title,
                sourceType: selection.sourceType,
                taskMaintenanceId: selection.maintenanceId,
              }
            : {}),
          ...(description !== undefined && { description }),
          ...(order !== undefined && { order }),
          ...(budgetAllocated !== undefined && { budgetAllocated }),
          ...(budgetPercent !== undefined && { budgetPercent }),
        },
      });

      // Get scope and project info for s-curve regeneration
      const task = await prisma.task.findUnique({
        where: { id },
        include: { scope: true }
      });

      if (task) {
        // Regenerate s-curve after updating task
        try {
          await generateProjectTimeline(task.scope.projectId, "daily");
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

      const scopeId = existing.scopeId;
      
      // Get projectId for s-curve regeneration
      const scope = await prisma.scope.findUnique({
        where: { id: scopeId },
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

      // 🔥 RECOMPUTE SCOPE PROGRESS
      await recomputeScopeProgress(scopeId);

      // 🔥 REGENERATE S-CURVE
      if (scope?.projectId) {
        try {
          await generateProjectTimeline(scope.projectId, "daily");
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
