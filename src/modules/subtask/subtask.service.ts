import prisma from "../../config/prisma";

export class SubtaskService {
  // ========================================
  // MOVE SUBTASK (ORDER ONLY 🔥 FIXED)
  // ========================================
  static async moveSubtask(
    subtaskId: string,
    targetStatus: number | null, // unused (status comes from progress)
    newOrder: number,
    userId: string
  ) {
    return await prisma.$transaction(async (tx) => {
      const subtask = await tx.subtask.findUnique({
        where: { id: subtaskId },
      });

      if (!subtask) throw new Error("Subtask not found");

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