import { Request, Response } from "express";
import prisma from "../../config/prisma";

import {
  CreateTaskDTO,
  TaskParamsDTO,
  UpdateTaskDTO,
  GetTasksByProjectParamsDTO
} from "./task.dto";

export class TaskController {

  // CREATE TASK
  static async create(
    req: Request<{}, {}, CreateTaskDTO>,
    res: Response
  ) {
    try {
      const { title, description, projectId } = req.body;

      const task = await prisma.task.create({
        data: {
          title,
          description,
          projectId
        }
      });

      // OPTIONAL: auto-create default statuses
      await prisma.status.createMany({
        data: [
          { name: "Pending", order: 0, progressValue: 0, taskId: task.id },
          { name: "Ongoing", order: 1, progressValue: 50, taskId: task.id },
          { name: "Done", order: 2, progressValue: 100, taskId: task.id }
        ]
      });

      res.json(task);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET TASKS BY PROJECT
  static async getByProject(
    req: Request<GetTasksByProjectParamsDTO>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;

      const tasks = await prisma.task.findMany({
        where: { projectId },
        include: {
          statuses: true
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      res.json(tasks);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET SINGLE TASK
  static async getById(
    req: Request<TaskParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const task = await prisma.task.findUnique({
        where: { id },
        include: {
          statuses: true,
          subtasks: {
            include: {
              status: true,
              assignees: {
                include: { user: true }
              },
              checklists: true
            },
            orderBy: [
              { statusId: "asc" },
              { order: "asc" }
            ]
          }
        }
      });

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json(task);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // UPDATE TASK
  static async update(
    req: Request<TaskParamsDTO, {}, UpdateTaskDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;
      const data = req.body;

      const updated = await prisma.task.update({
        where: { id },
        data
      });

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // DELETE TASK
  static async delete(
    req: Request<TaskParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      await prisma.task.delete({
        where: { id }
      });

      res.json({ message: "Task deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
}