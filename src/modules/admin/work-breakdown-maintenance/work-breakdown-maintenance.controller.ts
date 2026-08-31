import { Request, Response } from "express";
import prisma from "../../../config/prisma";

const cleanCode = (value: unknown) => String(value || "").trim().toUpperCase();
const cleanName = (value: unknown) => String(value || "").trim();
const uniqueIds = (value: unknown) =>
  Array.from(new Set(Array.isArray(value) ? value.map(String).filter(Boolean) : []));

const duplicateCodeResponse = (
  res: Response,
  entity: "Scope" | "Task" | "Subtask",
  error: any,
) => {
  if (error?.code !== "P2002") return null;

  const target = Array.isArray(error?.meta?.target)
    ? error.meta.target.map(String)
    : [String(error?.meta?.target || "")];
  if (!target.some((field: string) => field.toLowerCase().includes("code"))) return null;

  return res.status(409).json({
    success: false,
    code: "DUPLICATE_CODE",
    message: `${entity} code already exists.`,
  });
};

export class WorkBreakdownMaintenanceController {
  private static async tableFilter(projectId?: string) {
    if (!projectId) return {};
    const project = await prisma.project.findUnique({
      where: { id: projectId }, select: { businessUnit: true },
    });
    if (!project) throw new Error("Project not found");
    const tables = await (prisma as any).maintenanceTable.findMany({
      where: {
        isActive: true,
        OR: [
          { isGlobal: true },
          { businessUnits: { some: { businessUnitId: String(project.businessUnit || "").trim() } } },
        ],
      },
      select: { id: true },
    });
    return { OR: [{ maintenanceTableId: null }, { maintenanceTableId: { in: tables.map((table: any) => table.id) } }] };
  }

  static async listTables(_req: Request, res: Response) {
    try {
      const data = await (prisma as any).maintenanceTable.findMany({
        include: { businessUnits: { include: { businessUnit: { select: { id: true, code: true, name: true, isActive: true } } } } },
        orderBy: [{ name: "asc" }],
      });
      return res.json({ success: true, data });
    } catch (error: any) { return res.status(500).json({ success: false, message: error.message }); }
  }

  static async createTable(req: Request, res: Response) {
    try {
      const code = cleanCode(req.body.code);
      const name = cleanName(req.body.name);
      const businessUnitIds = uniqueIds(req.body.businessUnitIds);
      if (!code || !name) throw new Error("Table code and name are required");
      if (businessUnitIds.length) {
        const count = await prisma.businessUnit.count({ where: { id: { in: businessUnitIds } } });
        if (count !== businessUnitIds.length) throw new Error("One or more Business Units are invalid");
      }
      const data = await prisma.$transaction(async (tx: any) => tx.maintenanceTable.create({
        data: {
          code, name, description: req.body.description || null, isActive: req.body.isActive ?? true,
          isGlobal: req.body.isGlobal ?? false,
          businessUnits: { create: businessUnitIds.map((businessUnitId) => ({ businessUnitId })) },
        },
        include: { businessUnits: { include: { businessUnit: true } } },
      }));
      return res.status(201).json({ success: true, data });
    } catch (error: any) { return res.status(400).json({ success: false, message: error.message }); }
  }

  static async updateTable(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const businessUnitIds = req.body.businessUnitIds === undefined ? undefined : uniqueIds(req.body.businessUnitIds);
      if (businessUnitIds) {
        const count = await prisma.businessUnit.count({ where: { id: { in: businessUnitIds } } });
        if (count !== businessUnitIds.length) throw new Error("One or more Business Units are invalid");
      }
      const data = await prisma.$transaction(async (tx: any) => tx.maintenanceTable.update({
        where: { id },
        data: {
          ...(req.body.code !== undefined ? { code: cleanCode(req.body.code) } : {}),
          ...(req.body.name !== undefined ? { name: cleanName(req.body.name) } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description || null } : {}),
          ...(req.body.isActive !== undefined ? { isActive: !!req.body.isActive } : {}),
          ...(req.body.isGlobal !== undefined ? { isGlobal: !!req.body.isGlobal } : {}),
          ...(businessUnitIds ? { businessUnits: { deleteMany: {}, create: businessUnitIds.map((businessUnitId) => ({ businessUnitId })) } } : {}),
        },
        include: { businessUnits: { include: { businessUnit: true } } },
      }));
      return res.json({ success: true, data });
    } catch (error: any) { return res.status(400).json({ success: false, message: error.message }); }
  }

  static async hierarchy(req: Request, res: Response) {
    try {
      const activeOnly = req.query.active !== "false";
      const tableFilter = await WorkBreakdownMaintenanceController.tableFilter(
        typeof req.query.projectId === "string" ? req.query.projectId : undefined,
      );
      const scopes = await (prisma as any).scopeMaintenance.findMany({
        where: { ...(activeOnly ? { isActive: true } : {}), ...tableFilter },
        include: {
          taskLinks: {
            where: activeOnly ? { taskMaintenance: { isActive: true } } : undefined,
            include: {
              taskMaintenance: {
                include: {
                  scopeLinks: {
                    select: { scopeMaintenanceId: true },
                  },
                  subtaskLinks: {
                    where: activeOnly ? { subtaskMaintenance: { isActive: true } } : undefined,
                    include: {
                      subtaskMaintenance: {
                        include: {
                          taskLinks: {
                            select: { taskMaintenanceId: true },
                          },
                        },
                      },
                    },
                    orderBy: [{ order: "asc" }, { subtaskMaintenance: { name: "asc" } }],
                  },
                },
              },
            },
            orderBy: [{ order: "asc" }, { taskMaintenance: { name: "asc" } }],
          },
        },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      });

      return res.json({
        success: true,
        data: scopes.map((scope: any) => ({
          ...scope,
          tasks: scope.taskLinks.map((link: any) => ({
            ...link.taskMaintenance,
            order: link.order,
            scopeMaintenanceIds: link.taskMaintenance.scopeLinks.map(
              (scopeLink: any) => scopeLink.scopeMaintenanceId,
            ),
            subtasks: link.taskMaintenance.subtaskLinks.map(
              (subtaskLink: any) => ({
                ...subtaskLink.subtaskMaintenance,
                order: subtaskLink.order,
                taskMaintenanceIds: subtaskLink.subtaskMaintenance.taskLinks.map(
                  (taskLink: any) => taskLink.taskMaintenanceId,
                ),
                taskLinks: undefined,
              }),
            ),
            scopeLinks: undefined,
            subtaskLinks: undefined,
          })),
          taskLinks: undefined,
        })),
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async listScopes(req: Request, res: Response) {
    const activeOnly = req.query.active !== "false";
    const data = await (prisma as any).scopeMaintenance.findMany({
      where: { ...(activeOnly ? { isActive: true } : {}), ...(await WorkBreakdownMaintenanceController.tableFilter(typeof req.query.projectId === "string" ? req.query.projectId : undefined)) },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return res.json({ success: true, data });
  }

  static async listTasks(req: Request, res: Response) {
    const scopeId = typeof req.query.scopeMaintenanceId === "string"
      ? req.query.scopeMaintenanceId
      : undefined;
    const activeOnly = req.query.active !== "false";
    if (scopeId) {
      const links = await (prisma as any).scopeMaintenanceTask.findMany({
        where: {
          scopeMaintenanceId: scopeId,
          ...(activeOnly ? { taskMaintenance: { isActive: true } } : {}),
        },
        include: {
          taskMaintenance: {
            include: {
              scopeLinks: { select: { scopeMaintenanceId: true } },
            },
          },
        },
        orderBy: [{ order: "asc" }, { taskMaintenance: { name: "asc" } }],
      });
      return res.json({
        success: true,
        data: links.map((link: any) => ({
          ...link.taskMaintenance,
          order: link.order,
          scopeMaintenanceIds: link.taskMaintenance.scopeLinks.map(
            (scopeLink: any) => scopeLink.scopeMaintenanceId,
          ),
          scopeLinks: undefined,
        })),
      });
    }
    const data = await (prisma as any).taskMaintenance.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(scopeId ? { scopeLinks: { some: { scopeMaintenanceId: scopeId } } } : {}),
      },
      include: {
        scopeLinks: { select: { scopeMaintenanceId: true } },
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return res.json({
      success: true,
      data: data.map((task: any) => ({
        ...task,
        scopeMaintenanceIds: task.scopeLinks.map(
          (scopeLink: any) => scopeLink.scopeMaintenanceId,
        ),
        scopeLinks: undefined,
      })),
    });
  }

  static async listSubtasks(req: Request, res: Response) {
    const taskId = typeof req.query.taskMaintenanceId === "string"
      ? req.query.taskMaintenanceId
      : undefined;
    const activeOnly = req.query.active !== "false";
    if (taskId) {
      const links = await (prisma as any).taskMaintenanceSubtask.findMany({
        where: {
          taskMaintenanceId: taskId,
          ...(activeOnly ? { subtaskMaintenance: { isActive: true } } : {}),
        },
        include: {
          subtaskMaintenance: {
            include: {
              taskLinks: { select: { taskMaintenanceId: true } },
            },
          },
        },
        orderBy: [{ order: "asc" }, { subtaskMaintenance: { name: "asc" } }],
      });
      return res.json({
        success: true,
        data: links.map((link: any) => ({
          ...link.subtaskMaintenance,
          order: link.order,
          taskMaintenanceIds: link.subtaskMaintenance.taskLinks.map(
            (taskLink: any) => taskLink.taskMaintenanceId,
          ),
          taskLinks: undefined,
        })),
      });
    }
    const data = await (prisma as any).subtaskMaintenance.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(taskId ? { taskLinks: { some: { taskMaintenanceId: taskId } } } : {}),
      },
      include: {
        taskLinks: { select: { taskMaintenanceId: true } },
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return res.json({
      success: true,
      data: data.map((subtask: any) => ({
        ...subtask,
        taskMaintenanceIds: subtask.taskLinks.map(
          (taskLink: any) => taskLink.taskMaintenanceId,
        ),
        taskLinks: undefined,
      })),
    });
  }

  static async createScope(req: Request, res: Response) {
    try {
      const code = cleanCode(req.body.code);
      const name = cleanName(req.body.name);
      if (!code || !name) throw new Error("Code and name are required");
      const maintenanceTableId = req.body.maintenanceTableId ? String(req.body.maintenanceTableId) : null;
      if (maintenanceTableId) {
        const table = await (prisma as any).maintenanceTable.findUnique({ where: { id: maintenanceTableId } });
        if (!table) throw new Error("Maintenance table not found");
      }
      const last = await (prisma as any).scopeMaintenance.findFirst({
        orderBy: { order: "desc" },
        select: { order: true },
      });
      const data = await (prisma as any).scopeMaintenance.create({
        data: {
          code,
          name,
          description: req.body.description || null,
          order: (last?.order ?? -1) + 1,
          isActive: req.body.isActive ?? true,
          maintenanceTableId,
        },
      });
      return res.status(201).json({ success: true, data });
    } catch (error: any) {
      const duplicate = duplicateCodeResponse(res, "Scope", error);
      if (duplicate) return duplicate;
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  static async createTask(req: Request, res: Response) {
    try {
      const code = cleanCode(req.body.code);
      const name = cleanName(req.body.name);
      const scopeIds = uniqueIds(req.body.scopeMaintenanceIds);
      if (!code || !name) throw new Error("Code and name are required");
      if (!scopeIds.length) throw new Error("At least one scope relationship is required");
      const count = await (prisma as any).scopeMaintenance.count({
        where: { id: { in: scopeIds }, isActive: true },
      });
      if (count !== scopeIds.length) throw new Error("One or more scopes are invalid or inactive");
      const scopes = await (prisma as any).scopeMaintenance.findMany({ where: { id: { in: scopeIds } }, select: { maintenanceTableId: true } });
      const maintenanceTableId = scopes[0]?.maintenanceTableId ?? null;
      if (scopes.some((scope: any) => scope.maintenanceTableId !== maintenanceTableId)) {
        throw new Error("A task can only be linked to scopes in the same maintenance table");
      }
      const data = await prisma.$transaction(async (tx: any) => {
        const lastTask = await tx.taskMaintenance.findFirst({
          orderBy: { order: "desc" },
          select: { order: true },
        });
        const task = await tx.taskMaintenance.create({
          data: {
            code,
            name,
            description: req.body.description || null,
            order: (lastTask?.order ?? -1) + 1,
            isActive: req.body.isActive ?? true,
            maintenanceTableId,
          },
        });
        for (const scopeMaintenanceId of scopeIds) {
          const lastLink = await tx.scopeMaintenanceTask.findFirst({
            where: { scopeMaintenanceId },
            orderBy: { order: "desc" },
            select: { order: true },
          });
          await tx.scopeMaintenanceTask.create({
            data: {
              scopeMaintenanceId,
              taskMaintenanceId: task.id,
              order: (lastLink?.order ?? -1) + 1,
            },
          });
        }
        return tx.taskMaintenance.findUnique({
          where: { id: task.id },
          include: { scopeLinks: true },
        });
      });
      return res.status(201).json({ success: true, data });
    } catch (error: any) {
      const duplicate = duplicateCodeResponse(res, "Task", error);
      if (duplicate) return duplicate;
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  static async createSubtask(req: Request, res: Response) {
    try {
      const code = cleanCode(req.body.code);
      const name = cleanName(req.body.name);
      const taskIds = uniqueIds(req.body.taskMaintenanceIds);
      if (!code || !name) throw new Error("Code and name are required");
      if (!taskIds.length) throw new Error("At least one task relationship is required");
      const count = await (prisma as any).taskMaintenance.count({
        where: { id: { in: taskIds }, isActive: true },
      });
      if (count !== taskIds.length) throw new Error("One or more tasks are invalid or inactive");
      const tasks = await (prisma as any).taskMaintenance.findMany({ where: { id: { in: taskIds } }, select: { maintenanceTableId: true } });
      const maintenanceTableId = tasks[0]?.maintenanceTableId ?? null;
      if (tasks.some((task: any) => task.maintenanceTableId !== maintenanceTableId)) {
        throw new Error("A subtask can only be linked to tasks in the same maintenance table");
      }
      const data = await prisma.$transaction(async (tx: any) => {
        const lastSubtask = await tx.subtaskMaintenance.findFirst({
          orderBy: { order: "desc" },
          select: { order: true },
        });
        const subtask = await tx.subtaskMaintenance.create({
          data: {
            code,
            name,
            description: req.body.description || null,
            order: (lastSubtask?.order ?? -1) + 1,
            isActive: req.body.isActive ?? true,
            maintenanceTableId,
          },
        });
        for (const taskMaintenanceId of taskIds) {
          const lastLink = await tx.taskMaintenanceSubtask.findFirst({
            where: { taskMaintenanceId },
            orderBy: { order: "desc" },
            select: { order: true },
          });
          await tx.taskMaintenanceSubtask.create({
            data: {
              taskMaintenanceId,
              subtaskMaintenanceId: subtask.id,
              order: (lastLink?.order ?? -1) + 1,
            },
          });
        }
        return tx.subtaskMaintenance.findUnique({
          where: { id: subtask.id },
          include: { taskLinks: true },
        });
      });
      return res.status(201).json({ success: true, data });
    } catch (error: any) {
      const duplicate = duplicateCodeResponse(res, "Subtask", error);
      if (duplicate) return duplicate;
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  private static async update(
    type: "scope" | "task" | "subtask",
    id: string,
    body: any,
  ) {
    const relationIds =
      type === "task"
        ? uniqueIds(body.scopeMaintenanceIds)
        : type === "subtask"
          ? uniqueIds(body.taskMaintenanceIds)
          : null;

    return prisma.$transaction(async (tx: any) => {
      if (type === "task" && body.scopeMaintenanceIds !== undefined) {
        if (!relationIds?.length) throw new Error("At least one scope relationship is required");
        const existingLinks = await tx.scopeMaintenanceTask.findMany({
          where: { taskMaintenanceId: id },
        });
        await tx.scopeMaintenanceTask.deleteMany({
          where: { taskMaintenanceId: id, scopeMaintenanceId: { notIn: relationIds } },
        });
        const existingIds = new Set(existingLinks.map((link: any) => link.scopeMaintenanceId));
        for (const scopeMaintenanceId of relationIds.filter((scopeId) => !existingIds.has(scopeId))) {
          const last = await tx.scopeMaintenanceTask.findFirst({
            where: { scopeMaintenanceId },
            orderBy: { order: "desc" },
          });
          await tx.scopeMaintenanceTask.create({
            data: { scopeMaintenanceId, taskMaintenanceId: id, order: (last?.order ?? -1) + 1 },
          });
        }
      }
      if (type === "subtask" && body.taskMaintenanceIds !== undefined) {
        if (!relationIds?.length) throw new Error("At least one task relationship is required");
        const existingLinks = await tx.taskMaintenanceSubtask.findMany({
          where: { subtaskMaintenanceId: id },
        });
        await tx.taskMaintenanceSubtask.deleteMany({
          where: { subtaskMaintenanceId: id, taskMaintenanceId: { notIn: relationIds } },
        });
        const existingIds = new Set(existingLinks.map((link: any) => link.taskMaintenanceId));
        for (const taskMaintenanceId of relationIds.filter((taskId) => !existingIds.has(taskId))) {
          const last = await tx.taskMaintenanceSubtask.findFirst({
            where: { taskMaintenanceId },
            orderBy: { order: "desc" },
          });
          await tx.taskMaintenanceSubtask.create({
            data: { taskMaintenanceId, subtaskMaintenanceId: id, order: (last?.order ?? -1) + 1 },
          });
        }
      }

      return (tx as any)[`${type}Maintenance`].update({
        where: { id },
        data: {
          ...(body.code !== undefined ? { code: cleanCode(body.code) } : {}),
          ...(body.name !== undefined ? { name: cleanName(body.name) } : {}),
          ...(body.description !== undefined ? { description: body.description || null } : {}),
          ...(body.isActive !== undefined ? { isActive: !!body.isActive } : {}),
        },
      });
    });
  }

  static async updateScope(req: Request, res: Response) {
    try {
      return res.json({ success: true, data: await WorkBreakdownMaintenanceController.update("scope", String(req.params.id), req.body) });
    } catch (error: any) {
      const duplicate = duplicateCodeResponse(res, "Scope", error);
      if (duplicate) return duplicate;
      return res.status(400).json({ success: false, message: error.message });
    }
  }
  static async updateTask(req: Request, res: Response) {
    try {
      return res.json({ success: true, data: await WorkBreakdownMaintenanceController.update("task", String(req.params.id), req.body) });
    } catch (error: any) {
      const duplicate = duplicateCodeResponse(res, "Task", error);
      if (duplicate) return duplicate;
      return res.status(400).json({ success: false, message: error.message });
    }
  }
  static async updateSubtask(req: Request, res: Response) {
    try {
      return res.json({ success: true, data: await WorkBreakdownMaintenanceController.update("subtask", String(req.params.id), req.body) });
    } catch (error: any) {
      const duplicate = duplicateCodeResponse(res, "Subtask", error);
      if (duplicate) return duplicate;
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  private static orderedIds(value: unknown) {
    const ids = uniqueIds(value);
    if (!ids.length) throw new Error("orderedIds must contain at least one ID");
    if (!Array.isArray(value) || ids.length !== value.length) {
      throw new Error("orderedIds must not contain duplicates");
    }
    return ids;
  }

  static async reorderScopes(req: Request, res: Response) {
    try {
      const ids = WorkBreakdownMaintenanceController.orderedIds(req.body.orderedIds);
      const count = await (prisma as any).scopeMaintenance.count({ where: { id: { in: ids } } });
      if (count !== ids.length) throw new Error("One or more scope IDs are invalid");
      await prisma.$transaction(
        ids.map((id, order) => (prisma as any).scopeMaintenance.update({ where: { id }, data: { order } })),
      );
      return res.json({ success: true, message: "Scope order updated" });
    } catch (error: any) {
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  static async reorderTasks(req: Request, res: Response) {
    try {
      const scopeId = String(req.params.scopeId);
      const ids = WorkBreakdownMaintenanceController.orderedIds(req.body.orderedIds);
      const count = await (prisma as any).scopeMaintenanceTask.count({
        where: { scopeMaintenanceId: scopeId, taskMaintenanceId: { in: ids } },
      });
      if (count !== ids.length) throw new Error("One or more tasks are not linked to this scope");
      await prisma.$transaction(
        ids.map((taskMaintenanceId, order) =>
          (prisma as any).scopeMaintenanceTask.update({
            where: {
              scopeMaintenanceId_taskMaintenanceId: {
                scopeMaintenanceId: scopeId,
                taskMaintenanceId,
              },
            },
            data: { order },
          }),
        ),
      );
      return res.json({ success: true, message: "Task order updated" });
    } catch (error: any) {
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  static async reorderSubtasks(req: Request, res: Response) {
    try {
      const taskId = String(req.params.taskId);
      const ids = WorkBreakdownMaintenanceController.orderedIds(req.body.orderedIds);
      const count = await (prisma as any).taskMaintenanceSubtask.count({
        where: { taskMaintenanceId: taskId, subtaskMaintenanceId: { in: ids } },
      });
      if (count !== ids.length) throw new Error("One or more subtasks are not linked to this task");
      await prisma.$transaction(
        ids.map((subtaskMaintenanceId, order) =>
          (prisma as any).taskMaintenanceSubtask.update({
            where: {
              taskMaintenanceId_subtaskMaintenanceId: {
                taskMaintenanceId: taskId,
                subtaskMaintenanceId,
              },
            },
            data: { order },
          }),
        ),
      );
      return res.json({ success: true, message: "Subtask order updated" });
    } catch (error: any) {
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  static async bulkStatus(req: Request, res: Response) {
    try {
      if (typeof req.body.isActive !== "boolean") {
        throw new Error("isActive must be true or false");
      }

      const scopeIds = uniqueIds(req.body.scopeIds);
      const taskIds = uniqueIds(req.body.taskIds);
      const subtaskIds = uniqueIds(req.body.subtaskIds);
      const isActive = req.body.isActive;
      const cascade = req.body.cascade !== false;

      if (!scopeIds.length && !taskIds.length && !subtaskIds.length) {
        throw new Error("At least one Scope, Task, or Subtask ID is required");
      }

      const result = await prisma.$transaction(async (tx: any) => {
        const [scopeCount, taskCount, subtaskCount] = await Promise.all([
          scopeIds.length
            ? tx.scopeMaintenance.count({ where: { id: { in: scopeIds } } })
            : 0,
          taskIds.length
            ? tx.taskMaintenance.count({ where: { id: { in: taskIds } } })
            : 0,
          subtaskIds.length
            ? tx.subtaskMaintenance.count({ where: { id: { in: subtaskIds } } })
            : 0,
        ]);

        if (scopeCount !== scopeIds.length) throw new Error("One or more Scope IDs are invalid");
        if (taskCount !== taskIds.length) throw new Error("One or more Task IDs are invalid");
        if (subtaskCount !== subtaskIds.length) {
          throw new Error("One or more Subtask IDs are invalid");
        }

        const affectedScopeIds = [...scopeIds];
        const affectedTaskIds = new Set(taskIds);
        const affectedSubtaskIds = new Set(subtaskIds);

        if (scopeIds.length) {
          await tx.scopeMaintenance.updateMany({
            where: { id: { in: scopeIds } },
            data: { isActive },
          });
        }

        if (!isActive && cascade && scopeIds.length) {
          const childTaskLinks = await tx.scopeMaintenanceTask.findMany({
            where: { scopeMaintenanceId: { in: scopeIds } },
            select: { taskMaintenanceId: true },
          });
          const candidateTaskIds: string[] = Array.from(
            new Set<string>(
              childTaskLinks.map((link: any) => String(link.taskMaintenanceId)),
            ),
          );

          if (candidateTaskIds.length) {
            const tasksWithOtherActiveParents = await tx.scopeMaintenanceTask.findMany({
              where: {
                taskMaintenanceId: { in: candidateTaskIds },
                scopeMaintenance: { isActive: true },
              },
              select: { taskMaintenanceId: true },
            });
            const sharedActiveTaskIds = new Set(
              tasksWithOtherActiveParents.map((link: any) => link.taskMaintenanceId),
            );
            candidateTaskIds
              .filter((id: string) => !sharedActiveTaskIds.has(id))
              .forEach((id: string) => affectedTaskIds.add(id));
          }
        }

        if (affectedTaskIds.size) {
          await tx.taskMaintenance.updateMany({
            where: { id: { in: Array.from(affectedTaskIds) } },
            data: { isActive },
          });
        }

        if (!isActive && cascade && affectedTaskIds.size) {
          const childSubtaskLinks = await tx.taskMaintenanceSubtask.findMany({
            where: { taskMaintenanceId: { in: Array.from(affectedTaskIds) } },
            select: { subtaskMaintenanceId: true },
          });
          const candidateSubtaskIds: string[] = Array.from(
            new Set<string>(
              childSubtaskLinks.map((link: any) => String(link.subtaskMaintenanceId)),
            ),
          );

          if (candidateSubtaskIds.length) {
            const subtasksWithOtherActiveParents = await tx.taskMaintenanceSubtask.findMany({
              where: {
                subtaskMaintenanceId: { in: candidateSubtaskIds },
                taskMaintenance: { isActive: true },
              },
              select: { subtaskMaintenanceId: true },
            });
            const sharedActiveSubtaskIds = new Set(
              subtasksWithOtherActiveParents.map((link: any) => link.subtaskMaintenanceId),
            );
            candidateSubtaskIds
              .filter((id: string) => !sharedActiveSubtaskIds.has(id))
              .forEach((id: string) => affectedSubtaskIds.add(id));
          }
        }

        if (affectedSubtaskIds.size) {
          await tx.subtaskMaintenance.updateMany({
            where: { id: { in: Array.from(affectedSubtaskIds) } },
            data: { isActive },
          });
        }

        return {
          isActive,
          cascadeApplied: !isActive && cascade,
          scopeIds: affectedScopeIds,
          taskIds: Array.from(affectedTaskIds),
          subtaskIds: Array.from(affectedSubtaskIds),
        };
      });

      return res.json({
        success: true,
        message: `Maintenance records ${result.isActive ? "activated" : "deactivated"} successfully`,
        data: result,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to update maintenance status",
      });
    }
  }
}
