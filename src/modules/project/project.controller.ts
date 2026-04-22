import { Request, Response } from "express";
import prisma from "../../config/prisma";

import {
  CreateProjectDTO,
  ProjectParamsDTO,
  UpdateProjectDTO
} from "./project.dto";
import { getProjectDashboard } from "./project.dashboard.service";



export class ProjectController {
    // 🔥 DASHBOARD
static async getDashboard(
  req: Request<ProjectParamsDTO>,
  res: Response
) {
  try {
    const { id } = req.params;

    const data = await getProjectDashboard(id);

    res.json({
      success: true,
      data
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

  // CREATE
  static async create(
  req: Request<{}, {}, CreateProjectDTO>,
  res: Response
) {
  try {
    const {
      name,
      description,
      location,
      managerId,
      startDate,
      expectedEndDate,
      totalBudget,
      priority,
      pin,
      businessUnit,
      entity
    } = req.body;

    const userId = (req as any).user.id;

    const project = await prisma.project.create({
      data: {
        name,
        description,

        // 🔥 FIX (JSON SAFE)
        location: location || undefined,

        managerId,
        ownerId: userId,

        startDate: startDate ? new Date(startDate) : undefined,
        expectedEndDate: expectedEndDate
          ? new Date(expectedEndDate)
          : undefined,

        totalBudget,
        priority,
        pin,

        // 🔥 NEW FIELDS
        businessUnit,
        entity
      },
    });

    res.json(project);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
}

  // GET ALL
  static async getAll(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;

      const projects = await prisma.project.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: "desc" }
      });

      res.json(projects);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET SINGLE (LIGHT)
  static async getById(
    req: Request<ProjectParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          categories: true // 🔥 FIXED
        }
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // 🔥 FULL TREE (VERY IMPORTANT)
  static async getFull(
    req: Request<ProjectParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          categories: {
            include: {
              tasks: {
                include: {
                  subtasks: {
                    include: {
                      progressLogs: true,
                      checklists: true,
                      assignees: {
                        include: { user: true }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // UPDATE (SAFE)
  static async update(
  req: Request<ProjectParamsDTO, {}, UpdateProjectDTO>,
  res: Response
) {
  try {
    const { id } = req.params;

    const {
      name,
      description,
      location,
      managerId,
      startDate,
      expectedEndDate,
      totalBudget,
      priority,
      pin,
      businessUnit,
      entity
    } = req.body;

    const updated = await prisma.project.update({
      where: { id },
      data: {
        name,
        description,

        // 🔥 FIX JSON
        location: location || undefined,

        managerId,

        startDate: startDate ? new Date(startDate) : undefined,
        expectedEndDate: expectedEndDate
          ? new Date(expectedEndDate)
          : undefined,

        totalBudget,
        priority,
        pin,

        // 🔥 NEW
        businessUnit,
        entity
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
}

  // DELETE (FULL CASCADE CLEANUP)
static async delete(
  req: Request<ProjectParamsDTO>,
  res: Response
) {
  try {
    const { id } = req.params;

    // 🔥 1. GET FULL TREE (ids only is enough)
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        categories: {
          include: {
            tasks: {
              include: {
                subtasks: true,
              },
            },
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // 🔥 2. DELETE EVERYTHING BOTTOM → TOP
    for (const category of project.categories) {
      for (const task of category.tasks) {
        for (const subtask of task.subtasks) {
          
          // --- CHILD TABLES ---
          await prisma.progressLog.deleteMany({
            where: { subtaskId: subtask.id },
          });

          await prisma.checklist.deleteMany({
            where: { subtaskId: subtask.id },
          });

          await prisma.subtaskAssignee.deleteMany({
            where: { subtaskId: subtask.id },
          });

          // --- SUBTASK ---
          await prisma.subtask.delete({
            where: { id: subtask.id },
          });
        }

        // --- TASK ---
        await prisma.task.delete({
          where: { id: task.id },
        });
      }

      // --- CATEGORY ---
      await prisma.category.delete({
        where: { id: category.id },
      });
    }

    // 🔥 3. FINALLY DELETE PROJECT
    await prisma.project.delete({
      where: { id },
    });

    res.json({ message: "Project deleted successfully (full cleanup)" });

  } catch (error: any) {
    console.error("❌ Project delete error:", error);
    res.status(400).json({ message: error.message });
  }
}
}