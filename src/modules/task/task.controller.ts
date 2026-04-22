import { Request, Response } from "express";
import prisma from "../../config/prisma";

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
      const { title, description, categoryId, budgetAllocated, budgetPercent } =
        req.body;

      const task = await prisma.task.create({
        data: {
          title,
          description,
          categoryId,
          budgetAllocated,
          budgetPercent,
        },
      });

      await recomputeCategoryProgress(categoryId);

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
          createdAt: "desc",
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

      const { title, description, budgetAllocated, budgetPercent } = req.body;

      const updated = await prisma.task.update({
        where: { id },
        data: {
          title,
          description,
          budgetAllocated,
          budgetPercent,
        },
      });

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // DELETE TASK
  static async delete(req: Request<TaskParamsDTO>, res: Response) {
    try {
      const { id } = req.params;

      const existing = await prisma.task.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({ message: "Task not found" });
      }

      await prisma.task.delete({
        where: { id },
      });

      // 🔥 RECOMPUTE AFTER DELETE
      await recomputeCategoryProgress(existing.categoryId);

      res.json({ message: "Task deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
}
