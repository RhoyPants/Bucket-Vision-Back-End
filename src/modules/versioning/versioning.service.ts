import prisma from "../../config/prisma";
import { ProjectStatus } from "@prisma/client";
import { recomputeSubtaskProgress } from "../progress/progress.service";

export interface VersionAmendments {
  projectedEndDate?: Date;
  startDate?: Date;
  totalBudget?: number;
  remarks?: string;
}

export class VersioningService {
  /**
   * Create a new version of an active project
   * Clones ALL progress, reports, attachments, and team data
   * Updates only timeline/budget/remarks
   */
  async createNewVersion(
    projectId: string,
    amendments: VersionAmendments,
    userId: string
  ): Promise<any> {
    const versionForkedAt = new Date();
    // Fetch source project with all related data
    const source = await (prisma.project.findUnique as any)({
      where: { id: projectId },
      include: {
        scopes: {
          include: {
            tasks: {
              include: {
                subtasks: {
                  include: {
                    progressLogs: true,
                    assignees: true,
                  },
                },
                assignees: true,
              },
            },
          },
        },
        projectMembers: true,
        dailyReports: true,
        weeklyReports: true,
        attachments: true,
        timelines: true,
        cpmDependencies: true,
        orgChart: { include: { nodes: true } },
        approvals: true,
      },
    });

    if (!source) {
      throw new Error("Project not found");
    }

    if (!source.isActive) {
      throw new Error("Can only create version from active project");
    }

    // Check if a draft version already exists
    const existingDraft = await prisma.project.findFirst({
      where: {
        rootProjectId: source.rootProjectId ?? source.id,
        status: "DRAFT",
        NOT: { id: projectId },
      },
    });

    if (existingDraft) {
      throw new Error(
        `Version v${existingDraft.versionNumber} is already in DRAFT status. Submit or delete it first.`
      );
    }

    // Create new project version (header only)
    const newProject = await (prisma.project.create as any)({
      data: {
        name: source.name,
        description:
          amendments.remarks && amendments.remarks.trim()
            ? `${source.description}\n\n[Amendment v${source.versionNumber + 1}]: ${amendments.remarks}`
            : source.description,

        pin: source.pin, // SAME PIN
        ownerId: source.ownerId,
        location: source.location ? source.location : undefined,
        businessUnit: source.businessUnit,
        entity: source.entity,

        // TIMELINE: UPDATE with amendments or keep existing
        startDate: amendments.startDate ?? source.startDate,
        expectedEndDate: amendments.projectedEndDate ?? source.expectedEndDate,
        actualStartDate: source.actualStartDate, // PRESERVE actual work
        actualEndDate: source.actualEndDate, // PRESERVE actual work

        // BUDGET: UPDATE with amendment
        totalBudget: amendments.totalBudget ?? source.totalBudget,
        priority: source.priority,
        duration: source.duration,

        // PROGRESS: Will be recalculated from cloned tasks
        progress: source.progress,

        // VERSIONING
        versionNumber: source.versionNumber + 1,
        versionLabel: `Version ${source.versionNumber + 1}`,
        versionForkedAt,
        parentProjectId: source.id, // Link to previous version
        rootProjectId: source.rootProjectId ?? source.id, // Link to root

        // STATUS
        status: "DRAFT" as ProjectStatus, // Needs re-approval
        isActive: false,
        isLatestVersion: true, // Only this is latest until approved
        isLocked: false,
        requiresApproval: true,
      },
    });

    console.log(`✅ Created new project version: v${newProject.versionNumber} (${newProject.id})`);

    // Clone the manual organization chart as an independent tree. Parent IDs
    // are remapped to newly created node IDs, never to the old version.
    if (source.orgChart) {
      const db: any = prisma;
      const newChart = await db.projectOrgChart.create({
        data: { projectId: newProject.id, title: source.orgChart.title },
      });
      const nodeIds = new Map<string, string>();
      const pendingNodes = [...source.orgChart.nodes];
      while (pendingNodes.length) {
        const index = pendingNodes.findIndex((node: any) => !node.parentId || nodeIds.has(node.parentId));
        if (index < 0) throw new Error("Source organization chart contains a circular parent relationship");
        const node = pendingNodes.splice(index, 1)[0];
        const clonedNode = await db.projectOrgChartNode.create({
          data: {
            chartId: newChart.id,
            parentId: node.parentId ? nodeIds.get(node.parentId) : null,
            name: node.name,
            position: node.position,
            sortOrder: node.sortOrder,
            x: node.x,
            y: node.y,
            photoUrl: node.photoUrl,
            parentAnchor: node.parentAnchor,
            childAnchor: node.childAnchor,
            backgroundColor: node.backgroundColor,
            textColor: node.textColor,
          },
        });
        nodeIds.set(node.id, clonedNode.id);
      }
    }

    // CLONE SCOPES → TASKS → SUBTASKS (with all progress data)
    // Direct-parent ID -> new-version ID. CPM dependencies must use only the
    // new IDs, keeping every version's network independent.
    const clonedSubtaskIds = new Map<string, string>();

    for (const scope of source.scopes) {
      const newScope = await prisma.scope.create({
        data: {
          name: scope.name,
          sourceType: (scope as any).sourceType,
          scopeMaintenanceId: (scope as any).scopeMaintenanceId,
          description: scope.description,
          progress: scope.progress, // CARRY OVER current progress
          budgetAllocated: scope.budgetAllocated,
          budgetPercent: scope.budgetPercent,
          projectId: newProject.id,
        },
      });

      for (const task of scope.tasks) {
        const newTask = await prisma.task.create({
          data: {
            title: task.title,
            sourceType: (task as any).sourceType,
            taskMaintenanceId: (task as any).taskMaintenanceId,
            description: task.description,
            order: task.order,
            progress: task.progress, // CARRY OVER progress
            budgetAllocated: task.budgetAllocated,
            budgetPercent: task.budgetPercent,
            scopeId: newScope.id,
          },
        });

        // Clone all subtasks with their progress logs
        for (const subtask of task.subtasks) {
          const newSubtask = await (prisma.subtask.create as any)({
            data: {
              title: subtask.title,
              sourceType: (subtask as any).sourceType,
              subtaskMaintenanceId: (subtask as any).subtaskMaintenanceId,
              sourceSubtaskId: subtask.id,
              description: subtask.description,
              order: subtask.order,
              progress: subtask.progress, // CARRY OVER progress
              status: subtask.status, // CARRY OVER kanban status
              priority: subtask.priority,

              // PRESERVE ACTUAL DATES
              projectedStartDate: subtask.projectedStartDate,
              projectedEndDate: subtask.projectedEndDate,
              actualStartDate: subtask.actualStartDate,
              actualEndDate: subtask.actualEndDate,

              budgetAllocated: subtask.budgetAllocated,
              budgetPercent: subtask.budgetPercent,

              createdBy: subtask.createdBy,
              taskId: newTask.id,
            },
          });
          clonedSubtaskIds.set(subtask.id, newSubtask.id);

          // Clone progress logs (audit trail of progress)
          for (const log of subtask.progressLogs) {
            await (prisma.progressLog.create as any)({
              data: {
                subtaskId: newSubtask.id,
                userId: log.userId,
                sourceLogId: log.id,
                date: log.date,
                dailyPercent: log.dailyPercent,
                cumulativePercent: log.cumulativePercent,
                remarks: log.remarks,
                photoUrl: log.photoUrl,
                latitude: log.latitude,
                longitude: log.longitude,
                location: log.location,
                dayNumber: log.dayNumber,
                attachmentUrl: log.attachmentUrl,
              },
            });
          }

          // Clone subtask assignees
          for (const assignee of subtask.assignees) {
            await prisma.subtaskAssignee.create({
              data: {
                subtaskId: newSubtask.id,
                userId: assignee.userId,
              },
            });
          }
        }

        // Clone task assignees
        for (const assignee of task.assignees) {
          await prisma.taskAssignee.create({
            data: {
              taskId: newTask.id,
              userId: assignee.userId,
            },
          });
        }
      }
    }

    console.log(`✅ Cloned ${source.scopes.length} scopes with all tasks & subtasks`);

    // Clone only links whose two endpoints were cloned. If future data ever
    // contains a broken source link, it is skipped rather than crossing versions.
    const cpmDependencies = source.cpmDependencies.flatMap((dependency: any) => {
      const predecessorSubtaskId = clonedSubtaskIds.get(dependency.predecessorSubtaskId);
      const successorSubtaskId = clonedSubtaskIds.get(dependency.successorSubtaskId);
      return predecessorSubtaskId && successorSubtaskId
        ? [{ projectId: newProject.id, predecessorSubtaskId, successorSubtaskId }]
        : [];
    });
    if (cpmDependencies.length) {
      await prisma.cpmDependency.createMany({ data: cpmDependencies });
    }
    console.log(`Cloned ${cpmDependencies.length} CPM dependencies`);

    // CLONE PROJECT MEMBERS (same team)
    for (const member of source.projectMembers) {
      await prisma.projectMember.create({
        data: {
          projectId: newProject.id,
          userId: member.userId,
          role: member.role,
        },
      });
    }

    console.log(`✅ Cloned ${source.projectMembers.length} team members`);

    // CLONE ATTACHMENTS (documents, reports, etc.)
    for (const attachment of source.attachments) {
      await prisma.attachment.create({
        data: {
          fileUrl: attachment.fileUrl,
          fileName: attachment.fileName,
          projectId: newProject.id,
          uploadedBy: attachment.uploadedBy,
        },
      });
    }

    console.log(`✅ Cloned ${source.attachments.length} attachments`);

    // CLONE PROJECT TIMELINES (S-Curve history)
    for (const timeline of source.timelines) {
      await prisma.projectTimeline.create({
        data: {
          projectId: newProject.id,
          date: timeline.date,
          planned: timeline.planned,
          actual: timeline.actual,
          variance: timeline.variance,
          daysAhead: timeline.daysAhead,
        },
      });
    }

    console.log(`✅ Cloned ${source.timelines.length} timeline snapshots`);

    // CLONE DAILY REPORTS
    for (const report of source.dailyReports) {
      await prisma.dailyReport.create({
        data: {
          projectId: newProject.id,
          userId: report.userId,
          dayNumber: report.dayNumber,
          date: report.date,
          location: report.location,
          remarks: report.remarks,
          attachments: report.attachments,
        },
      });
    }

    console.log(`✅ Cloned ${source.dailyReports.length} daily reports`);

    // CLONE WEEKLY REPORTS
    for (const report of source.weeklyReports) {
      await prisma.weeklyReport.create({
        data: {
          projectId: newProject.id,
          userId: report.userId,
          title: report.title,
          dateFrom: report.dateFrom,
          dateTo: report.dateTo,
          remarks: report.remarks,
          attachments: report.attachments,
        },
      });
    }

    console.log(`✅ Cloned ${source.weeklyReports.length} weekly reports`);

    // NOTE: Approval records are NOT cloned
    // v2 starts fresh with DRAFT status and will go through approval flow again

    // Create initial audit log entry
    await prisma.approvalAuditLog.create({
      data: {
        projectId: newProject.id,
        approverId: userId,
        action: "VERSION_CREATED",
        level: "BU_HEAD",
        previousStatus: "DRAFT",
        newStatus: "DRAFT",
        remarks:
          amendments.remarks || `Version created from v${source.versionNumber}`,
      },
    });

    // Notify project owner
    await this.notifyVersionCreated(newProject.id, source.name, source.versionNumber);

    return {
      newProject,
      summary: {
        scopesCloned: source.scopes.length,
        tasksCloned: source.scopes.reduce((sum: number, s: any) => sum + s.tasks.length, 0),
        subtasksCloned: source.scopes.reduce(
          (sum: number, s: any) => sum + s.tasks.reduce((t: number, task: any) => t + task.subtasks.length, 0),
          0
        ),
        teamMembersCloned: source.projectMembers.length,
        attachmentsCloned: source.attachments.length,
        reportsCloned: source.dailyReports.length + source.weeklyReports.length,
        timelinesCloned: source.timelines.length,
      },
    };
  }

  /** Data for the post-activation progress-sync prompt. */
  async getProgressSyncStatus(projectId: string): Promise<any> {
    const db: any = prisma;
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true, name: true, versionNumber: true, status: true, isActive: true,
        parentProjectId: true, versionForkedAt: true, progressSyncedAt: true,
        parentProject: { select: { id: true, versionNumber: true } },
      },
    });
    if (!project) throw new Error("Project not found");
    if (!project.parentProjectId || !project.versionForkedAt) {
      return { project, requiresSync: false, eligible: [], unmatched: [], conflicts: [] };
    }

    const [parentLogs, targetSubtasks]: [any[], any[]] = await Promise.all([
      db.progressLog.findMany({
        where: {
          createdAt: { gte: project.versionForkedAt },
          subtask: { task: { scope: { projectId: project.parentProjectId } } },
        },
        include: { subtask: { select: { id: true, title: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.subtask.findMany({
        where: { task: { scope: { projectId } } },
        select: { id: true, title: true, sourceSubtaskId: true, progressLogs: { select: { sourceLogId: true, date: true, userId: true } } },
      }),
    ]);
    const targetBySourceId = new Map(targetSubtasks
      .filter((subtask: any) => subtask.sourceSubtaskId)
      .map((subtask: any) => [subtask.sourceSubtaskId!, subtask]));
    const alreadyCopied = new Set(targetSubtasks.flatMap((subtask: any) =>
      subtask.progressLogs.map((log: any) => log.sourceLogId).filter(Boolean)));
    const eligible: any[] = [], unmatched: any[] = [], conflicts: any[] = [];

    for (const log of parentLogs) {
      if (alreadyCopied.has(log.id)) continue;
      const item = {
        sourceLogId: log.id, sourceSubtaskId: log.subtaskId, sourceSubtaskTitle: log.subtask.title,
        date: log.date, dailyPercent: Number(log.dailyPercent), userId: log.userId,
      };
      const target = targetBySourceId.get(log.subtaskId);
      if (!target) { unmatched.push({ ...item, reason: "SOURCE_SUBTASK_REMOVED" }); continue; }
      if ((target as any).progressLogs.some((targetLog: any) => targetLog.userId === log.userId && targetLog.date.getTime() === log.date.getTime())) {
        conflicts.push({ ...item, targetSubtaskId: target.id, targetSubtaskTitle: target.title, reason: "TARGET_PROGRESS_ALREADY_EXISTS" });
      } else {
        eligible.push({ ...item, targetSubtaskId: target.id, targetSubtaskTitle: target.title });
      }
    }
    return { project, requiresSync: eligible.length + unmatched.length + conflicts.length > 0, eligible, unmatched, conflicts };
  }

  /** Copies safely matched direct-parent logs. sourceLogId makes retries idempotent. */
  async syncProgressFromParent(projectId: string): Promise<any> {
    const db: any = prisma;
    const status = await this.getProgressSyncStatus(projectId);
    if (!status.project.parentProjectId) throw new Error("This is the first project version; there is no parent progress to sync");
    if (status.project.status !== "ACTIVE" || !status.project.isActive) throw new Error("Progress can only be synced after the new version is active");

    const targetBySourceLogId = new Map(status.eligible.map((item: any) => [item.sourceLogId, item.targetSubtaskId]));
    const logs: any[] = await db.progressLog.findMany({
      where: { id: { in: status.eligible.map((item: any) => item.sourceLogId) } },
      include: { attachments: { orderBy: { sortOrder: "asc" } } },
    });
    const touched = new Set<string>();
    for (const log of logs) {
      const subtaskId = targetBySourceLogId.get(log.id) as string | undefined;
      if (!subtaskId) continue;
      await db.progressLog.create({ data: {
        subtaskId, sourceLogId: log.id, userId: log.userId, date: log.date,
        dailyPercent: log.dailyPercent, cumulativePercent: 0, remarks: log.remarks,
        photoUrl: log.photoUrl, attachmentUrl: log.attachmentUrl, latitude: log.latitude,
        longitude: log.longitude, location: log.location, dayNumber: log.dayNumber,
        attachments: log.attachments.length ? { create: log.attachments.map((attachment: any) => ({
          url: attachment.url, name: attachment.name, mimeType: attachment.mimeType,
          size: attachment.size, sortOrder: attachment.sortOrder,
        })) } : undefined,
      }});
      touched.add(subtaskId);
    }
    for (const subtaskId of touched) await recomputeSubtaskProgress(subtaskId);
    const remaining = await this.getProgressSyncStatus(projectId);
    if (!remaining.requiresSync) await db.project.update({ where: { id: projectId }, data: { progressSyncedAt: new Date() } });
    return {
      syncedLogs: logs.length, syncedSubtasks: touched.size,
      requiresAttention: remaining.unmatched.length + remaining.conflicts.length > 0,
      unmatched: remaining.unmatched, conflicts: remaining.conflicts,
    };
  }

  /**
   * Get full detail of a specific version
   */
  async getVersionDetail(projectId: string): Promise<any> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
        scopes: {
          orderBy: { order: "asc" },
          include: {
            tasks: {
              orderBy: { order: "asc" },
              include: {
                assignees: {
                  include: {
                    user: { select: { id: true, name: true, email: true } },
                  },
                },
                subtasks: {
                  orderBy: { order: "asc" },
                  include: {
                    assignees: {
                      include: {
                        user: { select: { id: true, name: true, email: true } },
                      },
                    },
                    progressLogs: {
                      orderBy: { date: "asc" },
                    },
                  },
                },
              },
            },
          },
        },
        projectMembers: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        timelines: {
          orderBy: { date: "asc" },
        },
        dailyReports: {
          orderBy: { date: "asc" },
        },
        weeklyReports: {
          orderBy: { dateFrom: "asc" },
        },
        attachments: {
          orderBy: { id: "asc" },
        },
        approvals: {
          include: {
            approver: { select: { id: true, name: true, email: true } },
          },
        },
        approvalAuditLogs: {
          orderBy: { createdAt: "asc" },
          include: {
            approver: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!project) {
      throw new Error("Version not found");
    }

    return project;
  }

  /**
   * Get all versions of a project (by PIN)
   */
  async getProjectVersions(pin: string): Promise<any[]> {
    return await prisma.project.findMany({
      where: { pin },
      select: {
        id: true,
        name: true,
        versionNumber: true,
        versionLabel: true,
        status: true,
        isActive: true,
        isLatestVersion: true,
        isLocked: true,
        totalBudget: true,
        expectedEndDate: true,
        progress: true,
        createdAt: true,
      },
      orderBy: { versionNumber: "desc" },
    });
  }

  /**
   * Get version history for a specific project (including root)
   */
  async getVersionHistory(projectId: string): Promise<any[]> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    const rootId = project.rootProjectId ?? project.id;

    return await prisma.project.findMany({
      where: { rootProjectId: rootId },
      select: {
        id: true,
        versionNumber: true,
        versionLabel: true,
        status: true,
        isActive: true,
        isLocked: true,
        totalBudget: true,
        expectedEndDate: true,
        progress: true,
        description: true,
        createdAt: true,
        _count: {
          select: { scopes: true, approvals: true },
        },
      },
      orderBy: { versionNumber: "desc" },
    });
  }

  /**
   * Enhanced Compare: Two versions with Summary + Hierarchical Tree
   * Returns structure-by-structure comparison with change indicators
   */
  async compareVersions(versionId1: string, versionId2: string): Promise<any> {
    const [v1, v2] = await Promise.all([
      prisma.project.findUnique({
        where: { id: versionId1 },
        include: {
          projectMembers: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          approvals: {
            include: {
              approver: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { order: "asc" },
          },
          scopes: {
            orderBy: { order: "asc" },
            include: {
              tasks: {
                orderBy: { order: "asc" },
                include: { subtasks: { orderBy: { order: "asc" } } },
              },
            },
          },
        },
      }),
      prisma.project.findUnique({
        where: { id: versionId2 },
        include: {
          projectMembers: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          approvals: {
            include: {
              approver: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { order: "asc" },
          },
          scopes: {
            orderBy: { order: "asc" },
            include: {
              tasks: {
                orderBy: { order: "asc" },
                include: { subtasks: { orderBy: { order: "asc" } } },
              },
            },
          },
        },
      }),
    ]);

    if (!v1 || !v2) {
      throw new Error("One or both versions not found");
    }

    type ChangeStatus = "ADDED" | "REMOVED" | "MODIFIED" | "UNCHANGED";

    const normalize = (value: string | null | undefined) =>
      (value ?? "").trim().toLowerCase();

    const compareValue = (value: any) => {
      if (value instanceof Date) return value.toISOString();
      return value ?? null;
    };

    const trackFieldChanges = (obj1: any, obj2: any, fields: string[]): string[] => {
      return fields.filter((field) => compareValue(obj1?.[field]) !== compareValue(obj2?.[field]));
    };

    const deriveStatus = (left: any, right: any, changedFields: string[]): ChangeStatus => {
      if (!left && right) return "ADDED";
      if (left && !right) return "REMOVED";
      if (changedFields.length > 0) return "MODIFIED";
      return "UNCHANGED";
    };

    const scopeKey = (scope: any) => normalize(scope.name);
    const taskKey = (task: any) => `${task.order ?? 0}::${normalize(task.title)}`;
    const subtaskKey = (subtask: any) => `${subtask.order ?? 0}::${normalize(subtask.title)}`;

    const mapBy = <T>(items: T[], keyFn: (item: T) => string): Map<string, T> => {
      const map = new Map<string, T>();
      for (const item of items) {
        map.set(keyFn(item), item);
      }
      return map;
    };

    let scopesChanged = 0;
    let tasksChanged = 0;
    let subtasksChanged = 0;

    const scopeFields = ["description", "budgetAllocated", "progress"];
    const taskFields = ["budgetAllocated", "progress"];
    const subtaskFields = ["title", "progress"];

    const buildProjectDetail = (project: any) => ({
      id: project.id,
      versionId: project.id,
      versionNumber: project.versionNumber,
      versionLabel: project.versionLabel,
      name: project.name,
      pin: project.pin,
      status: project.status,
      totalBudget: project.totalBudget,
      progress: project.progress,
      expectedEndDate: project.expectedEndDate,
      members: (project.projectMembers ?? []).map((member: any) => ({
        id: member.user.id,
        name: member.user.name,
        role: member.role,
      })),
      scopes: (project.scopes ?? []).map((scope: any) => ({
        id: scope.id,
        name: scope.name,
        description: scope.description,
        budgetAllocated: scope.budgetAllocated,
        progress: scope.progress,
        tasks: (scope.tasks ?? []).map((task: any) => ({
          id: task.id,
          title: task.title,
          budgetAllocated: task.budgetAllocated,
          progress: task.progress,
          subtasks: (task.subtasks ?? []).map((subtask: any) => ({
            id: subtask.id,
            title: subtask.title,
            progress: subtask.progress,
            projectedStartDate: subtask.projectedStartDate,
            projectedEndDate: subtask.projectedEndDate,
            budgetAllocated: subtask.budgetAllocated,
            budgetPercent: subtask.budgetPercent,
          })),
        })),
      })),
      approvals: (project.approvals ?? []).map((approval: any) => ({
        id: approval.id,
        level: approval.level,
        order: approval.order,
        status: approval.status,
        isFinal: approval.isFinal,
        approver: {
          id: approval.approver?.id,
          name: approval.approver?.name,
        },
        remarks: approval.remarks,
        actedAt: approval.actedAt,
        createdAt: approval.createdAt,
      })),
    });

    const scopesV1ByKey = mapBy(v1.scopes as any[], scopeKey);
    const scopesV2ByKey = mapBy(v2.scopes as any[], scopeKey);
    const scopeKeys = Array.from(new Set([...scopesV1ByKey.keys(), ...scopesV2ByKey.keys()]));

    const scopes = scopeKeys.map((key) => {
      const s1: any = scopesV1ByKey.get(key) ?? null;
      const s2: any = scopesV2ByKey.get(key) ?? null;

      const changedScopeFields = s1 && s2 ? trackFieldChanges(s1, s2, scopeFields) : scopeFields;
      const scopeStatus = deriveStatus(s1, s2, changedScopeFields);
      if (scopeStatus !== "UNCHANGED") scopesChanged++;

      const tasksV1ByKey = mapBy((s1?.tasks ?? []) as any[], taskKey);
      const tasksV2ByKey = mapBy((s2?.tasks ?? []) as any[], taskKey);
      const taskKeys = Array.from(new Set([...tasksV1ByKey.keys(), ...tasksV2ByKey.keys()]));

      const tasks = taskKeys.map((taskCompareKey) => {
        const t1: any = tasksV1ByKey.get(taskCompareKey) ?? null;
        const t2: any = tasksV2ByKey.get(taskCompareKey) ?? null;

        const changedTaskFields = t1 && t2 ? trackFieldChanges(t1, t2, taskFields) : taskFields;
        const taskStatus = deriveStatus(t1, t2, changedTaskFields);
        if (taskStatus !== "UNCHANGED") tasksChanged++;

        const subtasksV1ByKey = mapBy((t1?.subtasks ?? []) as any[], subtaskKey);
        const subtasksV2ByKey = mapBy((t2?.subtasks ?? []) as any[], subtaskKey);
        const subtaskKeys = Array.from(
          new Set([...subtasksV1ByKey.keys(), ...subtasksV2ByKey.keys()])
        );

        const subtasks = subtaskKeys.map((subtaskCompareKey) => {
          const st1: any = subtasksV1ByKey.get(subtaskCompareKey) ?? null;
          const st2: any = subtasksV2ByKey.get(subtaskCompareKey) ?? null;

          const changedSubtaskFields =
            st1 && st2 ? trackFieldChanges(st1, st2, subtaskFields) : subtaskFields;
          const subtaskStatus = deriveStatus(st1, st2, changedSubtaskFields);
          if (subtaskStatus !== "UNCHANGED") subtasksChanged++;

          return {
            id: st2?.id ?? st1?.id,
            title: st2?.title ?? st1?.title,
            changeStatus: subtaskStatus,
            changedFields: changedSubtaskFields,
            v1: st1
              ? {
                  title: st1.title,
                  progress: st1.progress,
                }
              : null,
            v2: st2
              ? {
                  title: st2.title,
                  progress: st2.progress,
                }
              : null,
          };
        });

        return {
          id: t2?.id ?? t1?.id,
          title: t2?.title ?? t1?.title,
          changeStatus: taskStatus,
          changedFields: changedTaskFields,
          v1: t1
            ? {
                budgetAllocated: t1.budgetAllocated,
                progress: t1.progress,
              }
            : null,
          v2: t2
            ? {
                budgetAllocated: t2.budgetAllocated,
                progress: t2.progress,
              }
            : null,
          subtasks,
        };
      });

      return {
        id: s2?.id ?? s1?.id,
        name: s2?.name ?? s1?.name,
        changeStatus: scopeStatus,
        changedFields: changedScopeFields,
        v1: s1
          ? {
              description: s1.description,
              budgetAllocated: s1.budgetAllocated,
              progress: s1.progress,
            }
          : null,
        v2: s2
          ? {
              description: s2.description,
              budgetAllocated: s2.budgetAllocated,
              progress: s2.progress,
            }
          : null,
        tasks,
      };
    });

    return {
      v1Detail: buildProjectDetail(v1),
      v2Detail: buildProjectDetail(v2),
      comparison: {
        summary: {
          scopesChanged,
          tasksChanged,
          subtasksChanged,
          headerChanges: {
            budgetDiff: (v2.totalBudget ?? 0) - (v1.totalBudget ?? 0),
            endDateDiff:
              v2.expectedEndDate && v1.expectedEndDate
                ? Math.ceil(
                    (v2.expectedEndDate.getTime() - v1.expectedEndDate.getTime()) /
                      (1000 * 60 * 60 * 24)
                  )
                : null,
            progressDiff: parseFloat(
              (Number(v2.progress) - Number(v1.progress)).toFixed(2)
            ),
          },
        },
        versions: {
          v1: {
            versionNumber: v1.versionNumber,
            versionLabel: v1.versionLabel,
            status: v1.status,
            totalBudget: v1.totalBudget,
            expectedEndDate: v1.expectedEndDate,
            progress: v1.progress,
          },
          v2: {
            versionNumber: v2.versionNumber,
            versionLabel: v2.versionLabel,
            status: v2.status,
            totalBudget: v2.totalBudget,
            expectedEndDate: v2.expectedEndDate,
            progress: v2.progress,
          },
        },
        scopes,
      },
    };
  }

  /**
   * Get active version for a PIN
   */
  async getActiveVersionByPin(pin: string): Promise<any> {
    return await prisma.project.findFirst({
      where: { pin, isActive: true },
      include: {
        scopes: {
          include: {
            tasks: {
              include: { subtasks: true },
            },
          },
        },
        owner: {
          select: { id: true, name: true, email: true },
        },
        approvals: true,
      },
    });
  }

  /**
   * Delete draft version (if not submitted for approval)
   */
  async deleteDraftVersion(projectId: string): Promise<any> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.status !== "DRAFT") {
      throw new Error("Can only delete draft versions");
    }

    // Some project relations are RESTRICT in schema, so delete dependents first.
    const deleted = await prisma.$transaction(async (tx) => {
      // Break self-references from child versions first (defensive cleanup).
      await tx.project.updateMany({
        where: {
          OR: [{ parentProjectId: projectId }, { rootProjectId: projectId }],
        },
        data: {
          parentProjectId: null,
          rootProjectId: null,
        },
      });

      await tx.projectMember.deleteMany({
        where: { projectId },
      });

      await tx.projectTimeline.deleteMany({
        where: { projectId },
      });

      await tx.dailyReport.deleteMany({
        where: { projectId },
      });

      await tx.weeklyReport.deleteMany({
        where: { projectId },
      });

      const scopeIds = (
        await tx.scope.findMany({
          where: { projectId },
          select: { id: true },
        })
      ).map((scope) => scope.id);

      if (scopeIds.length > 0) {
        const taskIds = (
          await tx.task.findMany({
            where: { scopeId: { in: scopeIds } },
            select: { id: true },
          })
        ).map((task) => task.id);

        if (taskIds.length > 0) {
          const subtaskIds = (
            await tx.subtask.findMany({
              where: { taskId: { in: taskIds } },
              select: { id: true },
            })
          ).map((subtask) => subtask.id);

          if (subtaskIds.length > 0) {
            await tx.activityLog.deleteMany({
              where: { subtaskId: { in: subtaskIds } },
            });

            await tx.comment.deleteMany({
              where: { subtaskId: { in: subtaskIds } },
            });

            await tx.checklist.deleteMany({
              where: { subtaskId: { in: subtaskIds } },
            });

            await tx.subtaskAssignee.deleteMany({
              where: { subtaskId: { in: subtaskIds } },
            });

            await tx.progressLog.deleteMany({
              where: { subtaskId: { in: subtaskIds } },
            });
          }

          await tx.taskAssignee.deleteMany({
            where: { taskId: { in: taskIds } },
          });

          await tx.subtask.deleteMany({
            where: { taskId: { in: taskIds } },
          });

          await tx.task.deleteMany({
            where: { scopeId: { in: scopeIds } },
          });
        }

        await tx.scope.deleteMany({
          where: { projectId },
        });
      }

      return tx.project.delete({
        where: { id: projectId },
      });
    });

    await this.notifyVersionDeleted(deleted.id, deleted.name, deleted.versionNumber);

    return deleted;
  }

  /**
   * Private: Notify about version creation
   */
  private async notifyVersionCreated(
    projectId: string,
    projectName: string,
    previousVersion: number
  ): Promise<void> {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) return;

      await prisma.notification.create({
        data: {
          userId: project.ownerId,
          type: "VERSION_CREATED",
          message: `New version v${previousVersion + 1} of "${projectName}" created. All previous data (progress, reports, team) has been carried forward.`,
          isRead: false,
        },
      });
    } catch (error) {
      console.error("Failed to create notification:", error);
    }
  }

  /**
   * Private: Notify about version deletion
   */
  private async notifyVersionDeleted(
    projectId: string,
    projectName: string,
    versionNumber: number
  ): Promise<void> {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) return;

      await prisma.notification.create({
        data: {
          userId: project.ownerId,
          type: "VERSION_DELETED",
          message: `Draft version v${versionNumber} of "${projectName}" has been deleted.`,
          isRead: false,
        },
      });
    } catch (error) {
      console.error("Failed to create notification:", error);
    }
  }
}

export const versioningService = new VersioningService();
