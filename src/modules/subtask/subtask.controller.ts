import { Request, Response } from "express";
import prisma from "../../config/prisma";
import { SubtaskService } from "./subtask.service";
import { generateProjectTimeline } from "../timeline/timeline.service";

import {
  CreateSubtaskDTO,
  GetSubtasksParamsDTO,
  UpdateSubtaskDTO,
  UpdateSubtaskParamsDTO,
  DeleteSubtaskParamsDTO,
  ToggleChecklistParamsDTO,
  DeleteChecklistItemParamsDTO,
  EditChecklistParamsDTO,
  EditChecklistDTO,
  GetSubtaskByIdParamsDTO,
} from "./subtask.dto";

async function recomputeTask(taskId: string) {
  const subtasks = await prisma.subtask.findMany({
    where: { taskId },
  });

  if (subtasks.length === 0) {
    await prisma.task.update({
      where: { id: taskId },
      data: { progress: 0 },
    });
    return;
  }

  let total = 0;

  for (const s of subtasks) {
    total += s.progress || 0;
  }

  const progress = total / subtasks.length;

  await prisma.task.update({
    where: { id: taskId },
    data: { progress },
  });
}
export class SubtaskController {
  // ========================================
  // CREATE
  // ========================================
  static async create(req: Request<{}, {}, CreateSubtaskDTO>, res: Response) {
    try {
      const {
        taskId,
        title,
        description,
        priority,
        projectedStartDate,
        projectedEndDate,
        budgetAllocated,
        budgetPercent,
        remarks,
        userIds, 
      } = req.body as any;

      const userId = (req as any).user.id;

      const subtask = await prisma.subtask.create({
        data: {
          title,
          description,
          priority,
          remarks,

          projectedStartDate: projectedStartDate
            ? new Date(projectedStartDate)
            : undefined,

          projectedEndDate: projectedEndDate
            ? new Date(projectedEndDate)
            : undefined,

          budgetAllocated,
          budgetPercent,

          order: 0, // ✅ UNCHANGED
          status: 0, // ✅ UNCHANGED

          task: { connect: { id: taskId } },
          creator: { connect: { id: userId } },
        },
      });

      // 🔥 ASSIGN USERS (ONLY ADDITION)
      if (userIds && userIds.length > 0) {
        // Get project ID via task -> scope -> project
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: { scope: true }
        });

        if (!task) {
          return res.status(404).json({
            message: "Task not found"
          });
        }

        const scope = await prisma.scope.findUnique({
          where: { id: task.scopeId }
        });

        if (!scope) {
          return res.status(404).json({
            message: "scope not found"
          });
        }

        // 🔥 VALIDATE: users must be engaged in project
        const validMembers = await prisma.projectMember.findMany({
          where: {
            projectId: scope.projectId,
            userId: { in: userIds },
          },
        });

        if (validMembers.length !== userIds.length) {
          return res.status(403).json({
            message: "Invalid assignment: some users are not engaged in this project",
          });
        }

        await prisma.subtaskAssignee.createMany({
          data: userIds.map((uid: string) => ({
            subtaskId: subtask.id,
            userId: uid,
          })),
          skipDuplicates: true,
        });
      }

      await recomputeTask(taskId);

      // Regenerate s-curve after creating subtask
      try {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: { scope: true }
        });
        if (task?.scope?.projectId) {
          await generateProjectTimeline(task.scope.projectId, "daily");
        }
      } catch (timelineError) {
        console.warn("⚠️ Timeline regeneration failed:", timelineError);
      }

      res.json(subtask);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
  // ========================================
  // GET (KANBAN)
  // ========================================
  static async getByTask(req: Request<GetSubtasksParamsDTO>, res: Response) {
    try {
      const { taskId } = req.params;

      const subtasks = await prisma.subtask.findMany({
        where: { taskId },
        include: {
          assignees: { include: { user: true } },
          checklists: true,
          progressLogs: true,
        },
        orderBy: [
          { status: "asc" }, 
          { order: "asc" },
        ],
      });

      res.json(subtasks);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // UPDATE
  // ========================================
 static async update(
    req: Request<UpdateSubtaskParamsDTO, {}, UpdateSubtaskDTO>,
    res: Response,
  ) {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;

      const {
        title,
        description,
        priority,
        projectedStartDate,
        projectedEndDate,
        budgetAllocated,
        budgetPercent,
        remarks,
        userIds,
      } = req.body;

      // 🔥 UPDATE SUBTASK FIELDS
      const updated = await prisma.subtask.update({
        where: { id },
        data: {
          title,
          description,
          priority,
          remarks,

          projectedStartDate: projectedStartDate
            ? new Date(projectedStartDate)
            : undefined,

          projectedEndDate: projectedEndDate
            ? new Date(projectedEndDate)
            : undefined,

          budgetAllocated,
          budgetPercent,
        },
      });

      // 🔥 UPDATE ASSIGNEES (if provided)
      if (userIds !== undefined) {
        // Get subtask with task and scope info for project validation
        const subtask = await prisma.subtask.findUnique({
          where: { id },
          include: {
            task: { include: { scope: true } }
          }
        });

        if (!subtask) {
          return res.status(404).json({ message: "Subtask not found" });
        }

        if (userIds.length > 0) {
          // 🔒 VALIDATE: users must be engaged in project
          const validMembers = await prisma.projectMember.findMany({
            where: {
              projectId: subtask.task.scope.projectId,
              userId: { in: userIds },
            },
          });

          if (validMembers.length !== userIds.length) {
            return res.status(403).json({
              message: "Invalid assignment: some users are not engaged in this project",
            });
          }

          // Delete old assignees and create new ones
          await prisma.subtaskAssignee.deleteMany({
            where: { subtaskId: id }
          });

          await prisma.subtaskAssignee.createMany({
            data: userIds.map((uid: string) => ({
              subtaskId: id,
              userId: uid,
            })),
            skipDuplicates: true,
          });
        } else {
          // Remove all assignees if empty array
          await prisma.subtaskAssignee.deleteMany({
            where: { subtaskId: id }
          });
        }

        // 🔥 OPTIONAL: Activity Log
        if (userId) {
          await prisma.activityLog.create({
            data: {
              userId,
              action: "UPDATE_SUBTASK",
              entityType: "SUBTASK",
              entityId: id,
              metadata: {
                assignedUserIds: userIds,
              },
            },
          });
        }
      }

      // Recompute task progress and regenerate s-curve
      const subtask = await prisma.subtask.findUnique({
        where: { id },
        include: { task: { include: { scope: true } } }
      });

      if (subtask) {
        await recomputeTask(subtask.taskId);

        // Regenerate s-curve after updating subtask
        try {
          if (subtask.task?.scope?.projectId) {
            await generateProjectTimeline(subtask.task.scope.projectId, "daily");
          }
        } catch (timelineError) {
          console.warn("⚠️ Timeline regeneration failed:", timelineError);
        }
      }

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // DELETE (FULL CASCADE CLEANUP + S-CURVE)
  // ========================================
  static async delete(req: Request<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;

      // 🔥 1. GET SUBTASK WITH FULL CONTEXT
      const subtask = await prisma.subtask.findUnique({
        where: { id },
        include: {
          task: {
            include: {
              scope: {
                select: { projectId: true },
              },
            },
          },
        },
      });

      if (!subtask) {
        return res.status(404).json({ message: "Subtask not found" });
      }

      const taskId = subtask.taskId;
      const projectId = subtask.task.scope.projectId;

      // 🔥 2. DELETE ALL SUBTASK CHILDREN (BOTTOM-UP)
      await prisma.progressLog.deleteMany({
        where: { subtaskId: id },
      });

      await prisma.checklist.deleteMany({
        where: { subtaskId: id },
      });

      await prisma.subtaskAssignee.deleteMany({
        where: { subtaskId: id },
      });

      await prisma.comment.deleteMany({
        where: { subtaskId: id },
      });

      await prisma.attachment.deleteMany({
        where: { subtaskId: id },
      });

      await prisma.activityLog.deleteMany({
        where: { subtaskId: id },
      });

      // 🔥 3. DELETE SUBTASK
      await prisma.subtask.delete({
        where: { id },
      });

      // 🔥 4. RECOMPUTE TASK PROGRESS
      await recomputeTask(taskId);

      // 🔥 5. REGENERATE S-CURVE
      try {
        await generateProjectTimeline(projectId, "daily");
      } catch (timelineError) {
        console.warn("⚠️ Timeline regeneration failed:", timelineError);
        // Don't fail the delete operation
      }

      res.json({
        success: true,
        message: "Subtask deleted successfully (full cascade + s-curve updated)",
      });
    } catch (error: any) {
      console.error("❌ Subtask delete error:", error);
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // MOVE (OPTIONAL NOW)
  // ========================================
  static async move(req: Request, res: Response) {
    try {
      const subtaskId = Array.isArray(req.params.subtaskId)
        ? req.params.subtaskId[0]
        : req.params.subtaskId;

      const { newOrder } = req.body;
      const userId = (req as any).user.id;

      // 🔥 statusId removed — only reorder now
      const result = await SubtaskService.moveSubtask(
        subtaskId,
        null,
        newOrder,
        userId,
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // MOVE CHECKLIST (DRAG & DROP)
  // ========================================
  static async moveChecklist(req: Request, res: Response) {
    try {
      const checklistId = Array.isArray(req.params.checklistId)
        ? req.params.checklistId[0]
        : req.params.checklistId;

      const { newOrder } = req.body;
      const userId = (req as any).user.id;

      const result = await SubtaskService.moveChecklist(
        checklistId,
        newOrder,
        userId,
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // TOGGLE CHECKLIST
  // ========================================
  static async toggleChecklist(
    req: Request<ToggleChecklistParamsDTO>,
    res: Response,
  ) {
    try {
      const { checklistId } = req.params;
      const userId = (req as any).user.id;

      const result = await SubtaskService.toggleChecklist(checklistId, userId);

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // ADD CHECKLIST
  // ========================================
  static async addChecklist(req: Request, res: Response) {
    try {
      const { subtaskId, title } = req.body;

      const last = await prisma.checklist.findFirst({
        where: { subtaskId },
        orderBy: { order: "desc" },
      });

      const checklist = await prisma.checklist.create({
        data: {
          title,
          subtaskId,
          order: (last?.order || 0) + 1,
        },
      });

      res.json(checklist);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // EDIT CHECKLIST
  // ========================================
  static async editChecklist(
    req: Request<DeleteChecklistItemParamsDTO, {}, EditChecklistDTO>,
    res: Response,
  ) {
    try {
      const { checklistId } = req.params;
      const { title, isCompleted, order } = req.body;

      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (isCompleted !== undefined) updateData.isCompleted = isCompleted;
      if (order !== undefined) updateData.order = order;

      const checklist = await prisma.checklist.update({
        where: { id: checklistId },
        data: updateData,
      });

      res.json(checklist);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // DELETE CHECKLIST
  // ========================================
  static async deleteChecklist(
    req: Request<DeleteChecklistItemParamsDTO>,
    res: Response,
  ) {
    try {
      const { checklistId } = req.params;

      const existing = await prisma.checklist.findUnique({
        where: { id: checklistId },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Checklist not found",
        });
      }

      await prisma.checklist.delete({
        where: { id: checklistId },
      });

      res.json({
        success: true,
        message: "Checklist deleted",
      });
    } catch (error: any) {
      if (error?.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "Checklist not found",
        });
      }

      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // ========================================
  // GET BY ID
  // ========================================
  static async getById(req: Request<GetSubtaskByIdParamsDTO>, res: Response) {
    try {
      const { id } = req.params;

      const subtask = await prisma.subtask.findUnique({
        where: { id },
        include: {
          progressLogs: true,
          checklists: true,
          assignees: { include: { user: true } },
        },
      });

      if (!subtask) {
        return res.status(404).json({ message: "Subtask not found" });
      }

      res.json(subtask);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
}

// 🔥 TASK BOARD - Get my assigned subtasks with filters
export async function getMyTaskBoard(req: any, res: any) {
  try {
    const userId = req.user.id;
    const { projectId, scopeId, taskId, search } = req.query;

    const page = Math.max(1, Number(req.query.page || 1));
    const requestedLimit = Number(req.query.limit || 20);
    const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 20));
    const skip = (page - 1) * limit;

    // Build filter conditions
    const whereConditions: any = {
      deletedAt: null,
      assignees: {
        some: { userId }
      },
      task: {
        deletedAt: null,
        scope: {
          deletedAt: null,
          project: {
            isActive: true,
            status: "ACTIVE"
          }
        }
      }
    };

    // Build task filter conditions (nested properly)
    const taskFilter: any = {
      deletedAt: null,
      scope: {
        deletedAt: null,
        project: {
          isActive: true,
          status: "ACTIVE"
        }
      }
    };

    if (projectId) {
      taskFilter.scope.projectId = projectId;
    }

    if (scopeId) {
      taskFilter.scopeId = scopeId;
    }

    // Apply task filter only if needed
    if (Object.keys(taskFilter).length > 0) {
      whereConditions.task = taskFilter;
    }

    if (taskId) {
      whereConditions.taskId = taskId;
    }

    // Optional: search filter (if backend supports it)
    if (search) {
      whereConditions.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [subtasks, total] = await prisma.$transaction([
      prisma.subtask.findMany({
        where: whereConditions,
        select: {
          id: true,
          title: true,
          progress: true,
          createdAt: true,
          projectedStartDate: true,
          projectedEndDate: true,
          actualStartDate: true,
          actualEndDate: true,
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          task: {
            select: {
              id: true,
              title: true,
              scope: {
                select: {
                  id: true,
                  name: true,
                  project: {
                    select: {
                      id: true,
                      name: true,
                    }
                  }
                }
              }
            }
          },
          assignees: {
            select: {
              userId: true,
              user: {
                select: {
                  id: true,
                  name: true,
                }
              }
            }
          },
          checklists: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              isCompleted: true,
              order: true,
            },
          },
        },
        orderBy: [
          { task: { scope: { projectId: 'asc' } } },
          { task: { scopeId: 'asc' } },
          { taskId: 'asc' },
          { createdAt: 'asc' }
        ],
        skip,
        take: limit,
      }),
      prisma.subtask.count({ where: whereConditions }),
    ]);

    const enrichedSubtasks = subtasks.map((subtask: any) => {
      const project = subtask.task?.scope?.project || null;
      const scope = subtask.task?.scope || null;
      const task = subtask.task || null;
      const assigneeNames = (subtask.assignees || [])
        .map((a: any) => a.user?.name)
        .filter(Boolean);

      return {
        id: subtask.id,
        projectId: project?.id || null,
        projectName: project?.name || null,
        scopeId: scope?.id || null,
        scopeName: scope?.name || null,
        taskId: task?.id || null,
        taskName: task?.title || null,
        subtaskName: subtask.title,
        startDate: subtask.projectedStartDate || subtask.actualStartDate || null,
        endDate: subtask.projectedEndDate || subtask.actualEndDate || null,
        assignorName: subtask.creator?.name || null,
        assigneeNames,
        progress: subtask.progress,
        checklist: subtask.checklists || [],
        checklistCount: Array.isArray(subtask.checklists) ? subtask.checklists.length : 0,
        createdAt: subtask.createdAt,
      };
    });

    res.json({
      success: true,
      data: enrichedSubtasks,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message
    });
  }
}

// 🔥 TASK BOARD ITEM - Full detail for a single assigned subtask
export async function getMyBoardItem(req: any, res: any) {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;

    const subtask = await prisma.subtask.findFirst({
      where: {
        id: itemId,
        deletedAt: null,
        assignees: {
          some: { userId },
        },
        task: {
          deletedAt: null,
          scope: {
            deletedAt: null,
            project: {
              isActive: true,
              status: "ACTIVE",
            },
          },
        },
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        task: {
          include: {
            scope: {
              include: {
                project: {
                  select: {
                    id: true,
                    name: true,
                    description: true,
                    status: true,
                    isActive: true,
                    progress: true,
                    expectedEndDate: true,
                    actualEndDate: true,
                  },
                },
              },
            },
          },
        },
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        checklists: {
          orderBy: { order: "asc" },
        },
        comments: {
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        progressLogs: {
          orderBy: { date: "desc" },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            fileUrl: true,
            mimeType: true,
            size: true,
            createdAt: true,
            uploadedBy: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!subtask) {
      return res.status(404).json({
        success: false,
        data: null,
        message: "Board item not found",
      });
    }

    res.json({
      success: true,
      data: subtask,
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
    });
  }
}
