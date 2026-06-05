import { Request, Response } from "express";
import prisma from "../../config/prisma";

import {
  CreateProjectDTO,
  ProjectParamsDTO,
  UpdateProjectDTO
} from "./project.dto";
import { getProjectDashboard } from "./project.dashboard.service";
import { generateProjectTimeline } from "../timeline/timeline.service";
import { approvalService } from "../approval/approval.service";



export class ProjectController {
  private static async enrichBusinessUnitDetails(projects: any[]) {
    const buIds = [
      ...new Set(projects.map((p: any) => p.businessUnit).filter(Boolean)),
    ];

    const businessUnits = buIds.length
      ? await prisma.businessUnit.findMany({
          where: { id: { in: buIds as string[] } },
          select: { id: true, code: true, name: true },
        })
      : [];

    const buMap = Object.fromEntries(businessUnits.map((bu) => [bu.id, bu]));

    return projects.map((p: any) => ({
      ...p,
      businessUnitDetails: p.businessUnit ? buMap[p.businessUnit] ?? null : null,
    }));
  }

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
      entity,
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      saturday,
      sunday,
      includeHolidays
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
        entity,

        monday: monday ?? undefined,
        tuesday: tuesday ?? undefined,
        wednesday: wednesday ?? undefined,
        thursday: thursday ?? undefined,
        friday: friday ?? undefined,
        saturday: saturday ?? undefined,
        sunday: sunday ?? undefined,
        includeHolidays: includeHolidays ?? undefined
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
      const userRoleId = (req as any).user.roleId;

      // Check if user is SUPER_ADMIN
      const userRole = await (prisma as any).role.findUnique({
        where: { id: userRoleId }
      });

      let projects;

      if (userRole?.name === "SUPERADMIN") {
        // SUPER_ADMIN sees all projects
        projects = await prisma.project.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            projectMembers: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        });
      } else {
        // Regular users see: projects they own + projects they're members of
        projects = await prisma.project.findMany({
          where: {
            OR: [
              { ownerId: userId }, // User is owner
              {
                projectMembers: {
                  some: {
                    userId: userId // User is member (SUB_OWNER or MEMBER)
                  }
                }
              }
            ]
          },
          orderBy: { createdAt: "desc" },
          include: {
            projectMembers: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        });
      }

      const enriched = await ProjectController.enrichBusinessUnitDetails(projects);

      res.json(enriched);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  static async getMyApprovals(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const projects = await approvalService.getPendingProjectsForApproval(userId);
      const enriched = await ProjectController.enrichBusinessUnitDetails(projects);
      res.json(enriched);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  static async getMyRequests(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const projects = await prisma.project.findMany({
        where: { ownerId: userId, status: { not: "DRAFT" } },
        orderBy: { createdAt: "desc" },
        include: {
          projectMembers: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      });
      const enriched = await ProjectController.enrichBusinessUnitDetails(projects);
      res.json(enriched);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  static async getMyDrafts(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const projects = await prisma.project.findMany({
        where: { ownerId: userId, status: "DRAFT" },
        orderBy: { createdAt: "desc" },
        include: {
          projectMembers: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      });
      const enriched = await ProjectController.enrichBusinessUnitDetails(projects);
      res.json(enriched);
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
          scopes: {
            orderBy: { order: "asc" }
          },
          projectMembers: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true
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
          scopes: {
            orderBy: { order: "asc" },
            include: {
              tasks: {
                orderBy: { order: "asc" },
                include: {
                  subtasks: {
                    orderBy: { order: "asc" },
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

  // GET FULL PROJECT FOR APPROVAL VIEW
  static async getFullForApproval(
    req: Request<ProjectParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          scopes: {
            orderBy: { order: "asc" },
            include: {
              tasks: {
                orderBy: { order: "asc" },
                include: {
                  subtasks: {
                    orderBy: { order: "asc" },
                    include: {
                      progressLogs: true,
                      checklists: true,
                      assignees: {
                        include: { user: { select: { id: true, name: true, email: true } } }
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
        return res.status(404).json({ error: "Project not found" });
      }

      // Check if user has access: either owner or approver
      const isOwner = project.ownerId === userId;
      
      if (!isOwner) {
        // Check if user is an approver in this project's approval chain
        const isApprover = await prisma.projectApproval.findFirst({
          where: {
            projectId: id,
            approverId: userId
          }
        });

        if (!isApprover) {
          return res.status(403).json({
            error: "Access denied - you are not an approver for this project"
          });
        }
      }

      res.json({
        success: true,
        data: project
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
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
      entity,
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      saturday,
      sunday,
      includeHolidays
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
        entity,

        monday: monday ?? undefined,
        tuesday: tuesday ?? undefined,
        wednesday: wednesday ?? undefined,
        thursday: thursday ?? undefined,
        friday: friday ?? undefined,
        saturday: saturday ?? undefined,
        sunday: sunday ?? undefined,
        includeHolidays: includeHolidays ?? undefined
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
        scopes: {
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
    for (const scope of project.scopes) {
      for (const task of scope.tasks) {
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

      // --- scope ---
      await prisma.scope.delete({
        where: { id: scope.id },
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

// UPDATE PROJECT MEMBER ROLE (PATCH endpoint)
export async function updateProjectMemberRole(req: any, res: any) {
  try {
    const { projectId, userId } = req.params;
    const { newRole } = req.body;
    const requesterId = (req as any).user.id;

    // VALIDATION: newRole must be valid
    if (!newRole || !["SUB_OWNER", "MEMBER"].includes(newRole)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_ROLE",
          message: "Invalid role. Must be 'SUB_OWNER' or 'MEMBER'"
        }
      });
    }

    // CHECK: Project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: {
          code: "PROJECT_NOT_FOUND",
          message: "Project not found"
        }
      });
    }

    // PERMISSION: Only project owner can modify member roles
    const requesterMember = await prisma.projectMember.findFirst({
      where: {
        projectId,
        userId: requesterId
      }
    });

    if (!requesterMember || requesterMember.role !== "OWNER") {
      return res.status(403).json({
        success: false,
        error: {
          code: "INSUFFICIENT_PERMISSIONS",
          message: "Only project owner can modify member roles"
        }
      });
    }

    // CHECK: Member exists in project
    const member = await prisma.projectMember.findFirst({
      where: {
        projectId,
        userId
      },
      include: {
        user: { include: { role: true } }
      }
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        error: {
          code: "MEMBER_NOT_FOUND",
          message: "User is not a member of this project"
        }
      });
    }

    // PREVENT: Cannot change OWNER role
    if (member.role === "OWNER") {
      return res.status(409).json({
        success: false,
        error: {
          code: "CANNOT_MODIFY_OWNER",
          message: "Cannot change role of project owner"
        }
      });
    }

    // UPDATE: Member role (real-time draft auto-save)
    const updated = await prisma.projectMember.update({
      where: { id: member.id },
      data: {
        role: newRole
      },
      include: {
        user: { include: { role: true } }
      }
    });

    // 🔥 FORMAT RESPONSE
    return res.status(200).json({
      success: true,
      message: `Member role updated successfully to ${newRole}`,
      data: {
        projectMemberId: updated.id,
        projectId: updated.projectId,
        userId: updated.userId,
        projectRole: updated.role,
        user: {
          id: updated.user.id,
          name: updated.user.name,
          email: updated.user.email,
          role: {
            id: updated.user.role?.id,
            name: updated.user.role?.name
          }
        },
        updatedAt: updated.createdAt // Using createdAt as we don't have updatedAt in schema yet
      }
    });

  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: err.message || "Failed to update member role"
      }
    });
  }
}
