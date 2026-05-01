import { Request, Response } from "express";
import prisma from "../../config/prisma";
import { generateProjectTimeline } from "../timeline/timeline.service";

import {
  CreateScopeDTO,
  ScopeParamsDTO,
  UpdateScopeDTO,
  GetScopesByProjectParamsDTO
} from "./scope.dto";

export class ScopeController {

  // CREATE
  static async create(
    req: Request<{}, {}, CreateScopeDTO>,
    res: Response
  ) {
    try {
      const {
        name,
        description,
        projectId,
        budgetAllocated,
        budgetPercent,
        order
      } = req.body;

      // Calculate next order if not provided
      let nextOrder = order ?? 0;
      if (order === undefined) {
        const maxOrder = await prisma.scope.findFirst({
          where: { projectId },
          orderBy: { order: "desc" },
          select: { order: true }
        });
        nextOrder = (maxOrder?.order ?? -1) + 1;
      }

      const scope = await prisma.scope.create({
        data: {
          name,
          description,
          projectId,
          order: nextOrder,
          budgetAllocated,
          budgetPercent
        }
      });

      // 🔥 REGENERATE S-CURVE AFTER CREATE
      try {
        await generateProjectTimeline(projectId, "daily");
      } catch (timelineError) {
        console.warn("⚠️ Timeline regeneration failed:", timelineError);
        // Don't fail the create operation
      }

      res.json(scope);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET BY PROJECT
  static async getByProject(
    req: Request<GetScopesByProjectParamsDTO>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;

      const scopes = await prisma.scope.findMany({
        where: { projectId },
        include: {
          tasks: {
            orderBy: { order: "asc" }
          }
        },
        orderBy: {
          order: "asc"
        }
      });

      res.json(scopes);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET SINGLE
  static async getById(
    req: Request<ScopeParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const scope = await prisma.scope.findUnique({
        where: { id },
        include: {
          tasks: {
            include: {
              subtasks: true
            }
          }
        }
      });

      if (!scope) {
        return res.status(404).json({ message: "Scope not found" });
      }

      res.json(scope);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // UPDATE
  static async update(
    req: Request<ScopeParamsDTO, {}, UpdateScopeDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const {
        name,
        description,
        budgetAllocated,
        budgetPercent,
        order
      } = req.body;

      const updated = await prisma.scope.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(order !== undefined && { order }),
          ...(budgetAllocated !== undefined && { budgetAllocated }),
          ...(budgetPercent !== undefined && { budgetPercent })
        }
      });

      // Regenerate s-curve after updating scope
      try {
        await generateProjectTimeline(updated.projectId, "daily");
      } catch (timelineError) {
        console.warn("⚠️ Timeline regeneration failed:", timelineError);
      }

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // DELETE (FULL CASCADE CLEANUP)
  static async delete(
    req: Request<ScopeParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      // Get scope with full tree to know projectId
      const scope = await prisma.scope.findUnique({
        where: { id },
        include: {
          tasks: {
            include: {
              subtasks: true,
            },
          },
        },
      });

      if (!scope) {
        return res.status(404).json({ message: "Scope not found" });
      }

      const projectId = scope.projectId;

      // 🔥 DELETE BOTTOM → TOP
      for (const task of scope.tasks) {
        for (const subtask of task.subtasks) {
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
          where: { taskId: task.id },
        });

        // Delete task
        await prisma.task.delete({
          where: { id: task.id },
        });
      }

      // Delete scope
      await prisma.scope.delete({
        where: { id },
      });

      // 🔥 REGENERATE S-CURVE
      try {
        await generateProjectTimeline(projectId, "daily");
      } catch (timelineError) {
        console.warn("⚠️ Timeline regeneration failed:", timelineError);
        // Don't fail the delete operation
      }

      res.json({
        success: true,
        message: "Scope deleted successfully (full cascade cleanup + s-curve updated)",
      });
    } catch (error: any) {
      console.error("❌ Scope delete error:", error);
      res.status(400).json({ message: error.message });
    }
  }
}
