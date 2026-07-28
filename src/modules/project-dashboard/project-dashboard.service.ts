import prisma from "../../config/prisma";
import { getSCurve } from "../progress/scurve.service";
import {
  CreateDashboardKpiDTO,
  CreateDashboardNoteDTO,
  KpiThresholdDTO,
  SourcePreviewQueryDTO,
  UpdateDashboardNoteDTO,
  UpdateDashboardNoteItemDTO,
  UpdateDashboardKpiDTO,
} from "./project-dashboard.dto";
import {
  buildProgressPreview,
  detectSourceType,
  evaluateProgressStatus,
  validateProgressThresholds,
} from "./project-dashboard.kpi";

export class ProjectDashboardService {
  async get(projectId: string, userId: string) {
    const project = await this.ensureProjectAccess(projectId, userId);
    const [kpis, defaultSubtaskKpi] = await Promise.all([
      (prisma as any).dashboardKpi.findMany({
        where: { projectId },
        include: { thresholds: true },
        orderBy: { createdAt: "asc" },
      }),
      this.getSubtaskKpi(projectId, userId),
    ]);

    return this.enrichDashboard({ project, kpis, defaultSubtaskKpi });
  }

  async getSourceOptions(projectId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        scopes: {
          orderBy: { order: "asc" },
          include: {
            tasks: {
              orderBy: { order: "asc" },
              include: {
                subtasks: { orderBy: { order: "asc" } },
              },
            },
          },
        },
      },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    return {
      project: {
        id: project.id,
        name: project.name,
        progress: Number((project.progress || 0).toFixed(2)),
        expectedStartDate: project.startDate,
        expectedEndDate: project.expectedEndDate,
      },
      fieldOptions: [{ field: "PROGRESS", unit: "%", label: "Progress" }],
      scopes: project.scopes.map((scope: any) => {
        // Calculate date range for scope from its subtasks
        const allSubtasks = scope.tasks.flatMap((t: any) => t.subtasks);
        const scopeDates = this.computeDateRange(allSubtasks);

        return {
          id: scope.id,
          name: scope.name,
          progress: Number((scope.progress || 0).toFixed(2)),
          expectedStartDate: scopeDates.expectedStartDate,
          expectedEndDate: scopeDates.expectedEndDate,
          tasks: scope.tasks.map((task: any) => {
            // Calculate date range for task from its subtasks
            const taskDates = this.computeDateRange(task.subtasks);

            return {
              id: task.id,
              title: task.title,
              progress: Number((task.progress || 0).toFixed(2)),
              expectedStartDate: taskDates.expectedStartDate,
              expectedEndDate: taskDates.expectedEndDate,
              subtasks: task.subtasks.map((subtask: any) => ({
                id: subtask.id,
                title: subtask.title,
                progress: Number((subtask.progress || 0).toFixed(2)),
                expectedStartDate: subtask.projectedStartDate,
                expectedEndDate: subtask.projectedEndDate,
              })),
            };
          }),
        };
      }),
    };
  }

  async previewSource(projectId: string, userId: string, query: SourcePreviewQueryDTO) {
    await this.ensureProjectAccess(projectId, userId);
    const sourceInput = {
      projectId,
      scopeId: query.scopeId,
      taskId: query.taskId,
      subtaskId: query.subtaskId,
    };

    if (query.projectId && query.projectId !== projectId) {
      throw new Error("KPI project must match route project");
    }

    await this.validateSourceHierarchy(sourceInput.projectId, sourceInput);
    const sourceType = detectSourceType(sourceInput);
    const [progress, dates] = await Promise.all([
      this.getProgressValue(sourceType, sourceInput),
      this.getDateRange(sourceType, sourceInput),
    ]);

    return buildProgressPreview(sourceType, progress, dates.expectedStartDate, dates.expectedEndDate);
  }

  async createKpi(projectId: string, userId: string, dto: CreateDashboardKpiDTO) {
    await this.ensureProjectAccess(projectId, userId);
    this.validateKpiInput(dto);
    const thresholdRules = this.resolveThresholdRules(dto, true)!;

    const sourceInput = {
      projectId,
      scopeId: dto.scopeId,
      taskId: dto.taskId,
      subtaskId: dto.subtaskId,
    };

    await this.validateSourceHierarchy(projectId, sourceInput);
    const sourceType = detectSourceType(sourceInput);

    const kpi = await (prisma as any).dashboardKpi.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        unit: "%",
        field: "PROGRESS",
        sourceType,
        projectId,
        scopeId: dto.scopeId || null,
        taskId: dto.taskId || null,
        subtaskId: dto.subtaskId || null,
        thresholds: {
          create: thresholdRules.map((rule) => ({
            status: rule.status,
            operator: rule.operator,
            value1: rule.value1,
            value2: rule.operator === "BETWEEN" ? rule.value2 : null,
            dateOperator: rule.dateOperator || null,
            dateValue1: this.toIsoDate((rule as any).dateValue1 ?? (rule as any).date1),
            dateValue2: rule.dateOperator === "BETWEEN"
              ? this.toIsoDate((rule as any).dateValue2 ?? (rule as any).date2)
              : null,
          })),
        },
      },
      include: { thresholds: true },
    });

    return this.enrichKpi(kpi);
  }

  async updateKpi(
    projectId: string,
    kpiId: string,
    userId: string,
    dto: UpdateDashboardKpiDTO
  ) {
    await this.ensureProjectAccess(projectId, userId);
    const existing = await this.findKpi(projectId, kpiId);

    if (dto.name !== undefined && dto.name.trim().length < 2) {
      throw new Error("KPI name must be at least 2 characters");
    }

    const thresholdRules = this.resolveThresholdRules(dto, false);

    const sourceInput = {
      projectId,
      scopeId: dto.scopeId === undefined ? existing.scopeId : dto.scopeId || undefined,
      taskId: dto.taskId === undefined ? existing.taskId : dto.taskId || undefined,
      subtaskId: dto.subtaskId === undefined ? existing.subtaskId : dto.subtaskId || undefined,
    };

    await this.validateSourceHierarchy(projectId, sourceInput);
    const sourceType = detectSourceType(sourceInput);

    const kpi = await (prisma as any).$transaction(async (tx: any) => {
      if (thresholdRules) {
        await tx.kpiThresholdRule.deleteMany({ where: { kpiId } });
      }

      return tx.dashboardKpi.update({
        where: { id: kpiId },
        data: {
          name: dto.name === undefined ? undefined : dto.name.trim(),
          description:
            dto.description === undefined ? undefined : dto.description?.trim() || null,
          sourceType,
          scopeId: sourceInput.scopeId || null,
          taskId: sourceInput.taskId || null,
          subtaskId: sourceInput.subtaskId || null,
          thresholds: thresholdRules
            ? {
                create: thresholdRules.map((rule) => ({
                  status: rule.status,
                  operator: rule.operator,
                  value1: rule.value1,
                  value2: rule.operator === "BETWEEN" ? rule.value2 : null,
                  dateOperator: rule.dateOperator || null,
                  dateValue1: this.toIsoDate((rule as any).dateValue1 ?? (rule as any).date1),
                  dateValue2: rule.dateOperator === "BETWEEN"
                    ? this.toIsoDate((rule as any).dateValue2 ?? (rule as any).date2)
                    : null,
                })),
              }
            : undefined,
        },
        include: { thresholds: true },
      });
    });

    return this.enrichKpi(kpi);
  }

  async deleteKpi(projectId: string, kpiId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId);
    await this.findKpi(projectId, kpiId);
    await (prisma as any).dashboardKpi.delete({ where: { id: kpiId } });

    return { id: kpiId };
  }

  async getSubtaskKpiConfig(projectId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId);
    const config = await (prisma as any).projectSubtaskKpiConfig.findUnique({
      where: { projectId },
      include: {
        updatedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return config
      ? {
          projectId,
          criticalBelow: config.criticalBelow,
          healthyAtOrAbove: config.healthyAtOrAbove,
          isCustom: true,
          updatedAt: config.updatedAt,
          updatedBy: config.updatedBy,
        }
      : {
          projectId,
          criticalBelow: -15,
          healthyAtOrAbove: -5,
          isCustom: false,
          updatedAt: null,
          updatedBy: null,
        };
  }

  async updateSubtaskKpiConfig(
    projectId: string,
    userId: string,
    dto: { criticalBelow: number; healthyAtOrAbove: number }
  ) {
    await this.ensureSubtaskKpiConfigAccess(projectId, userId);
    const criticalBelow = Number(dto.criticalBelow);
    const healthyAtOrAbove = Number(dto.healthyAtOrAbove);

    if (!Number.isFinite(criticalBelow) || !Number.isFinite(healthyAtOrAbove)) {
      throw new Error("criticalBelow and healthyAtOrAbove must be valid numbers");
    }
    if (criticalBelow < -100 || criticalBelow > 100) {
      throw new Error("criticalBelow must be between -100 and 100");
    }
    if (healthyAtOrAbove < -100 || healthyAtOrAbove > 100) {
      throw new Error("healthyAtOrAbove must be between -100 and 100");
    }
    if (criticalBelow >= healthyAtOrAbove) {
      throw new Error("criticalBelow must be less than healthyAtOrAbove");
    }

    await (prisma as any).projectSubtaskKpiConfig.upsert({
      where: { projectId },
      update: { criticalBelow, healthyAtOrAbove, updatedById: userId },
      create: {
        projectId,
        criticalBelow,
        healthyAtOrAbove,
        updatedById: userId,
      },
    });

    return this.getSubtaskKpiConfig(projectId, userId);
  }

  async resetSubtaskKpiConfig(projectId: string, userId: string) {
    await this.ensureSubtaskKpiConfigAccess(projectId, userId);
    await (prisma as any).projectSubtaskKpiConfig.deleteMany({
      where: { projectId },
    });
    return this.getSubtaskKpiConfig(projectId, userId);
  }

  async getSubtaskKpi(projectId: string, userId: string) {
    const project = await this.ensureProjectAccess(projectId, userId);
    const config = await this.getSubtaskKpiConfig(projectId, userId);
    const [subtasks, configuredKpiRecords] = await Promise.all([
      prisma.subtask.findMany({
        where: {
          deletedAt: null,
          task: {
            deletedAt: null,
            scope: {
              projectId,
              deletedAt: null,
            },
          },
        },
        select: {
          id: true,
          title: true,
          progress: true,
          projectedStartDate: true,
          projectedEndDate: true,
          task: {
            select: {
              id: true,
              title: true,
              scope: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ task: { order: "asc" } }, { order: "asc" }],
      }),
      (prisma as any).dashboardKpi.findMany({
        where: { projectId },
        include: { thresholds: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const now = new Date();
    const configuredKpis = await Promise.all(
      configuredKpiRecords.map((kpi: any) => this.enrichKpi(kpi))
    );
    const configuredKpiSummary = {
      total: configuredKpis.length,
      critical: configuredKpis.filter((kpi) => kpi.status === "CRITICAL").length,
      onflow: configuredKpis.filter((kpi) => kpi.status === "ONFLOW").length,
      healthy: configuredKpis.filter((kpi) => kpi.status === "HEALTHY").length,
      unclassified: configuredKpis.filter((kpi) => kpi.status === "UNCLASSIFIED").length,
    };
    const evaluated = subtasks.map((subtask) => {
      const actualProgress = this.roundNumber(subtask.progress || 0, 2);
      const expectedProgress = this.getExpectedSubtaskProgress(
        now,
        subtask.projectedStartDate,
        subtask.projectedEndDate
      );
      const variance =
        expectedProgress === null
          ? null
          : this.roundNumber(actualProgress - expectedProgress, 2);

      let status: "CRITICAL" | "ONFLOW" | "HEALTHY" | "UNCLASSIFIED";
      if (actualProgress >= 100) {
        status = "HEALTHY";
      } else if (variance === null) {
        status = "UNCLASSIFIED";
      } else if (variance < config.criticalBelow) {
        status = "CRITICAL";
      } else if (variance >= config.healthyAtOrAbove) {
        status = "HEALTHY";
      } else {
        status = "ONFLOW";
      }

      return {
        id: subtask.id,
        title: subtask.title,
        scope: subtask.task.scope,
        task: {
          id: subtask.task.id,
          title: subtask.task.title,
        },
        actualProgress,
        expectedProgress,
        variance,
        projectedStartDate: subtask.projectedStartDate,
        projectedEndDate: subtask.projectedEndDate,
        status,
      };
    });
    const subtaskSummary = {
      total: evaluated.length,
      critical: evaluated.filter((item) => item.status === "CRITICAL").length,
      onflow: evaluated.filter((item) => item.status === "ONFLOW").length,
      healthy: evaluated.filter((item) => item.status === "HEALTHY").length,
      unclassified: evaluated.filter((item) => item.status === "UNCLASSIFIED").length,
    };

    return {
      project: { id: project.id, name: project.name },
      config,
      summary: {
        total: subtaskSummary.total + configuredKpiSummary.total,
        critical: subtaskSummary.critical + configuredKpiSummary.critical,
        onflow: subtaskSummary.onflow + configuredKpiSummary.onflow,
        healthy: subtaskSummary.healthy + configuredKpiSummary.healthy,
        unclassified:
          subtaskSummary.unclassified + configuredKpiSummary.unclassified,
        subtasks: subtaskSummary,
        configuredKpis: configuredKpiSummary,
      },
      subtasks: evaluated,
      generatedAt: now.toISOString(),
    };
  }

  async listNotes(userId: string) {
    return await (prisma as any).dashboardNote.findMany({
      where: { userId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
  }

  async createNote(userId: string, dto: CreateDashboardNoteDTO) {
    const note = await (prisma as any).dashboardNote.create({
      data: {
        userId,
        title: dto.title?.trim() || null,
        content: dto.content?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        items: dto.items?.length
          ? {
              create: dto.items.map((item, index) => ({
                text: item.text.trim(),
                isDone: !!item.isDone,
                sortOrder: item.sortOrder ?? index,
              })),
            }
          : undefined,
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    return note;
  }

  async updateNote(
    noteId: string,
    userId: string,
    dto: UpdateDashboardNoteDTO
  ) {
    await this.findNote(userId, noteId);

    const note = await (prisma as any).dashboardNote.update({
      where: { id: noteId },
      data: {
        title: dto.title === undefined ? undefined : dto.title?.trim() || null,
        content: dto.content === undefined ? undefined : dto.content?.trim() || null,
        sortOrder: dto.sortOrder,
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    return note;
  }

  async deleteNote(noteId: string, userId: string) {
    await this.findNote(userId, noteId);

    await (prisma as any).dashboardNote.delete({ where: { id: noteId } });
    return { id: noteId };
  }

  async addNoteItem(
    noteId: string,
    userId: string,
    dto: { text: string; isDone?: boolean; sortOrder?: number }
  ) {
    await this.findNote(userId, noteId);

    if (!dto.text || dto.text.trim().length === 0) {
      throw new Error("Checklist item text is required");
    }

    const item = await (prisma as any).dashboardNoteItem.create({
      data: {
        noteId,
        text: dto.text.trim(),
        isDone: !!dto.isDone,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    return item;
  }

  async updateNoteItem(
    noteId: string,
    itemId: string,
    userId: string,
    dto: UpdateDashboardNoteItemDTO
  ) {
    await this.findNote(userId, noteId);
    await this.findNoteItem(noteId, itemId);

    const item = await (prisma as any).dashboardNoteItem.update({
      where: { id: itemId },
      data: {
        text: dto.text === undefined ? undefined : dto.text.trim(),
        isDone: dto.isDone,
        sortOrder: dto.sortOrder,
      },
    });

    return item;
  }

  async deleteNoteItem(noteId: string, itemId: string, userId: string) {
    await this.findNote(userId, noteId);
    await this.findNoteItem(noteId, itemId);

    await (prisma as any).dashboardNoteItem.delete({ where: { id: itemId } });
    return { id: itemId };
  }

  async getChartData(projectId: string, userId: string) {
    const enriched = await this.get(projectId, userId);
    const scurve = await getSCurve(projectId).catch(() => null);
    const reportTable = scurve ? await this.buildReportTable(projectId, scurve.data) : null;

    return {
      summary: enriched.summary,
      scurve,
      progressTrend: scurve?.data || [],
      reportTable,
      kpiStatusDistribution: enriched.summary,
      taskCompletion: await this.getTaskCompletion(projectId),
      defaultSubtaskKpi: enriched.defaultSubtaskKpi,
    };
  }

  async getReportTable(projectId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId);
    const scurve = await getSCurve(projectId);

    return this.buildReportTable(projectId, scurve.data);
  }

  private async enrichDashboard(dashboard: any) {
    const kpis = await Promise.all((dashboard.kpis || []).map((kpi: any) => this.enrichKpi(kpi)));
    const configuredKpis = {
      total: kpis.length,
      critical: kpis.filter((kpi) => kpi.status === "CRITICAL").length,
      onflow: kpis.filter((kpi) => kpi.status === "ONFLOW").length,
      healthy: kpis.filter((kpi) => kpi.status === "HEALTHY").length,
      unclassified: kpis.filter((kpi) => kpi.status === "UNCLASSIFIED").length,
    };
    const summary = {
      totalKpis: configuredKpis.total,
      criticalKpis: configuredKpis.critical,
      onflowKpis: configuredKpis.onflow,
      healthyKpis: configuredKpis.healthy,
      unclassifiedKpis: configuredKpis.unclassified,
      configuredKpis,
    };

    return {
      ...dashboard,
      kpis,
      summary,
    };
  }

  private async enrichKpi(kpi: any) {
    const thresholds = kpi.thresholds.map((rule: any) => ({
      status: rule.status,
      operator: rule.operator,
      value1: rule.value1,
      value2: rule.value2,
      dateOperator: rule.dateOperator || null,
      dateValue1: rule.dateValue1 || null,
      dateValue2: rule.dateValue2 || null,
    }));
    const progress = await this.getProgressValue(kpi.sourceType, kpi);
    const status = evaluateProgressStatus(progress, thresholds as KpiThresholdDTO[]);

    // Enrich with source details (name/title and calculated dates)
    const sourceDetails = await this.getSourceDetails(kpi);

    return {
      ...kpi,
      thresholds,
      thresholdConfig: this.getSimplifiedThresholdConfig(thresholds),
      currentValue: Number(progress.toFixed(2)),
      preview: buildProgressPreview(kpi.sourceType, progress),
      status,
      sourceDetails,
    };
  }

  private async getSourceDetails(kpi: any) {
    const sourceType = kpi.sourceType;

    if (sourceType === "SUBTASK") {
      const subtask = await prisma.subtask.findUnique({
        where: { id: kpi.subtaskId },
        select: { title: true, projectedStartDate: true, projectedEndDate: true },
      });
      return subtask
        ? {
            title: subtask.title,
            expectedStartDate: subtask.projectedStartDate,
            expectedEndDate: subtask.projectedEndDate,
          }
        : null;
    }

    if (sourceType === "TASK") {
      const task = await prisma.task.findUnique({
        where: { id: kpi.taskId },
        select: { title: true },
      });

      if (!task) return null;

      // Calculate dates from task's subtasks
      const subtasks = await prisma.subtask.findMany({
        where: { taskId: kpi.taskId },
        select: { projectedStartDate: true, projectedEndDate: true },
      });

      const starts = subtasks
        .map((s) => s.projectedStartDate)
        .filter(Boolean) as Date[];
      const ends = subtasks.map((s) => s.projectedEndDate).filter(Boolean) as Date[];

      return {
        title: task.title,
        expectedStartDate:
          starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
        expectedEndDate:
          ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
      };
    }

    if (sourceType === "SCOPE") {
      const scope = await prisma.scope.findUnique({
        where: { id: kpi.scopeId },
        select: { name: true },
      });

      if (!scope) return null;

      // Calculate dates from scope's subtasks
      const subtasks = await prisma.subtask.findMany({
        where: { task: { scopeId: kpi.scopeId } },
        select: { projectedStartDate: true, projectedEndDate: true },
      });

      const starts = subtasks
        .map((s) => s.projectedStartDate)
        .filter(Boolean) as Date[];
      const ends = subtasks.map((s) => s.projectedEndDate).filter(Boolean) as Date[];

      return {
        title: scope.name,
        expectedStartDate:
          starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
        expectedEndDate:
          ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
      };
    }

    // PROJECT
    const project = await prisma.project.findUnique({
      where: { id: kpi.projectId },
      select: { name: true, startDate: true, expectedEndDate: true },
    });

    return project
      ? {
          title: project.name,
          expectedStartDate: project.startDate,
          expectedEndDate: project.expectedEndDate,
        }
      : null;
  }

  private async findKpi(projectId: string, kpiId: string) {
    const kpi = await (prisma as any).dashboardKpi.findFirst({
      where: { id: kpiId, projectId },
      include: { thresholds: true },
    });

    if (!kpi) {
      throw new Error("KPI not found");
    }

    return kpi;
  }

  private async findNote(userId: string, noteId: string) {
    const note = await (prisma as any).dashboardNote.findFirst({
      where: { id: noteId, userId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    if (!note) {
      throw new Error("Note not found");
    }

    return note;
  }

  private async findNoteItem(noteId: string, itemId: string) {
    const item = await (prisma as any).dashboardNoteItem.findFirst({
      where: { id: itemId, noteId },
    });

    if (!item) {
      throw new Error("Checklist item not found");
    }

    return item;
  }

  private validateKpiInput(dto: CreateDashboardKpiDTO) {
    if (!dto.name || dto.name.trim().length < 2) {
      throw new Error("KPI name must be at least 2 characters");
    }

    if (dto.field && dto.field !== "PROGRESS") {
      throw new Error("Only progress KPIs are supported for now");
    }

  }

  private resolveThresholdRules(
    dto: {
      criticalBelow?: number;
      healthyAtOrAbove?: number;
      thresholds?: KpiThresholdDTO[];
    },
    required: boolean
  ): KpiThresholdDTO[] | undefined {
    const usesSimplifiedThresholds =
      dto.criticalBelow !== undefined || dto.healthyAtOrAbove !== undefined;

    if (usesSimplifiedThresholds && dto.thresholds !== undefined) {
      throw new Error(
        "Use criticalBelow and healthyAtOrAbove or thresholds, not both"
      );
    }

    if (usesSimplifiedThresholds) {
      const criticalBelow = Number(dto.criticalBelow);
      const healthyAtOrAbove = Number(dto.healthyAtOrAbove);

      if (!Number.isFinite(criticalBelow) || !Number.isFinite(healthyAtOrAbove)) {
        throw new Error("criticalBelow and healthyAtOrAbove are required");
      }
      if (
        criticalBelow < 0 ||
        criticalBelow > 100 ||
        healthyAtOrAbove < 0 ||
        healthyAtOrAbove > 100
      ) {
        throw new Error("KPI thresholds must be between 0 and 100");
      }
      if (criticalBelow >= healthyAtOrAbove) {
        throw new Error("criticalBelow must be less than healthyAtOrAbove");
      }

      return [
        {
          status: "CRITICAL",
          operator: "LT",
          value1: criticalBelow,
        },
        {
          status: "ONFLOW",
          operator: "BETWEEN",
          value1: criticalBelow,
          value2: healthyAtOrAbove,
        },
        {
          status: "HEALTHY",
          operator: "GTE",
          value1: healthyAtOrAbove,
        },
      ];
    }

    if (dto.thresholds !== undefined) {
      validateProgressThresholds(dto.thresholds);
      return dto.thresholds;
    }

    if (required) {
      throw new Error("criticalBelow and healthyAtOrAbove are required");
    }
    return undefined;
  }

  private getSimplifiedThresholdConfig(thresholds: KpiThresholdDTO[]) {
    const critical = thresholds.find(
      (rule) => rule.status === "CRITICAL" && rule.operator === "LT"
    );
    const healthy = thresholds.find(
      (rule) => rule.status === "HEALTHY" && rule.operator === "GTE"
    );
    if (!critical || !healthy) return null;
    return {
      criticalBelow: critical.value1,
      healthyAtOrAbove: healthy.value1,
      onflow: {
        minimumInclusive: critical.value1,
        maximumExclusive: healthy.value1,
      },
    };
  }

  private async ensureProjectAccess(projectId: string, userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    const hasGlobalProjectAccess =
      user?.role?.name === "SUPERADMIN" || user?.role?.name === "OP";

    const project = await prisma.project.findFirst({
      where:
        hasGlobalProjectAccess
          ? { id: projectId }
          : {
              id: projectId,
              OR: [
                { ownerId: userId },
                { projectMembers: { some: { userId } } },
              ],
            },
    });

    if (!project) {
      throw new Error("Project not found or access denied");
    }

    return project;
  }

  private async ensureSubtaskKpiConfigAccess(projectId: string, userId: string) {
    const project = await this.ensureProjectAccess(projectId, userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (user?.role?.name === "SUPERADMIN" || project.ownerId === userId) return;

    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (membership?.role !== "SUB_OWNER") {
      throw new Error(
        "Only the project owner, sub-owner, or superadmin can update Subtask KPI thresholds"
      );
    }
  }

  private getExpectedSubtaskProgress(
    now: Date,
    startDate: Date | null,
    endDate: Date | null
  ) {
    if (!startDate || !endDate) return null;
    const start = startDate.getTime();
    const end = endDate.getTime();
    const current = now.getTime();
    if (current <= start) return 0;
    if (current >= end) return 100;
    if (end <= start) return current >= end ? 100 : 0;
    return this.roundNumber(((current - start) / (end - start)) * 100, 2);
  }

  private async validateSourceHierarchy(
    projectId: string,
    input: {
      scopeId?: string | null;
      taskId?: string | null;
      subtaskId?: string | null;
    }
  ) {
    if (!projectId) {
      throw new Error("Project is required");
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new Error("Project not found");
    }

    if (input.scopeId) {
      const scope = await prisma.scope.findFirst({
        where: { id: input.scopeId, projectId },
      });

      if (!scope) {
        throw new Error("Scope does not belong to selected project");
      }
    }

    if (input.taskId) {
      if (!input.scopeId) {
        throw new Error("Scope is required when task is selected");
      }

      const task = await prisma.task.findFirst({
        where: { id: input.taskId, scopeId: input.scopeId },
      });

      if (!task) {
        throw new Error("Task does not belong to selected scope");
      }
    }

    if (input.subtaskId) {
      if (!input.taskId) {
        throw new Error("Task is required when subtask is selected");
      }

      const subtask = await prisma.subtask.findFirst({
        where: { id: input.subtaskId, taskId: input.taskId },
      });

      if (!subtask) {
        throw new Error("Subtask does not belong to selected task");
      }
    }
  }

  private computeDateRange(
    subtasks: any[]
  ): { expectedStartDate: Date | null; expectedEndDate: Date | null } {
    if (!subtasks || subtasks.length === 0) {
      return { expectedStartDate: null, expectedEndDate: null };
    }

    const starts = subtasks
      .map((s) => s.projectedStartDate)
      .filter(Boolean) as Date[];
    const ends = subtasks.map((s) => s.projectedEndDate).filter(Boolean) as Date[];

    return {
      expectedStartDate:
        starts.length > 0
          ? new Date(Math.min(...starts.map((d) => d.getTime())))
          : null,
      expectedEndDate:
        ends.length > 0
          ? new Date(Math.max(...ends.map((d) => d.getTime())))
          : null,
    };
  }

  private toIsoDate(value: unknown): string | null {
    if (!value) return null;
    try {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) return null;
      return date.toISOString();
    } catch {
      return null;
    }
  }

  private async getDateRange(
    sourceType: string,
    input: any
  ): Promise<{ expectedStartDate: Date | null; expectedEndDate: Date | null }> {
    if (sourceType === "SUBTASK") {
      const subtask = await prisma.subtask.findUnique({
        where: { id: input.subtaskId },
        select: { projectedStartDate: true, projectedEndDate: true },
      });
      return {
        expectedStartDate: subtask?.projectedStartDate ?? null,
        expectedEndDate: subtask?.projectedEndDate ?? null,
      };
    }

    if (sourceType === "TASK") {
      const subtasks = await prisma.subtask.findMany({
        where: { taskId: input.taskId },
        select: { projectedStartDate: true, projectedEndDate: true },
      });
      const starts = subtasks.map((s) => s.projectedStartDate).filter(Boolean) as Date[];
      const ends = subtasks.map((s) => s.projectedEndDate).filter(Boolean) as Date[];
      return {
        expectedStartDate: starts.length
          ? new Date(Math.min(...starts.map((d) => d.getTime())))
          : null,
        expectedEndDate: ends.length
          ? new Date(Math.max(...ends.map((d) => d.getTime())))
          : null,
      };
    }

    if (sourceType === "SCOPE") {
      const subtasks = await prisma.subtask.findMany({
        where: { task: { scopeId: input.scopeId } },
        select: { projectedStartDate: true, projectedEndDate: true },
      });
      const starts = subtasks.map((s) => s.projectedStartDate).filter(Boolean) as Date[];
      const ends = subtasks.map((s) => s.projectedEndDate).filter(Boolean) as Date[];
      return {
        expectedStartDate: starts.length
          ? new Date(Math.min(...starts.map((d) => d.getTime())))
          : null,
        expectedEndDate: ends.length
          ? new Date(Math.max(...ends.map((d) => d.getTime())))
          : null,
      };
    }

    // PROJECT
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { startDate: true, expectedEndDate: true },
    });
    return {
      expectedStartDate: project?.startDate ?? null,
      expectedEndDate: project?.expectedEndDate ?? null,
    };
  }

  private async getProgressValue(sourceType: string, input: any) {
    if (sourceType === "SUBTASK") {
      const subtask = await prisma.subtask.findUnique({ where: { id: input.subtaskId } });
      if (!subtask) throw new Error("Subtask not found");
      return subtask.progress || 0;
    }

    if (sourceType === "TASK") {
      const task = await prisma.task.findUnique({ where: { id: input.taskId } });
      if (!task) throw new Error("Task not found");
      return task.progress || 0;
    }

    if (sourceType === "SCOPE") {
      const scope = await prisma.scope.findUnique({ where: { id: input.scopeId } });
      if (!scope) throw new Error("Scope not found");
      return scope.progress || 0;
    }

    const project = await prisma.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new Error("Project not found");
    return project.progress || 0;
  }

  private async getTaskCompletion(projectId: string) {
    const subtasks = await prisma.subtask.findMany({
      where: {
        deletedAt: null,
        task: {
          deletedAt: null,
          scope: {
            projectId,
            deletedAt: null,
          },
        },
      },
      select: { status: true, progress: true },
    });

    // Status mapping in the codebase is primarily 0=pending, 1=ongoing, 2=completed.
    // Some historical data may use 3 as completed, so we treat both 2 and 3 as completed.
    const completed = subtasks.filter(
      (subtask) => subtask.progress >= 100 || subtask.status === 2 || subtask.status === 3
    ).length;

    const ongoing = subtasks.filter(
      (subtask) =>
        !(subtask.progress >= 100 || subtask.status === 2 || subtask.status === 3) &&
        (subtask.status === 1 || (subtask.progress > 0 && subtask.progress < 100))
    ).length;

    const pending = Math.max(0, subtasks.length - completed - ongoing);

    return {
      completed,
      ongoing,
      pending,
      total: subtasks.length,
    };
  }

  private async buildReportTable(
    projectId: string,
    scurveData: Array<{ date: string; planned: number; actual: number }>
  ) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        totalBudget: true,
        startDate: true,
        expectedEndDate: true,
      },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    const points = [...scurveData].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const columns = points.map((point, index) => ({
      index: index + 1,
      label: String(index + 1),
      date: point.date,
      weekNumber: Math.floor(index / 7) + 1,
    }));
    const weekGroups = this.buildWeekGroups(columns);
    const totalBudget = project.totalBudget || 0;
    const averageDailyPlan = points.length > 0 ? 100 / points.length : 0;

    const plannedDailyValues = points.map((point, index) =>
      this.roundPercent(point.planned - (points[index - 1]?.planned || 0))
    );
    const actualDailyValues = points.map((point, index) =>
      this.roundPercent(point.actual - (points[index - 1]?.actual || 0))
    );
    const plannedCumulativeValues = points.map((point) => this.roundPercent(point.planned));
    const actualCumulativeValues = points.map((point) => this.roundPercent(point.actual));
    const varianceValues = points.map((point) => this.roundPercent(point.actual - point.planned));
    const daysValues = varianceValues.map((variance) =>
      averageDailyPlan > 0 ? this.roundNumber(variance / averageDailyPlan, 2) : 0
    );

    const weeklyPlanned = this.sumValuesByWeek(plannedDailyValues, columns);
    const weeklyActual = this.sumValuesByWeek(actualDailyValues, columns);
    const cumulativeWeeklyPlanned = this.cumulativeValues(weeklyPlanned);
    const cumulativeWeeklyActual = this.cumulativeValues(weeklyActual);

    return {
      project: {
        id: project.id,
        name: project.name,
        totalBudget,
        startDate: project.startDate,
        expectedEndDate: project.expectedEndDate,
      },
      columns,
      weekGroups,
      summaryRows: [
        this.buildWeeklyRow(
          "weeklyAccomplishment",
          "WEEKLY % ACCOMPLISHMENT",
          weeklyPlanned,
          "percent"
        ),
        this.buildWeeklyRow(
          "weeklyCashFlow",
          "WEEKLY CASH FLOW",
          weeklyPlanned.map((value) => (value / 100) * totalBudget),
          "currency"
        ),
        this.buildWeeklyRow(
          "cumulativeWeeklyCashFlow",
          "CUMULATIVE WEEKLY CASH FLOW",
          cumulativeWeeklyPlanned.map((value) => (value / 100) * totalBudget),
          "currency"
        ),
        this.buildWeeklyRow(
          "actualWeeklyCashFlow",
          "ACTUAL WEEKLY CASH FLOW",
          weeklyActual.map((value) => (value / 100) * totalBudget),
          "currency"
        ),
        this.buildWeeklyRow(
          "cumulativeActualWeeklyCashFlow",
          "CUMULATIVE ACTUAL WEEKLY CASH FLOW",
          cumulativeWeeklyActual.map((value) => (value / 100) * totalBudget),
          "currency"
        ),
      ],
      detailRows: [
        this.buildDailyRow("planned", "Planned", plannedDailyValues, columns, "percent"),
        this.buildDailyRow("actual", "Actual", actualDailyValues, columns, "percent"),
        this.buildDailyRow(
          "plannedCumulative",
          "Planned Cumulative",
          plannedCumulativeValues,
          columns,
          "percent"
        ),
        this.buildDailyRow(
          "actualCumulative",
          "Actual Cumulative",
          actualCumulativeValues,
          columns,
          "percent"
        ),
        this.buildDailyRow("variance", "Variance", varianceValues, columns, "percent"),
        this.buildDailyRow("days", "Days", daysValues, columns, "number"),
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  private buildWeekGroups(columns: Array<{ index: number; date: string; weekNumber: number }>) {
    const groups = new Map<number, Array<{ index: number; date: string; weekNumber: number }>>();

    for (const column of columns) {
      const existing = groups.get(column.weekNumber) || [];
      existing.push(column);
      groups.set(column.weekNumber, existing);
    }

    return Array.from(groups.entries()).map(([weekNumber, items]) => ({
      weekNumber,
      label: `WEEK ${weekNumber}`,
      startColumn: items[0].index,
      endColumn: items[items.length - 1].index,
      colspan: items.length,
      dateFrom: items[0].date,
      dateTo: items[items.length - 1].date,
    }));
  }

  private sumValuesByWeek(
    values: number[],
    columns: Array<{ weekNumber: number }>
  ) {
    const sums = new Map<number, number>();

    values.forEach((value, index) => {
      const weekNumber = columns[index].weekNumber;
      sums.set(weekNumber, (sums.get(weekNumber) || 0) + value);
    });

    return Array.from(sums.values()).map((value) => this.roundPercent(value));
  }

  private cumulativeValues(values: number[]) {
    let runningTotal = 0;

    return values.map((value) => {
      runningTotal += value;
      return this.roundPercent(runningTotal);
    });
  }

  private buildWeeklyRow(
    key: string,
    label: string,
    values: number[],
    format: "percent" | "currency" | "number"
  ) {
    return {
      key,
      label,
      format,
      values: values.map((value, index) => ({
        weekNumber: index + 1,
        value: this.roundNumber(value, format === "currency" ? 2 : 2),
        formattedValue: this.formatReportValue(value, format),
      })),
    };
  }

  private buildDailyRow(
    key: string,
    label: string,
    values: number[],
    columns: Array<{ index: number; date: string; weekNumber: number }>,
    format: "percent" | "currency" | "number"
  ) {
    return {
      key,
      label,
      format,
      values: values.map((value, index) => ({
        columnIndex: columns[index].index,
        date: columns[index].date,
        weekNumber: columns[index].weekNumber,
        value: this.roundNumber(value, 2),
        formattedValue: this.formatReportValue(value, format),
      })),
    };
  }

  private formatReportValue(value: number, format: "percent" | "currency" | "number") {
    if (format === "percent") {
      return `${this.roundNumber(value, 2).toFixed(2)}%`;
    }

    if (format === "currency") {
      return this.roundNumber(value, 2).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    return this.roundNumber(value, 2).toFixed(2);
  }

  private roundPercent(value: number) {
    return this.roundNumber(value, 2);
  }

  private roundNumber(value: number, decimals: number) {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
}

export const projectDashboardService = new ProjectDashboardService();
