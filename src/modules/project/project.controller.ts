import { Request, Response } from "express";
import prisma from "../../config/prisma";

import {
  CreateProjectDTO,
  ProjectParamsDTO,
  UpdateProjectDTO
} from "./project.dto";
import { getProjectDashboard } from "./project.dashboard.service";
import { generateProjectTimeline } from "../timeline/timeline.service";



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
      }
    });

    // 🔥 AUTO-ASSIGN CURRENT USER AS OWNER
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId,
        role: "OWNER"
      }
    });

    // 🔥 AUTO-GENERATE TIMELINE if dates are provided
    if (project.startDate && project.expectedEndDate) {
      try {
        await generateProjectTimeline(project.id, "daily");
      } catch (timelineError: any) {
        console.error("Timeline generation warning:", timelineError.message);
        // Don't fail project creation if timeline fails
      }
    }

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

    // 🔥 REGENERATE TIMELINE if dates changed
    if ((startDate || expectedEndDate) && updated.startDate && updated.expectedEndDate) {
      try {
        await generateProjectTimeline(updated.id, "daily");
      } catch (timelineError: any) {
        console.error("Timeline regeneration warning:", timelineError.message);
        // Don't fail project update if timeline fails
      }
    }

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
          
          // --- CHILD TABLES (SUBTASK RELATED) ---
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

          // --- SUBTASK ---
          await prisma.subtask.delete({
            where: { id: subtask.id },
          });
        }

        // --- TASK ASSIGNEES ---
        await prisma.taskAssignee.deleteMany({
          where: { taskId: task.id },
        });

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

    // 🔥 3. DELETE PROJECT-LEVEL DATA
    // Delete project members (important!)
    await prisma.projectMember.deleteMany({
      where: { projectId: id },
    });

    // Delete timeline snapshots
    await prisma.projectTimeline.deleteMany({
      where: { projectId: id },
    });

    // Delete project attachments
    await prisma.attachment.deleteMany({
      where: { projectId: id },
    });

    // Delete daily reports
    await prisma.dailyReport.deleteMany({
      where: { projectId: id },
    });

    // 🔥 4. FINALLY DELETE PROJECT
    await prisma.project.delete({
      where: { id },
    });

    res.json({ 
      success: true,
      message: "Project deleted successfully (full cascade cleanup)" 
    });

  } catch (error: any) {
    console.error("❌ Project delete error:", error);
    res.status(400).json({ message: error.message });
  }
}
}

// 🔥 PROJECT MEMBER MANAGEMENT

export async function assignProjectMember(req: any, res: any) {
  try {
    const { projectId } = req.params;
    const { userId, userIds, role } = req.body;

    // 🔥 normalize input (single OR multiple)
    const ids: string[] = userIds || (userId ? [userId] : []);

    if (!ids.length) {
      return res.status(400).json({
        message: "userId or userIds is required",
      });
    }

    if (!["SUB_OWNER", "MEMBER"].includes(role)) {
      return res.status(400).json({
        message: "Invalid role",
      });
    }

    // check project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found",
      });
    }

    // 🔥 fetch users
    const users = await prisma.user.findMany({
      where: {
        id: { in: ids },
      },
      include: { role: true },
    });

    // 🔥 VALIDATE ROLE RULES
    if (role === "SUB_OWNER") {
      const invalid = users.find(
        (u) => u.role?.name !== "LEADER"
      );

      if (invalid) {
        return res.status(403).json({
          message: `User ${invalid.name} is not LEADER`,
        });
      }
    }

    // 🔥 REMOVE ALREADY ASSIGNED USERS
    const existing = await prisma.projectMember.findMany({
      where: {
        projectId,
        userId: { in: ids },
      },
    });

    const existingIds = new Set(existing.map((e) => e.userId));

    const newIds = ids.filter((id) => !existingIds.has(id));

    if (!newIds.length) {
      return res.status(400).json({
        message: "All users already assigned",
      });
    }

    // 🔥 CREATE MANY (FAST)
    await prisma.projectMember.createMany({
      data: newIds.map((id) => ({
        projectId,
        userId: id,
        role,
      })),
      skipDuplicates: true,
    });

    // 🔥 return created users
    const created = await prisma.projectMember.findMany({
      where: {
        projectId,
        userId: { in: newIds },
      },
      include: {
        user: { include: { role: true } },
      },
    });

    return res.json({
      success: true,
      message: `${created.length} users assigned`,
      data: created,
    });
  } catch (err: any) {
    return res.status(500).json({
      message: err.message,
    });
  }
}

export async function getProjectMembers(req: any, res: any) {
  try {
    const { projectId } = req.params;

    // Check project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found"
      });
    }

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { include: { role: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    // 🔥 GROUP BY ROLE
    const grouped = {
      owner: members.filter((m: any) => m.role === "OWNER"),
      subOwners: members.filter((m: any) => m.role === "SUB_OWNER"),
      members: members.filter((m: any) => m.role === "MEMBER")
    };

    res.json({
      success: true,
      data: grouped,
      total: members.length
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message
    });
  }
}

export async function removeProjectMember(req: any, res: any) {
  try {
    const { projectId } = req.params;
    const { userIds } = req.body; // 🔥 ARRAY

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        message: "userIds must be a non-empty array",
      });
    }

    // 🔥 Get all members first
    const members = await prisma.projectMember.findMany({
      where: {
        projectId,
        userId: { in: userIds },
      },
    });

    if (!members.length) {
      return res.status(404).json({
        message: "No matching members found",
      });
    }

    // ❌ prevent removing OWNER
    const hasOwner = members.some((m) => m.role === "OWNER");

    if (hasOwner) {
      return res.status(403).json({
        message: "Cannot remove project owner",
      });
    }

    // 🔥 DELETE MANY
    await prisma.projectMember.deleteMany({
      where: {
        projectId,
        userId: { in: userIds },
      },
    });

    res.json({
      success: true,
      message: `${members.length} member(s) removed`,
      removedIds: userIds,
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
    });
  }
}

export async function getProjectEngagedUsers(req: any, res: any) {
  try {
    const { projectId } = req.params;

    // Get all users engaged in this project
    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { include: { role: true } }
      }
    });

    const users = members.map((m: any) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.user.role?.name || null,
      projectRole: m.role
    }));

    res.json({
      success: true,
      data: users,
      total: users.length
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message
    });
  }
}