import { Request, Response } from "express";
import { Prisma, ProjectStatus } from "@prisma/client";
import prisma from "../../config/prisma";

import {
  CreateProjectDTO,
  ProjectParamsDTO,
  UpdateProjectDTO,
} from "./project.dto";
import { generateProjectTimeline } from "../timeline/timeline.service";
import { approvalService } from "../approval/approval.service";
import {
  fetchSharePointFile,
  uploadBufferToSharePoint,
} from "../../services/sharepoint-upload.service";
import { buildAccessibleProjectWhere } from "./project-access";

export class ProjectController {
  private static readonly DIRECTORY_LIMITS = new Set([6, 12, 24, 48]);
  private static readonly DIRECTORY_SORT_FIELDS = new Set([
    "name",
    "createdAt",
    "startDate",
    "expectedEndDate",
  ]);

  private static readonly LIST_SORTABLE_FIELDS = new Set([
    "createdAt",
    "updatedAt",
    "name",
    "status",
    "startDate",
    "expectedEndDate",
    "priority",
  ]);

  /**
   * Mark a fully-progressed active project as completed.
   * Email delivery is handled by the frontend's separate API; this response
   * includes the deduplicated recipients it needs.
   */
  static async complete(req: Request<{ id: string }>, res: Response) {
    try {
      const projectId = String(req.params.id || "");
      const completedById = (req as any).user?.id;
      const { actualEndDate, remarks } = req.body || {};

      if (!completedById) {
        return res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication is required",
          },
        });
      }

      const completionDate = actualEndDate
        ? new Date(actualEndDate)
        : new Date();
      if (Number.isNaN(completionDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_COMPLETION_DATE",
            message: "A valid completion date is required",
          },
        });
      }

      if (completionDate.getTime() > Date.now()) {
        return res.status(400).json({
          success: false,
          error: {
            code: "FUTURE_COMPLETION_DATE",
            message: "Completion date cannot be in the future",
          },
        });
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          projectMembers: {
            include: {
              user: {
                select: { id: true, name: true, email: true, isActive: true },
              },
            },
          },
          approvals: {
            where: { status: "PENDING" },
            include: {
              approver: {
                select: { id: true, name: true, email: true, isActive: true },
              },
            },
          },
        },
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
        });
      }

      if (project.status === "COMPLETED") {
        return res.status(409).json({
          success: false,
          error: {
            code: "ALREADY_COMPLETED",
            message: "Project is already completed",
          },
        });
      }

      if (project.status !== "ACTIVE") {
        return res.status(409).json({
          success: false,
          error: {
            code: "INVALID_PROJECT_STATUS",
            message: "Only an active project can be tagged as completed",
          },
        });
      }

      if (Number(project.progress) < 100) {
        return res.status(409).json({
          success: false,
          error: {
            code: "PROJECT_NOT_FULLY_PROGRESSED",
            message: `Project progress must reach 100% before completion (current: ${project.progress}%)`,
          },
        });
      }

      const projectBusinessUnit = String(project.businessUnit || "").trim();
      const [businessUnit, opUsers, completedBy] = await Promise.all([
        projectBusinessUnit
          ? prisma.businessUnit.findFirst({
              where: {
                isActive: true,
                OR: [
                  { id: projectBusinessUnit },
                  {
                    code: { equals: projectBusinessUnit, mode: "insensitive" },
                  },
                  {
                    name: { equals: projectBusinessUnit, mode: "insensitive" },
                  },
                ],
              },
              select: {
                buHeadUser: {
                  select: { id: true, name: true, email: true, isActive: true },
                },
              },
            })
          : null,
        prisma.user.findMany({
          where: { isActive: true, role: { name: "OP" } },
          select: { id: true, name: true, email: true },
        }),
        prisma.user.findUnique({
          where: { id: completedById },
          select: { id: true, name: true, email: true },
        }),
      ]);

      const updatedProject = await prisma.$transaction(async (tx) => {
        const updated = await tx.project.update({
          where: { id: projectId },
          data: {
            status: "COMPLETED",
            actualEndDate: completionDate,
            isActive: false,
            isLocked: true,
          },
        });

        await tx.activityLog.create({
          data: {
            action: "PROJECT_COMPLETED",
            entityType: "PROJECT",
            entityId: projectId,
            userId: completedById,
            metadata: {
              previousStatus: project.status,
              newStatus: "COMPLETED",
              actualEndDate: completionDate.toISOString(),
              remarks:
                typeof remarks === "string" ? remarks.trim() || null : null,
            },
          },
        });

        return updated;
      });

      const recipientsById = new Map<
        string,
        { id: string; name: string; email: string }
      >();
      const addRecipient = (user: any) => {
        if (user?.id && user?.email && user?.isActive !== false) {
          recipientsById.set(user.id, {
            id: user.id,
            name: user.name,
            email: user.email,
          });
        }
      };

      addRecipient(project.owner);
      project.projectMembers.forEach((member) => addRecipient(member.user));
      project.approvals.forEach((approval) => addRecipient(approval.approver));
      addRecipient(businessUnit?.buHeadUser);
      opUsers.forEach(addRecipient);

      return res.status(200).json({
        success: true,
        message: "Project tagged as completed successfully",
        data: {
          project: updatedProject,
          completion: {
            completedBy,
            completedAt: updatedProject.updatedAt,
            actualEndDate: updatedProject.actualEndDate,
            remarks:
              typeof remarks === "string" ? remarks.trim() || null : null,
          },
          notificationRecipients: Array.from(recipientsById.values()),
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: {
          code: "COMPLETE_PROJECT_ERROR",
          message: error.message || "Failed to complete project",
        },
      });
    }
  }

  /**
   * Temporarily cancel a project request. The project content is retained and
   * can later be resumed to DRAFT by its owner.
   */
  static async cancel(req: Request<{ id: string }>, res: Response) {
    try {
      const projectId = String(req.params.id || "");
      const cancelledById = (req as any).user?.id;
      const reason =
        typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

      if (!cancelledById) {
        return res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication is required",
          },
        });
      }

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: {
            code: "CANCELLATION_REASON_REQUIRED",
            message: "Cancellation reason is required",
          },
        });
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          projectMembers: {
            include: {
              user: {
                select: { id: true, name: true, email: true, isActive: true },
              },
            },
          },
          approvals: {
            where: { status: "PENDING" },
            include: {
              approver: {
                select: { id: true, name: true, email: true, isActive: true },
              },
            },
          },
        },
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
        });
      }

      if (project.ownerId !== cancelledById) {
        return res.status(403).json({
          success: false,
          error: {
            code: "ONLY_OWNER_CAN_CANCEL",
            message: "Only the project owner can cancel this request",
          },
        });
      }

      const cancellableStatuses: ProjectStatus[] = [
        "DRAFT",
        "FOR_REVIEW",
        "FOR_APPROVAL",
        "NEEDS_REVISION",
        "REJECTED",
      ];

      if (!cancellableStatuses.includes(project.status)) {
        return res.status(409).json({
          success: false,
          error: {
            code: "PROJECT_NOT_CANCELLABLE",
            message: `A project with status ${project.status} cannot be cancelled`,
          },
        });
      }

      const cancelledAt = new Date();
      const updatedProject = await prisma.$transaction(async (tx) => {
        await tx.projectApproval.updateMany({
          where: { projectId, status: "PENDING" },
          data: {
            status: "CANCELLED",
            actedAt: cancelledAt,
            remarks: `Cancelled by project owner: ${reason}`,
          },
        });

        const updated = await tx.project.update({
          where: { id: projectId },
          data: {
            status: "CANCELLED",
            isActive: false,
            isLocked: true,
            cancelledAt,
            cancelledById,
            cancellationReason: reason,
          },
        });

        await tx.activityLog.create({
          data: {
            action: "PROJECT_CANCELLED",
            entityType: "PROJECT",
            entityId: projectId,
            userId: cancelledById,
            metadata: {
              previousStatus: project.status,
              newStatus: "CANCELLED",
              reason,
              cancelledAt: cancelledAt.toISOString(),
            },
          },
        });

        return updated;
      });

      const recipients = new Map<
        string,
        { id: string; name: string; email: string }
      >();
      const addRecipient = (user: any) => {
        if (user?.id && user?.email && user?.isActive !== false) {
          recipients.set(user.id, {
            id: user.id,
            name: user.name,
            email: user.email,
          });
        }
      };
      addRecipient(project.owner);
      project.projectMembers.forEach((member) => addRecipient(member.user));
      project.approvals.forEach((approval) => addRecipient(approval.approver));

      return res.status(200).json({
        success: true,
        message: "Project request cancelled successfully",
        data: {
          project: updatedProject,
          cancellation: { cancelledAt, cancelledById, reason },
          notificationRecipients: Array.from(recipients.values()),
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: {
          code: "CANCEL_PROJECT_ERROR",
          message: error.message || "Failed to cancel project request",
        },
      });
    }
  }

  /**
   * Resume a cancelled project request as an editable draft. Old approval
   * records are cleared so resubmission uses the current approval flow.
   */
  static async resume(req: Request<{ id: string }>, res: Response) {
    try {
      const projectId = String(req.params.id || "");
      const resumedById = (req as any).user?.id;
      const reason =
        typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

      if (!resumedById) {
        return res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication is required",
          },
        });
      }

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: {
            code: "RESUME_REASON_REQUIRED",
            message: "Resume reason is required",
          },
        });
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          projectMembers: {
            include: {
              user: {
                select: { id: true, name: true, email: true, isActive: true },
              },
            },
          },
        },
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
        });
      }

      if (project.ownerId !== resumedById) {
        return res.status(403).json({
          success: false,
          error: {
            code: "ONLY_OWNER_CAN_RESUME",
            message: "Only the project owner can resume this request",
          },
        });
      }

      if (project.status !== "CANCELLED") {
        return res.status(409).json({
          success: false,
          error: {
            code: "PROJECT_NOT_CANCELLED",
            message: "Only a cancelled project request can be resumed",
          },
        });
      }

      const resumedAt = new Date();
      const updatedProject = await prisma.$transaction(async (tx) => {
        await tx.projectApproval.deleteMany({ where: { projectId } });

        const updated = await tx.project.update({
          where: { id: projectId },
          data: {
            status: "DRAFT",
            isActive: false,
            isLocked: false,
            cancelledAt: null,
            cancelledById: null,
            cancellationReason: null,
          },
        });

        await tx.activityLog.create({
          data: {
            action: "PROJECT_RESUMED",
            entityType: "PROJECT",
            entityId: projectId,
            userId: resumedById,
            metadata: {
              previousStatus: "CANCELLED",
              newStatus: "DRAFT",
              previousCancellationReason: project.cancellationReason,
              reason,
              resumedAt: resumedAt.toISOString(),
            },
          },
        });

        return updated;
      });

      const recipients = new Map<
        string,
        { id: string; name: string; email: string }
      >();
      const addRecipient = (user: any) => {
        if (user?.id && user?.email && user?.isActive !== false) {
          recipients.set(user.id, {
            id: user.id,
            name: user.name,
            email: user.email,
          });
        }
      };
      addRecipient(project.owner);
      project.projectMembers.forEach((member) => addRecipient(member.user));

      return res.status(200).json({
        success: true,
        message: "Project request resumed as draft",
        data: {
          project: updatedProject,
          resume: { resumedAt, resumedById, reason },
          notificationRecipients: Array.from(recipients.values()),
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: {
          code: "RESUME_PROJECT_ERROR",
          message: error.message || "Failed to resume project request",
        },
      });
    }
  }

  private static parseListQuery(req: Request) {
    const pageRaw = Array.isArray(req.query.page)
      ? req.query.page[0]
      : req.query.page;
    const limitRaw = Array.isArray(req.query.limit)
      ? req.query.limit[0]
      : req.query.limit;
    const searchRaw = Array.isArray(req.query.search)
      ? req.query.search[0]
      : req.query.search;
    const statusRaw = Array.isArray(req.query.status)
      ? req.query.status[0]
      : req.query.status;
    const businessUnitIdRaw = Array.isArray(req.query.businessUnitId)
      ? req.query.businessUnitId[0]
      : req.query.businessUnitId;
    const sortByRaw = Array.isArray(req.query.sortBy)
      ? req.query.sortBy[0]
      : req.query.sortBy;
    const sortOrderRaw = Array.isArray(req.query.sortOrder)
      ? req.query.sortOrder[0]
      : req.query.sortOrder;

    const page = Math.max(1, Number(pageRaw || 1));
    const limit = Math.min(100, Math.max(1, Number(limitRaw || 10)));
    const skip = (page - 1) * limit;

    const search = typeof searchRaw === "string" ? searchRaw.trim() : "";
    const status =
      typeof statusRaw === "string" ? statusRaw.trim().toUpperCase() : "";
    const businessUnitId =
      typeof businessUnitIdRaw === "string" ? businessUnitIdRaw.trim() : "";

    const sortBy =
      typeof sortByRaw === "string" &&
      ProjectController.LIST_SORTABLE_FIELDS.has(sortByRaw)
        ? sortByRaw
        : "createdAt";

    const sortOrder: Prisma.SortOrder =
      typeof sortOrderRaw === "string" && sortOrderRaw.toLowerCase() === "asc"
        ? "asc"
        : "desc";

    return {
      page,
      limit,
      skip,
      search,
      status,
      businessUnitId,
      sortBy,
      sortOrder,
    };
  }

  private static buildListMeta(page: number, limit: number, total: number) {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };
  }

  private static buildProjectWhereFilters(filters: {
    search: string;
    status: string;
    businessUnitId: string;
  }): Prisma.ProjectWhereInput {
    const where: Prisma.ProjectWhereInput = {};
    const and: Prisma.ProjectWhereInput[] = [];

    if (filters.search) {
      and.push({
        OR: [
          { name: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
        ],
      });
    }

    if (filters.status) {
      if (
        !Object.values(ProjectStatus).includes(filters.status as ProjectStatus)
      ) {
        throw new Error("Invalid status filter");
      }
      and.push({ status: filters.status as ProjectStatus });
    }

    if (filters.businessUnitId) {
      and.push({ businessUnit: filters.businessUnitId });
    }

    if (and.length > 0) {
      where.AND = and;
    }

    return where;
  }

  private static sortProjectsInMemory(
    projects: any[],
    sortBy: string,
    sortOrder: Prisma.SortOrder,
  ) {
    const direction = sortOrder === "asc" ? 1 : -1;

    return [...projects].sort((a, b) => {
      const aVal = a?.[sortBy];
      const bVal = b?.[sortBy];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1 * direction;
      if (bVal == null) return -1 * direction;

      if (aVal instanceof Date || bVal instanceof Date) {
        const aTime = new Date(aVal).getTime();
        const bTime = new Date(bVal).getTime();
        return (aTime - bTime) * direction;
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * direction;
      }

      return String(aVal).localeCompare(String(bVal)) * direction;
    });
  }

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
      businessUnitDetails: p.businessUnit
        ? (buMap[p.businessUnit] ?? null)
        : null,
      businessUnitName: p.businessUnit
        ? (buMap[p.businessUnit]?.name ?? null)
        : null,
    }));
  }

  private static async buildProjectFullTree(
    projectId: string,
    options?: {
      includeOwner?: boolean;
      basicAssigneeUser?: boolean;
    },
  ) {
    const { includeOwner = false, basicAssigneeUser = false } = options || {};

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: includeOwner
        ? { owner: { select: { id: true, name: true, email: true } } }
        : undefined,
    });

    if (!project) return null;

    const scopes = await prisma.scope.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
    });

    if (!scopes.length) {
      return { ...project, scopes: [] };
    }

    const scopeIds = scopes.map((scope) => scope.id);

    const tasks = await prisma.task.findMany({
      where: { scopeId: { in: scopeIds } },
      orderBy: { order: "asc" },
    });

    const taskIds = tasks.map((task) => task.id);

    const subtasks = taskIds.length
      ? await prisma.subtask.findMany({
          where: { taskId: { in: taskIds } },
          orderBy: { order: "asc" },
        })
      : [];

    const subtaskIds = subtasks.map((subtask) => subtask.id);

    const [progressLogs, checklists, assignees] = subtaskIds.length
      ? await Promise.all([
          prisma.progressLog.findMany({
            where: { subtaskId: { in: subtaskIds } },
          }),
          prisma.checklist.findMany({
            where: { subtaskId: { in: subtaskIds } },
          }),
          prisma.subtaskAssignee.findMany({
            where: { subtaskId: { in: subtaskIds } },
            include: basicAssigneeUser
              ? { user: { select: { id: true, name: true, email: true } } }
              : { user: true },
          }),
        ])
      : [[], [], []];

    const tasksByScopeId = new Map<string, any[]>();
    const subtasksByTaskId = new Map<string, any[]>();
    const progressLogsBySubtaskId = new Map<string, any[]>();
    const checklistsBySubtaskId = new Map<string, any[]>();
    const assigneesBySubtaskId = new Map<string, any[]>();

    for (const task of tasks) {
      const list = tasksByScopeId.get(task.scopeId) || [];
      list.push(task);
      tasksByScopeId.set(task.scopeId, list);
    }

    for (const subtask of subtasks) {
      const list = subtasksByTaskId.get(subtask.taskId) || [];
      list.push(subtask);
      subtasksByTaskId.set(subtask.taskId, list);
    }

    for (const log of progressLogs) {
      const list = progressLogsBySubtaskId.get(log.subtaskId) || [];
      list.push(log);
      progressLogsBySubtaskId.set(log.subtaskId, list);
    }

    for (const checklist of checklists) {
      const list = checklistsBySubtaskId.get(checklist.subtaskId) || [];
      list.push(checklist);
      checklistsBySubtaskId.set(checklist.subtaskId, list);
    }

    for (const assignee of assignees) {
      const list = assigneesBySubtaskId.get(assignee.subtaskId) || [];
      list.push(assignee);
      assigneesBySubtaskId.set(assignee.subtaskId, list);
    }

    const scopeTree = scopes.map((scope) => {
      const scopeTasks = (tasksByScopeId.get(scope.id) || []).map((task) => {
        const taskSubtasks = (subtasksByTaskId.get(task.id) || []).map(
          (subtask) => ({
            ...subtask,
            progressLogs: progressLogsBySubtaskId.get(subtask.id) || [],
            checklists: checklistsBySubtaskId.get(subtask.id) || [],
            assignees: assigneesBySubtaskId.get(subtask.id) || [],
          }),
        );

        return {
          ...task,
          subtasks: taskSubtasks,
        };
      });

      return {
        ...scope,
        tasks: scopeTasks,
      };
    });

    return {
      ...project,
      scopes: scopeTree,
    };
  }

  // CREATE
  static async create(req: Request<{}, {}, CreateProjectDTO>, res: Response) {
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
        includeHolidays,
      } = req.body;

      const rawFiles = (req as any).files;
      const files: Express.Multer.File[] = Array.isArray(rawFiles)
        ? rawFiles
        : [
            ...((rawFiles?.attachments as Express.Multer.File[]) ?? []),
            ...((rawFiles?.files as Express.Multer.File[]) ?? []),
          ];

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
          includeHolidays: includeHolidays ?? undefined,
        },
      });

      //  AUTO-ASSIGN CURRENT USER AS OWNER
      await prisma.projectMember.create({
        data: {
          projectId: project.id,
          userId,
          role: "OWNER",
        },
      });

      //  AUTO-GENERATE TIMELINE if dates are provided
      if (project.startDate && project.expectedEndDate) {
        try {
          await generateProjectTimeline(project.id, "daily");
        } catch (timelineError: any) {
          console.error("Timeline generation warning:", timelineError.message);
          // Don't fail project creation if timeline fails
        }
      }

      // Optional create-time attachments: same submit request as project creation.
      if (files.length > 0) {
        await Promise.all(
          files.map(async (file) => {
            const uploaded = await uploadBufferToSharePoint({
              buffer: file.buffer,
              originalName: file.originalname,
              mimeType: file.mimetype,
              folder: "projects",
            });

            await prisma.attachment.create({
              data: {
                projectId: project.id,
                uploadedBy: userId,
                fileUrl: uploaded.downloadUrl || uploaded.webUrl || "",
                fileName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
              },
            });
          }),
        );
      }

      const projectWithAttachments = await prisma.project.findUnique({
        where: { id: project.id },
        include: {
          attachments: true,
        },
      });

      const [enrichedProject] =
        await ProjectController.enrichBusinessUnitDetails(
          projectWithAttachments ? [projectWithAttachments] : [],
        );

      res.json(enrichedProject ?? projectWithAttachments);
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
        where: { id: userRoleId },
      });

      let projects;

      if (userRole?.name === "SUPERADMIN" || userRole?.name === "OP") {
        projects = await prisma.project.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            projectMembers: {
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
          },
        });
      } else if (userRole?.name === "BU_HEAD") {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            businessUnitId: true,
          },
        });

        projects = await prisma.project.findMany({
          where: {
            businessUnit: user?.businessUnitId,
          },
          orderBy: { createdAt: "desc" },
          include: {
            projectMembers: {
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
          },
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
                    userId: userId, // User is member (SUB_OWNER or MEMBER)
                  },
                },
              },
            ],
          },
          orderBy: { createdAt: "desc" },
          include: {
            projectMembers: {
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
          },
        });
      }

      const enriched =
        await ProjectController.enrichBusinessUnitDetails(projects);

      res.json(enriched);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET PAGINATED PROJECT DIRECTORY
  static async getDirectory(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const userRoleId = (req as any).user.roleId;
      const first = (input: unknown) =>
        Array.isArray(input) ? input[0] : input;
      const requestedPage = Number(first(req.query.page));
      const requestedLimit = Number(first(req.query.limit));
      const page =
        Number.isInteger(requestedPage) && requestedPage > 0
          ? requestedPage
          : 1;
      const limit = ProjectController.DIRECTORY_LIMITS.has(requestedLimit)
        ? requestedLimit
        : 12;
      const search = String(first(req.query.search) || "").trim();
      const status = String(first(req.query.status) || "")
        .trim()
        .toUpperCase();
      const businessUnitId = String(
        first(req.query.businessUnitId) || "",
      ).trim();
      const requestedSortBy = String(first(req.query.sortBy) || "createdAt");
      const sortBy = ProjectController.DIRECTORY_SORT_FIELDS.has(
        requestedSortBy,
      )
        ? requestedSortBy
        : "createdAt";
      const sortOrder: Prisma.SortOrder =
        String(first(req.query.sortOrder) || "desc").toLowerCase() === "asc"
          ? "asc"
          : "desc";

      if (
        status &&
        !Object.values(ProjectStatus).includes(status as ProjectStatus)
      ) {
        return res.status(400).json({
          message: "Invalid status filter",
          allowedStatuses: Object.values(ProjectStatus),
        });
      }

      const role = await prisma.role.findUnique({
        where: { id: userRoleId },
        select: { name: true },
      });
      const conditions: Prisma.ProjectWhereInput[] = [
        { status: { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.CANCELLED] } },
      ];

      if (role?.name === "BU_HEAD") {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { businessUnitId: true },
        });
        conditions.push({
          businessUnit:
            user?.businessUnitId || "__NO_ACCESSIBLE_BUSINESS_UNIT__",
        });
      } else if (!["SUPERADMIN", "OP"].includes(role?.name || "")) {
        conditions.push({
          OR: [{ ownerId: userId }, { projectMembers: { some: { userId } } }],
        });
      }

      if (search) {
        conditions.push({
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { pin: { contains: search, mode: "insensitive" } },
          ],
        });
      }
      if (status) conditions.push({ status: status as ProjectStatus });
      if (businessUnitId) conditions.push({ businessUnit: businessUnitId });

      const where: Prisma.ProjectWhereInput = conditions.length
        ? { AND: conditions }
        : {};
      const [projects, total] = await Promise.all([
        prisma.project.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
          select: {
            id: true,
            pin: true,
            name: true,
            description: true,
            status: true,
            startDate: true,
            expectedEndDate: true,
            actualStartDate: true,
            businessUnit: true,
            location: true,
            versionLabel: true,
            versionNumber: true,
            progress: true,
            owner: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
        prisma.project.count({ where }),
      ]);

      const businessUnitIds = [
        ...new Set(
          projects
            .map((project) => project.businessUnit)
            .filter(Boolean) as string[],
        ),
      ];
      const businessUnits = businessUnitIds.length
        ? await prisma.businessUnit.findMany({
            where: { id: { in: businessUnitIds } },
            select: { id: true, code: true, name: true },
          })
        : [];
      const businessUnitMap = new Map(
        businessUnits.map((unit) => [unit.id, unit]),
      );

      const data = projects.map((project) => {
        const rawLocation =
          project.location && typeof project.location === "object"
            ? (project.location as Record<string, unknown>)
            : null;
        const progress = Number(project.progress);
        const versionNumberFromLabel = String(project.versionLabel || "").match(
          /(?:version|v)\s*(\d+)/i,
        )?.[1];
        const normalizedVersionNumber =
          versionNumberFromLabel || String(project.versionNumber || 1);

        return {
          id: project.id,
          pin: project.pin,
          name: project.name,
          description: project.description,
          status: project.status,
          startDate: project.startDate,
          expectedEndDate: project.expectedEndDate,
          activatedAt: project.actualStartDate,
          owner: project.owner,
          businessUnit: project.businessUnit
            ? businessUnitMap.get(project.businessUnit) || null
            : null,
          location: rawLocation
            ? {
                street: rawLocation.street ?? null,
                barangayName: rawLocation.barangayName ?? null,
                cityName: rawLocation.cityName ?? null,
                provinceName: rawLocation.provinceName ?? null,
              }
            : null,
          versionLabel: `Version ${normalizedVersionNumber}`,
          overallProgress: Number.isFinite(progress)
            ? Math.min(100, Math.max(0, progress))
            : 0,
        };
      });

      return res.json({
        data,
        meta: ProjectController.buildListMeta(page, limit, total),
      });
    } catch (error: any) {
      return res.status(500).json({
        message: error.message || "Failed to fetch project directory",
      });
    }
  }

  static async getMyApprovals(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const {
        page,
        limit,
        skip,
        search,
        status,
        businessUnitId,
        sortBy,
        sortOrder,
      } = ProjectController.parseListQuery(req);

      const projects =
        await approvalService.getPendingProjectsForApproval(userId);
      const enriched =
        await ProjectController.enrichBusinessUnitDetails(projects);

      let filtered = enriched;

      if (search) {
        const needle = search.toLowerCase();
        filtered = filtered.filter(
          (p: any) =>
            String(p.name || "")
              .toLowerCase()
              .includes(needle) ||
            String(p.description || "")
              .toLowerCase()
              .includes(needle),
        );
      }

      if (status) {
        if (!Object.values(ProjectStatus).includes(status as ProjectStatus)) {
          return res.status(400).json({
            success: false,
            message: "Invalid status filter",
          });
        }
        filtered = filtered.filter((p: any) => p.status === status);
      }

      if (businessUnitId) {
        filtered = filtered.filter(
          (p: any) => p.businessUnit === businessUnitId,
        );
      }

      const sorted = ProjectController.sortProjectsInMemory(
        filtered,
        sortBy,
        sortOrder,
      );
      const pageData = sorted.slice(skip, skip + limit);
      const total = sorted.length;

      res.json({
        success: true,
        data: pageData,
        meta: ProjectController.buildListMeta(page, limit, total),
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  static async getMyRequests(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const {
        page,
        limit,
        skip,
        search,
        status,
        businessUnitId,
        sortBy,
        sortOrder,
      } = ProjectController.parseListQuery(req);

      const where: Prisma.ProjectWhereInput = {
        ownerId: userId,
        AND: [
          { status: { notIn: ["DRAFT", "ARCHIVED"] } },
          ProjectController.buildProjectWhereFilters({
            search,
            status,
            businessUnitId,
          }),
        ],
      };

      const [projects, total] = await Promise.all([
        prisma.project.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
          include: {
            projectMembers: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
        }),
        prisma.project.count({ where }),
      ]);

      const enriched =
        await ProjectController.enrichBusinessUnitDetails(projects);

      res.json({
        success: true,
        data: enriched,
        meta: ProjectController.buildListMeta(page, limit, total),
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  static async getMyDrafts(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const {
        page,
        limit,
        skip,
        search,
        status,
        businessUnitId,
        sortBy,
        sortOrder,
      } = ProjectController.parseListQuery(req);

      const where: Prisma.ProjectWhereInput = {
        ownerId: userId,
        status: "DRAFT",
        ...ProjectController.buildProjectWhereFilters({
          search,
          status,
          businessUnitId,
        }),
      };

      const [projects, total] = await Promise.all([
        prisma.project.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
          include: {
            projectMembers: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
        }),
        prisma.project.count({ where }),
      ]);

      const enriched =
        await ProjectController.enrichBusinessUnitDetails(projects);

      res.json({
        success: true,
        data: enriched,
        meta: ProjectController.buildListMeta(page, limit, total),
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // GET BY STATUS
  static async getByStatus(req: Request<{ status: string }>, res: Response) {
    try {
      const userId = (req as any).user.id;
      const userRoleId = (req as any).user.roleId;
      const status = req.params.status?.toUpperCase() as ProjectStatus;

      if (!Object.values(ProjectStatus).includes(status)) {
        return res.status(400).json({
          message: "Invalid project status",
          allowedStatuses: Object.values(ProjectStatus),
        });
      }

      const userRole = await (prisma as any).role.findUnique({
        where: { id: userRoleId },
      });

      const projects = await prisma.project.findMany({
        where:
          userRole?.name === "SUPERADMIN"
            ? { status }
            : {
                status,
                OR: [
                  { ownerId: userId },
                  {
                    projectMembers: {
                      some: { userId },
                    },
                  },
                ],
              },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          pin: true,
          status: true,
        },
      });

      res.json(
        projects.map((project) => ({
          value: project.id,
          label: project.name,
          pin: project.pin,
          status: project.status,
        })),
      );
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET ACTIVE PROJECTS FOR DROPDOWN
  static async getActiveDropdown(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const userRoleId = (req as any).user.roleId;
      const accessWhere = await buildAccessibleProjectWhere(userId, userRoleId);

      const projects = await prisma.project.findMany({
        where: { AND: [{ status: "ACTIVE" }, accessWhere] },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
        },
      });

      res.json({ data: projects });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET SINGLE (LIGHT)
  static async getById(req: Request<ProjectParamsDTO>, res: Response) {
    try {
      const { id } = req.params;

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          scopes: {
            orderBy: { order: "asc" },
          },
          projectMembers: {
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
        },
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const [enrichedProject] =
        await ProjectController.enrichBusinessUnitDetails([project]);

      res.json(enrichedProject);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // 🔥 FULL TREE (VERY IMPORTANT)
  static async getFull(req: Request<ProjectParamsDTO>, res: Response) {
    try {
      const { id } = req.params;

      const project = await ProjectController.buildProjectFullTree(id, {
        includeOwner: false,
        basicAssigneeUser: false,
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const [enrichedProject] =
        await ProjectController.enrichBusinessUnitDetails([project]);

      res.json(enrichedProject);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET FULL PROJECT FOR APPROVAL VIEW
  static async getFullForApproval(
    req: Request<ProjectParamsDTO>,
    res: Response,
  ) {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const project = await ProjectController.buildProjectFullTree(id, {
        includeOwner: true,
        basicAssigneeUser: true,
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
            approverId: userId,
          },
        });

        if (!isApprover) {
          return res.status(403).json({
            error: "Access denied - you are not an approver for this project",
          });
        }
      }

      const [enrichedProject] =
        await ProjectController.enrichBusinessUnitDetails([project]);

      res.json({
        success: true,
        data: enrichedProject,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  // UPDATE (SAFE)
  static async update(
    req: Request<ProjectParamsDTO, {}, UpdateProjectDTO>,
    res: Response,
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
        includeHolidays,
        status,
      } = req.body;

      if (status !== undefined) {
        if (!Object.values(ProjectStatus).includes(status)) {
          return res.status(400).json({
            success: false,
            message: "Invalid project status",
            allowedStatuses: Object.values(ProjectStatus),
          });
        }

        // Approval and lifecycle states are controlled by their dedicated endpoints.
        if (status !== "DRAFT") {
          return res.status(400).json({
            success: false,
            message:
              "Only DRAFT can be set through the project update endpoint",
          });
        }

        const currentProject = await prisma.project.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!currentProject) {
          return res.status(404).json({
            success: false,
            message: "Project not found",
          });
        }
        if (!["DRAFT", "NEEDS_REVISION"].includes(currentProject.status)) {
          return res.status(409).json({
            success: false,
            message: `Project cannot be moved from ${currentProject.status} to DRAFT`,
          });
        }
      }

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
          includeHolidays: includeHolidays ?? undefined,
          status: status ?? undefined,
        },
      });

      // 🔥 REGENERATE TIMELINE if dates changed
      if (
        (startDate || expectedEndDate) &&
        updated.startDate &&
        updated.expectedEndDate
      ) {
        try {
          await generateProjectTimeline(updated.id, "daily");
        } catch (timelineError: any) {
          console.error(
            "Timeline regeneration warning:",
            timelineError.message,
          );
          // Don't fail project update if timeline fails
        }
      }

      const [enrichedProject] =
        await ProjectController.enrichBusinessUnitDetails([updated]);

      res.json(enrichedProject);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // DELETE (FULL CASCADE CLEANUP)
  static async delete(req: Request<ProjectParamsDTO>, res: Response) {
    try {
      const { id } = req.params;

      await prisma.$transaction(async (tx) => {
        // 1. Load project tree
        const project = await tx.project.findUnique({
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
          throw new Error("Project not found");
        }

        // ============================
        // Collect IDs
        // ============================
        const scopeIds = project.scopes.map((s) => s.id);

        const taskIds = project.scopes.flatMap((scope) =>
          scope.tasks.map((task) => task.id),
        );

        const subtaskIds = project.scopes.flatMap((scope) =>
          scope.tasks.flatMap((task) =>
            task.subtasks.map((subtask) => subtask.id),
          ),
        );

        // ============================
        // Delete Subtask Child Tables
        // ============================

        if (subtaskIds.length > 0) {
          await tx.progressLog.deleteMany({
            where: {
              subtaskId: {
                in: subtaskIds,
              },
            },
          });

          await tx.checklist.deleteMany({
            where: {
              subtaskId: {
                in: subtaskIds,
              },
            },
          });

          await tx.subtaskAssignee.deleteMany({
            where: {
              subtaskId: {
                in: subtaskIds,
              },
            },
          });

          await tx.comment.deleteMany({
            where: {
              subtaskId: {
                in: subtaskIds,
              },
            },
          });

          await tx.attachment.deleteMany({
            where: {
              subtaskId: {
                in: subtaskIds,
              },
            },
          });

          await tx.activityLog.deleteMany({
            where: {
              subtaskId: {
                in: subtaskIds,
              },
            },
          });

          await tx.subtask.deleteMany({
            where: {
              id: {
                in: subtaskIds,
              },
            },
          });
        }

        // ============================
        // Delete Task Child Tables
        // ============================

        if (taskIds.length > 0) {
          await tx.taskAssignee.deleteMany({
            where: {
              taskId: {
                in: taskIds,
              },
            },
          });

          await tx.task.deleteMany({
            where: {
              id: {
                in: taskIds,
              },
            },
          });
        }

        // ============================
        // Delete Scopes
        // ============================

        if (scopeIds.length > 0) {
          await tx.scope.deleteMany({
            where: {
              id: {
                in: scopeIds,
              },
            },
          });
        }

        // ============================
        // Delete Project-Level Records
        // ============================

        await tx.projectMember.deleteMany({
          where: {
            projectId: id,
          },
        });

        await tx.projectTimeline.deleteMany({
          where: {
            projectId: id,
          },
        });

        await tx.attachment.deleteMany({
          where: {
            projectId: id,
          },
        });

        await tx.dailyReport.deleteMany({
          where: {
            projectId: id,
          },
        });

        // ============================
        // Delete Project
        // ============================

        await tx.project.delete({
          where: {
            id,
          },
        });
      });

      return res.json({
        success: true,
        message: "Project deleted successfully (full cascade cleanup)",
      });
    } catch (error: any) {
      console.error("❌ Project delete error:", error);

      return res
        .status(error.message === "Project not found" ? 404 : 400)
        .json({
          message: error.message,
        });
    }
  }
}

// ========================================
// 📎 PROJECT ATTACHMENTS
// ========================================
export async function uploadProjectAttachment(req: any, res: Response) {
  try {
    const { id: projectId } = req.params;
    const userId = req.user?.id;
    const rawFiles = req.files;
    const files: Express.Multer.File[] = Array.isArray(rawFiles)
      ? rawFiles
      : [
          ...((rawFiles?.attachments as Express.Multer.File[]) ?? []),
          ...((rawFiles?.files as Express.Multer.File[]) ?? []),
        ];

    if (!files.length) {
      return res
        .status(400)
        .json({ success: false, message: "No files provided" });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project)
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });

    const created = await Promise.all(
      files.map(async (file) => {
        const result = await uploadBufferToSharePoint({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          folder: "projects",
        });
        return prisma.attachment.create({
          data: {
            projectId,
            uploadedBy: userId,
            fileUrl: result.downloadUrl || result.webUrl || "",
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          },
        });
      }),
    );

    res.json({ success: true, data: created });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function getProjectAttachments(req: any, res: Response) {
  try {
    const { id: projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : "";

    const attachments = await prisma.attachment.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    const withProxy = attachments.map((attachment) => ({
      ...attachment,
      proxyUrl: `/api/projects/attachments/${attachment.id}/file${
        bearerToken ? `?token=${encodeURIComponent(bearerToken)}` : ""
      }`,
    }));

    res.json({ success: true, data: withProxy });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function deleteProjectAttachment(req: any, res: Response) {
  try {
    let { attachmentId } = req.params;
    if (Array.isArray(attachmentId)) attachmentId = attachmentId[0];
    await prisma.attachment.delete({ where: { id: attachmentId } });
    res.json({ success: true, message: "Attachment deleted" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function streamProjectAttachment(req: any, res: Response) {
  try {
    let { attachmentId } = req.params;
    if (Array.isArray(attachmentId)) attachmentId = attachmentId[0];

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment)
      return res
        .status(404)
        .json({ success: false, message: "Attachment not found" });

    const file = await fetchSharePointFile(attachment.fileUrl);
    const contentType = attachment.mimeType || file.contentType;
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(file.buffer);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
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
      const invalid = users.find((u) => u.role?.name !== "BU_HEAD");

      if (invalid) {
        return res.status(403).json({
          message: `User ${invalid.name} is not BU_HEAD`,
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
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found",
      });
    }

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { include: { role: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // 🔥 GROUP BY ROLE
    const grouped = {
      owner: members.filter((m: any) => m.role === "OWNER"),
      subOwners: members.filter((m: any) => m.role === "SUB_OWNER"),
      members: members.filter((m: any) => m.role === "MEMBER"),
    };

    res.json({
      success: true,
      data: grouped,
      total: members.length,
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
    });
  }
}

export async function getProjectTeamOrgChart(req: any, res: any) {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        owner: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
            position: true,
            departmentId: true,
            businessUnitId: true,
            role: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const projectMembers = await prisma.projectMember.findMany({
      where: {
        projectId,
        userId: { not: project.ownerId },
        role: { in: ["SUB_OWNER", "MEMBER"] },
      },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
            position: true,
            departmentId: true,
            businessUnitId: true,
            role: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const ownerMembership = await prisma.projectMember.findFirst({
      where: { projectId, userId: project.ownerId },
      select: { id: true },
    });
    const subOwners = projectMembers.filter(
      (item) => item.role === "SUB_OWNER",
    );
    const members = projectMembers.filter((item) => item.role === "MEMBER");

    const relations =
      subOwners.length > 0 && members.length > 0
        ? await prisma.userHierarchy.findMany({
            where: {
              managerId: { in: subOwners.map((item) => item.userId) },
              memberId: { in: members.map((item) => item.userId) },
            },
            select: { managerId: true, memberId: true },
          })
        : [];

    const managerIdsByMember = new Map<string, Set<string>>();
    relations.forEach((relation) => {
      const managerIds =
        managerIdsByMember.get(relation.memberId) || new Set<string>();
      managerIds.add(relation.managerId);
      managerIdsByMember.set(relation.memberId, managerIds);
    });

    const toNode = (
      user: typeof project.owner,
      projectRole: "OWNER" | "SUB_OWNER" | "MEMBER",
      projectMemberId: string | null,
      children: any[] = [],
    ) => ({
      id: user.id,
      userId: user.id,
      projectMemberId,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      position: user.position,
      departmentId: user.departmentId,
      businessUnitId: user.businessUnitId,
      systemRole: user.role?.name || null,
      projectRole,
      children,
    });

    const assignedMemberIds = new Set<string>();
    const subOwnerNodes = subOwners.map((subOwner) => {
      const children = members
        .filter((member) =>
          managerIdsByMember.get(member.userId)?.has(subOwner.userId),
        )
        .map((member) => {
          assignedMemberIds.add(member.userId);
          return toNode(member.user, "MEMBER", member.id);
        });

      return toNode(subOwner.user, "SUB_OWNER", subOwner.id, children);
    });

    const directMemberNodes = members
      .filter((member) => !assignedMemberIds.has(member.userId))
      .map((member) => toNode(member.user, "MEMBER", member.id));

    return res.json({
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
        },
        tree: toNode(project.owner, "OWNER", ownerMembership?.id || null, [
          ...subOwnerNodes,
          ...directMemberNodes,
        ]),
        levels: {
          owner: [toNode(project.owner, "OWNER", ownerMembership?.id || null)],
          subOwners: subOwners.map((item) =>
            toNode(item.user, "SUB_OWNER", item.id),
          ),
          members: members.map((item) => toNode(item.user, "MEMBER", item.id)),
        },
        summary: {
          owners: 1,
          subOwners: subOwners.length,
          members: members.length,
          total: 1 + subOwners.length + members.length,
          membersReportingToSubOwners: assignedMemberIds.size,
          membersReportingDirectlyToOwner: directMemberNodes.length,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to build project team organization chart",
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
        user: { include: { role: true } },
      },
    });

    const users = members.map((m: any) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.user.role?.name || null,
      projectRole: m.role,
    }));

    res.json({
      success: true,
      data: users,
      total: users.length,
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
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
          message: "Invalid role. Must be 'SUB_OWNER' or 'MEMBER'",
        },
      });
    }

    // CHECK: Project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: {
          code: "PROJECT_NOT_FOUND",
          message: "Project not found",
        },
      });
    }

    // PERMISSION: Only project owner can modify member roles
    const requesterMember = await prisma.projectMember.findFirst({
      where: {
        projectId,
        userId: requesterId,
      },
    });

    if (!requesterMember || requesterMember.role !== "OWNER") {
      return res.status(403).json({
        success: false,
        error: {
          code: "INSUFFICIENT_PERMISSIONS",
          message: "Only project owner can modify member roles",
        },
      });
    }

    // CHECK: Member exists in project
    const member = await prisma.projectMember.findFirst({
      where: {
        projectId,
        userId,
      },
      include: {
        user: { include: { role: true } },
      },
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        error: {
          code: "MEMBER_NOT_FOUND",
          message: "User is not a member of this project",
        },
      });
    }

    // PREVENT: Cannot change OWNER role
    if (member.role === "OWNER") {
      return res.status(409).json({
        success: false,
        error: {
          code: "CANNOT_MODIFY_OWNER",
          message: "Cannot change role of project owner",
        },
      });
    }

    // UPDATE: Member role (real-time draft auto-save)
    const updated = await prisma.projectMember.update({
      where: { id: member.id },
      data: {
        role: newRole,
      },
      include: {
        user: { include: { role: true } },
      },
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
            name: updated.user.role?.name,
          },
        },
        updatedAt: updated.createdAt, // Using createdAt as we don't have updatedAt in schema yet
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: err.message || "Failed to update member role",
      },
    });
  }
}
