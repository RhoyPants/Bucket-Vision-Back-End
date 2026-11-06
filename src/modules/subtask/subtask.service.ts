import prisma from "../../config/prisma";

export class SubtaskService {
  // ========================================
  // MOVE SUBTASK (ORDER ONLY 🔥 FIXED)
  // ========================================
  static async moveSubtask(
    subtaskId: string,
    targetStatus: number | null, // unused (status comes from progress)
    newOrder: number,
    userId: string,
    orderedIds?: string[],
  ) {
    return await prisma.$transaction(async (tx) => {
      const subtask = await tx.subtask.findUnique({
        where: { id: subtaskId },
      });

      if (!subtask) throw new Error("Subtask not found");

      // WBS ordering spans every status within the same task. Kanban callers
      // omit orderedIds and retain the existing status-column behavior below.
      if (orderedIds !== undefined) {
        if (!Array.isArray(orderedIds) || !orderedIds.length ||
            orderedIds.some((id) => typeof id !== "string") ||
            new Set(orderedIds).size !== orderedIds.length ||
            !Number.isInteger(newOrder) || newOrder < 0 ||
            orderedIds[newOrder] !== subtaskId) {
          throw new Error("Invalid subtask order. Refresh and try again.");
        }
        // Serialize WBS moves and child inserts against this parent task.
        await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${subtask.taskId} FOR UPDATE`;
        const siblings = await tx.subtask.findMany({
          where: { taskId: subtask.taskId },
          select: { id: true, order: true },
        });
        const byId = new Map(siblings.map((item) => [item.id, item]));
        if (siblings.length !== orderedIds.length || orderedIds.some((id) => !byId.has(id))) {
          throw new Error("This task's subtasks changed. Refresh and try again.");
        }
        for (const [order, id] of orderedIds.entries()) {
          if (byId.get(id)!.order !== order) {
            await tx.subtask.update({ where: { id }, data: { order } });
          }
        }
        await tx.activityLog.create({
          data: { userId, action: "SUBTASK_REORDERED", entityType: "SUBTASK", entityId: subtaskId },
        });
        return tx.subtask.findUnique({ where: { id: subtaskId } });
      }

      const oldOrder = subtask.order;
      const status = subtask.status;
      const taskId = subtask.taskId;

      // ✅ SAFETY: no movement
      if (newOrder === oldOrder) {
        return subtask;
      }

      // ========================================
      // 🔥 SHIFT WITHIN SAME COLUMN ONLY
      // ========================================
      if (newOrder > oldOrder) {
        // moving DOWN
        await tx.subtask.updateMany({
          where: {
            taskId,
            status, // ✅ CRITICAL FIX
            order: {
              gt: oldOrder,
              lte: newOrder,
            },
          },
          data: {
            order: { decrement: 1 },
          },
        });
      } else {
        // moving UP
        await tx.subtask.updateMany({
          where: {
            taskId,
            status, // ✅ CRITICAL FIX
            order: {
              gte: newOrder,
              lt: oldOrder,
            },
          },
          data: {
            order: { increment: 1 },
          },
        });
      }

      // ========================================
      // UPDATE TARGET ITEM
      // ========================================
      const updated = await tx.subtask.update({
        where: { id: subtaskId },
        data: {
          order: newOrder,
        },
      });

      // ========================================
      // 🔥 SAFETY REINDEX (ANTI-DUPLICATE)
      // ========================================
      const all = await tx.subtask.findMany({
        where: { taskId, status },
        orderBy: { order: "asc" },
      });

      for (let i = 0; i < all.length; i++) {
        if (all[i].order !== i) {
          await tx.subtask.update({
            where: { id: all[i].id },
            data: { order: i },
          });
        }
      }

      // ========================================
      // ACTIVITY LOG
      // ========================================
      await tx.activityLog.create({
        data: {
          userId,
          action: "SUBTASK_REORDERED",
          entityType: "SUBTASK",
          entityId: subtaskId,
        },
      });

      return updated;
    });
  }

  // ========================================
  // MOVE CHECKLIST (DRAG & DROP REORDER)
  // ========================================
  static async moveChecklist(
    checklistId: string,
    newOrder: number,
    userId: string
  ) {
    return await prisma.$transaction(async (tx) => {
      const checklist = await tx.checklist.findUnique({
        where: { id: checklistId },
      });

      if (!checklist) throw new Error("Checklist not found");

      const oldOrder = checklist.order;
      const subtaskId = checklist.subtaskId;

      // ✅ SAFETY: no movement
      if (newOrder === oldOrder) {
        return checklist;
      }

      // ========================================
      // 🔥 SHIFT WITHIN SAME SUBTASK ONLY
      // ========================================
      if (newOrder > oldOrder) {
        // moving DOWN
        await tx.checklist.updateMany({
          where: {
            subtaskId,
            order: {
              gt: oldOrder,
              lte: newOrder,
            },
          },
          data: {
            order: { decrement: 1 },
          },
        });
      } else {
        // moving UP
        await tx.checklist.updateMany({
          where: {
            subtaskId,
            order: {
              gte: newOrder,
              lt: oldOrder,
            },
          },
          data: {
            order: { increment: 1 },
          },
        });
      }

      // ========================================
      // UPDATE TARGET ITEM
      // ========================================
      const updated = await tx.checklist.update({
        where: { id: checklistId },
        data: {
          order: newOrder,
        },
      });

      // ========================================
      // 🔥 SAFETY REINDEX (ANTI-DUPLICATE)
      // ========================================
      const all = await tx.checklist.findMany({
        where: { subtaskId },
        orderBy: { order: "asc" },
      });

      for (let i = 0; i < all.length; i++) {
        if (all[i].order !== i) {
          await tx.checklist.update({
            where: { id: all[i].id },
            data: { order: i },
          });
        }
      }

      return updated;
    });
  }

  // ========================================
  // TOGGLE CHECKLIST
  // ========================================
  static async toggleChecklist(checklistId: string, userId: string) {
    return await prisma.$transaction(async (tx) => {
      const checklist = await tx.checklist.findUnique({
        where: { id: checklistId },
      });

      if (!checklist) throw new Error("Checklist not found");

      const updated = await tx.checklist.update({
        where: { id: checklistId },
        data: {
          isCompleted: !checklist.isCompleted,
        },
      });

      await tx.activityLog.create({
        data: {
          userId,
          action: "CHECKLIST_TOGGLED",
          entityType: "CHECKLIST",
          entityId: checklistId,
        },
      });

      return updated;
    });
  }
}