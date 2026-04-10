import prisma from "../../config/prisma";
import { Prisma } from "@prisma/client";

export class SubtaskService {
  // 🔥 CENTRALIZED PROGRESS RECALCULATION
  static async recalculateTaskAndProjectProgress(
    tx: Prisma.TransactionClient,
    taskId: string
  ) {
    // 1. TASK PROGRESS
    const subtasks = await tx.subtask.findMany({
      where: { taskId },
      select: { progress: true },
    });

    const totalSubtasks = subtasks.length;

    const taskProgress =
      totalSubtasks === 0
        ? 0
        : Math.round(
            subtasks.reduce((sum, s) => sum + (s.progress || 0), 0) /
              totalSubtasks
          );

    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: { progress: taskProgress },
    });

    // 2. PROJECT PROGRESS
    const tasks = await tx.task.findMany({
      where: { projectId: updatedTask.projectId },
      select: { progress: true },
    });

    const totalTasks = tasks.length;

    const projectProgress =
      totalTasks === 0
        ? 0
        : Math.round(
            tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / totalTasks
          );

    await tx.project.update({
      where: { id: updatedTask.projectId },
      data: { progress: projectProgress },
    });

    return { taskProgress, projectProgress };
  }

  // MOVE SUBTASK (DRAG & DROP)
  static async moveSubtask(
    subtaskId: string,
    targetStatusId: string,
    newOrder: number,
    userId: string
  ) {
    return await prisma.$transaction(async (tx) => {
      const subtask = await tx.subtask.findUnique({
        where: { id: subtaskId },
      });

      if (!subtask) throw new Error("Subtask not found");

      const oldStatusId = subtask.statusId;
      const oldOrder = subtask.order;

      // SAME COLUMN
      if (oldStatusId === targetStatusId) {
        if (newOrder > oldOrder) {
          await tx.subtask.updateMany({
            where: {
              statusId: oldStatusId,
              order: { gt: oldOrder, lte: newOrder },
            },
            data: { order: { decrement: 1 } },
          });
        } else {
          await tx.subtask.updateMany({
            where: {
              statusId: oldStatusId,
              order: { gte: newOrder, lt: oldOrder },
            },
            data: { order: { increment: 1 } },
          });
        }
      } else {
        // DIFFERENT COLUMN

        // close gap
        await tx.subtask.updateMany({
          where: {
            statusId: oldStatusId,
            order: { gt: oldOrder },
          },
          data: { order: { decrement: 1 } },
        });

        // shift new column
        await tx.subtask.updateMany({
          where: {
            statusId: targetStatusId,
            order: { gte: newOrder },
          },
          data: { order: { increment: 1 } },
        });
      }

      // update moved subtask
      const updated = await tx.subtask.update({
        where: { id: subtaskId },
        data: {
          statusId: targetStatusId,
          order: newOrder,
        },
      });

      // 🔥 RECALCULATE PROGRESS
      await this.recalculateTaskAndProjectProgress(tx, subtask.taskId);

      // activity log
      await tx.activityLog.create({
        data: {
          userId,
          action: "SUBTASK_MOVED",
          entityType: "SUBTASK",
          entityId: subtaskId,
          metadata: {
            fromStatusId: oldStatusId,
            toStatusId: targetStatusId,
            newOrder,
          },
        },
      });

      return updated;
    });
  }

  // TOGGLE CHECKLIST
  static async toggleChecklist(checklistId: string, userId: string) {
    return await prisma.$transaction(async (tx) => {
      const checklist = await tx.checklist.findUnique({
        where: { id: checklistId },
        include: {
          subtask: {
            include: {
              checklists: true,
              task: true,
            },
          },
        },
      });

      if (!checklist) throw new Error("Checklist not found");

      const subtask = checklist.subtask;

      // toggle checklist
      await tx.checklist.update({
        where: { id: checklistId },
        data: {
          isCompleted: !checklist.isCompleted,
        },
      });

      // compute subtask progress
      const all = subtask.checklists.map((c) =>
        c.id === checklistId ? !checklist.isCompleted : c.isCompleted
      );

      const total = all.length;
      const completed = all.filter(Boolean).length;

      const subtaskProgress =
        total === 0
          ? 0
          : Math.round((completed / total) * 100);

      // update subtask
      await tx.subtask.update({
        where: { id: subtask.id },
        data: { progress: subtaskProgress },
      });

      // 🔥 RECALCULATE TASK + PROJECT
      const result = await this.recalculateTaskAndProjectProgress(
        tx,
        subtask.taskId
      );

      return {
        subtaskProgress,
        ...result,
      };
    });
  }
}