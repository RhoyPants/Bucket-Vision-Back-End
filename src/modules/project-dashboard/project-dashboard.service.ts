import prisma from "../../config/prisma";
import { getSCurve } from "../progress/scurve.service";
import {
  CreateDashboardKpiDTO,
  CreateDashboardNoteDTO,
  KpiTargetDTO,
  SourcePreviewQueryDTO,
  UpdateDashboardNoteDTO,
  UpdateDashboardNoteItemDTO,
  UpdateDashboardKpiDTO,
} from "./project-dashboard.dto";
import {
  DEFAULT_KPI_THRESHOLDS,
  detectSourceType,
  evaluateScheduleHealth,
} from "./project-dashboard.kpi";
import { HEALTH_RULES_VERSION, summarizeHealth, validProgress, validateWarningBelow, WorkSchedule } from "../../utils/schedule-health";
import { manilaCalendarDay } from "../progress/planned-progress";

export class ProjectDashboardService {
  async get(projectId: string, userId: string, asOf = new Date()) {
    const project = await this.ensureProjectAccess(projectId, userId);
    const [kpis, defaultSubtaskKpi, membership] = await Promise.all([
      (prisma as any).dashboardKpi.findMany({
        where: { projectId },
        include: { targets: { orderBy: { sortOrder: "asc" } } },
        orderBy: { createdAt: "asc" },
      }),
      this.getSubtaskKpi(projectId, userId, asOf),
      prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { role: true } }),
    ]);

    return this.enrichDashboard({ project: { ...project, currentUserProjectRole: membership?.role || null }, kpis, defaultSubtaskKpi }, asOf);
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
        progress: this.displayProgress(project.progress == null ? null : validProgress(Number(project.progress))),
        expectedStartDate: project.startDate,
        expectedEndDate: project.expectedEndDate,
      },
      fieldOptions: [{
        field: "PROGRESS", unit: "%", label: "Progress", evaluation: "SCHEDULE_HEALTH",
        defaultWarningBelow: 0,
      }],
      scopes: project.scopes.map((scope: any) => {
        // Calculate date range for scope from its subtasks
        const allSubtasks = scope.tasks.flatMap((t: any) => t.subtasks);
        const scopeDates = this.computeDateRange(allSubtasks);

        return {
          id: scope.id,
          name: scope.name,
          progress: this.displayProgress(scope.progress == null ? null : validProgress(Number(scope.progress))),
          expectedStartDate: scopeDates.expectedStartDate,
          expectedEndDate: scopeDates.expectedEndDate,
          tasks: scope.tasks.map((task: any) => {
            // Calculate date range for task from its subtasks
            const taskDates = this.computeDateRange(task.subtasks);

            return {
              id: task.id,
              title: task.title,
              progress: this.displayProgress(task.progress == null ? null : validProgress(Number(task.progress))),
              expectedStartDate: taskDates.expectedStartDate,
              expectedEndDate: taskDates.expectedEndDate,
              subtasks: task.subtasks.map((subtask: any) => ({
                id: subtask.id,
                title: subtask.title,
                progress: this.displayProgress(subtask.progress == null ? null : validProgress(Number(subtask.progress))),
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
    validateWarningBelow(query.warningBelow);
    const asOf = new Date();
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

    const result = await this.evaluateSource(projectId, sourceInput, progress, dates, asOf);
    return {
      healthRulesVersion: HEALTH_RULES_VERSION,
      sourceType, field: "PROGRESS", unit: "%", actualProgress: this.displayProgress(result.actualProgress),
      expectedProgress: this.displayProgress(result.expectedProgress), variance: this.displayProgress(result.variance),
      expectedStartDate: dates.expectedStartDate, expectedEndDate: dates.expectedEndDate,
      previewStatus: result.status, statusReason: result.statusReason,
    };
  }

  async listKpis(projectId: string, userId: string, options: { includeTargets?: boolean; includeComputed?: boolean } = {}) {
    const asOf = new Date();
    await this.ensureProjectAccess(projectId, userId);
    const records = await (prisma as any).dashboardKpi.findMany({
      where: { projectId },
      include: { targets: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    const data = await Promise.all(records.map((kpi: any) => this.enrichKpi(kpi, asOf)));
    return data.map((kpi: any) => ({
      ...kpi,
      targets: options.includeTargets === false ? undefined : kpi.targets,
      summary: options.includeComputed === false ? undefined : kpi.summary,
    }));
  }

  async getKpi(projectId: string, kpiId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId);
    return this.enrichKpi(await this.findKpi(projectId, kpiId));
  }

  async createKpi(projectId: string, userId: string, dto: CreateDashboardKpiDTO) {
    await this.ensureProjectAccess(projectId, userId);
    this.validateKpiInput(dto);
    await this.validateTargets(projectId, dto.targets);
    const chartTypes = this.validateChartTypes(dto.chartTypes);
    const kpi = await (prisma as any).$transaction((tx: any) => tx.dashboardKpi.create({
      data: {
        name: dto.name.trim(), description: dto.description?.trim() || null, projectId,
        createdById: userId, chartTypes,
        targets: { create: dto.targets.map((target, index) => this.targetData(target, index)) },
      },
      include: { targets: { orderBy: { sortOrder: "asc" } } },
    }));

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

    const deletedIds = [...new Set(dto.deletedTargetIds || [])];
    if (dto.targets) await this.validateTargets(projectId, dto.targets, kpiId, deletedIds);
    const remaining = existing.targets.length - deletedIds.length + (dto.targets || []).filter((t) => !t.id).length;
    if (remaining < 1) throw new Error("A KPI must contain at least one target.");

    const kpi = await (prisma as any).$transaction(async (tx: any) => {
      if (deletedIds.length) {
        const deleted = await tx.kpiTarget.deleteMany({ where: { id: { in: deletedIds }, kpiId } });
        if (deleted.count !== deletedIds.length) throw new Error("One or more KPI targets were not found");
      }
      for (const [index, target] of (dto.targets || []).entries()) {
        const data = this.targetData(target, index);
        if (target.id) {
          const updated = await tx.kpiTarget.updateMany({ where: { id: target.id, kpiId }, data });
          if (updated.count !== 1) throw new Error("KPI target not found");
        } else await tx.kpiTarget.create({ data: { ...data, kpiId } });
      }
      return tx.dashboardKpi.update({
        where: { id: kpiId },
        data: {
          name: dto.name === undefined ? undefined : dto.name.trim(),
          description: dto.description === undefined ? undefined : dto.description?.trim() || null,
          chartTypes: dto.chartTypes === undefined ? undefined : this.validateChartTypes(dto.chartTypes),
          updatedById: userId,
        },
        include: { targets: { orderBy: { sortOrder: "asc" } } },
      });
    });

    return this.enrichKpi(kpi);
  }

  async deleteKpi(projectId: string, kpiId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId);
    await this.findKpi(projectId, kpiId);
    await (prisma as any).dashboardKpi.delete({ where: { id: kpiId } });

    return { id: kpiId, deleted: true };
  }

  async addTarget(projectId: string, kpiId: string, userId: string, dto: KpiTargetDTO) {
    await this.ensureProjectAccess(projectId, userId); await this.findKpi(projectId, kpiId);
    await this.validateTargets(projectId, [dto], kpiId);
    await (prisma as any).$transaction(async (tx: any) => {
      await tx.kpiTarget.create({ data: { ...this.targetData(dto, 0), kpiId } });
      await tx.dashboardKpi.update({ where: { id: kpiId }, data: { updatedById: userId } });
    });
    return this.getKpi(projectId, kpiId, userId);
  }

  async updateTarget(projectId: string, kpiId: string, targetId: string, userId: string, dto: KpiTargetDTO) {
    await this.ensureProjectAccess(projectId, userId); await this.findKpi(projectId, kpiId);
    await this.validateTargets(projectId, [{ ...dto, id: targetId }], kpiId);
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const updated = await tx.kpiTarget.updateMany({ where: { id: targetId, kpiId }, data: this.targetData({ ...dto, id: targetId }, 0) });
      if (updated.count === 1) await tx.dashboardKpi.update({ where: { id: kpiId }, data: { updatedById: userId } });
      return updated;
    });
    if (result.count !== 1) throw new Error("KPI target not found");
    return this.getKpi(projectId, kpiId, userId);
  }

  async deleteTarget(projectId: string, kpiId: string, targetId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId); const kpi = await this.findKpi(projectId, kpiId);
    if (kpi.targets.length <= 1) throw new Error("A KPI must contain at least one target.");
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const deleted = await tx.kpiTarget.deleteMany({ where: { id: targetId, kpiId } });
      if (deleted.count === 1) await tx.dashboardKpi.update({ where: { id: kpiId }, data: { updatedById: userId } });
      return deleted;
    });
    if (result.count !== 1) throw new Error("KPI target not found");
    return { id: targetId, deleted: true };
  }

  async getSubtaskKpiConfig(projectId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId);
    return { healthRulesVersion: HEALTH_RULES_VERSION, warningBelow: 0, isCustom: false };
  }

  async updateSubtaskKpiConfig(
    projectId: string,
    userId: string,
    dto: { warningBelow: number }
  ) {
    await this.ensureSubtaskKpiConfigAccess(projectId, userId);
    validateWarningBelow(dto?.warningBelow, true);
    if (Object.keys(dto).some((key) => key !== "warningBelow")) {
      throw new Error("Fixed V2 configuration accepts only warningBelow: 0.");
    }
    return this.getSubtaskKpiConfig(projectId, userId);
  }

  async resetSubtaskKpiConfig(projectId: string, userId: string) {
    await this.ensureSubtaskKpiConfigAccess(projectId, userId);
    return this.getSubtaskKpiConfig(projectId, userId);
  }

  async getSubtaskKpi(projectId: string, userId: string, asOf = new Date()) {
    const project = await this.ensureProjectAccess(projectId, userId);
    const config = await this.getSubtaskKpiConfig(projectId, userId);
    const schedule = await this.getWorkSchedule(projectId);
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
        select: {
          id: true,
          title: true,
          progress: true,
          actualStartDate: true,
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
      });

    const evaluated = subtasks.map((subtask) => {
      const result = evaluateScheduleHealth({
        actualProgress: subtask.progress == null ? null : Number(subtask.progress),
        startDate: subtask.projectedStartDate, endDate: subtask.projectedEndDate,
        actualStartDate: subtask.actualStartDate, asOf, schedule,
      });

      return {
        id: subtask.id,
        title: subtask.title,
        scope: subtask.task.scope,
        task: {
          id: subtask.task.id,
          title: subtask.task.title,
        },
        actualProgress: this.displayProgress(result.actualProgress),
        expectedProgress: this.displayProgress(result.expectedProgress),
        variance: this.displayProgress(result.variance),
        projectedStartDate: subtask.projectedStartDate,
        projectedEndDate: subtask.projectedEndDate,
        status: result.status, statusReason: result.statusReason,
      };
    });
    const subtaskSummary = summarizeHealth(evaluated);

    return {
      healthRulesVersion: HEALTH_RULES_VERSION,
      project: { id: project.id, name: project.name },
      config,
      summary: subtaskSummary,
      subtasks: evaluated,
      generatedAt: asOf.toISOString(),
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
      healthRulesVersion: HEALTH_RULES_VERSION,
      automaticSubtaskSummary: enriched.automaticSubtaskSummary,
      summary: enriched.automaticSubtaskSummary,
      customKpis: enriched.customKpis,
      scurve,
      progressTrend: scurve?.data || [],
      reportTable,
      kpiStatusDistribution: enriched.automaticSubtaskSummary,
      taskCompletion: await this.getTaskCompletion(projectId),
      defaultSubtaskKpi: enriched.defaultSubtaskKpi,
    };
  }

  async getReportTable(projectId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId);
    const scurve = await getSCurve(projectId);

    return this.buildReportTable(projectId, scurve.data);
  }

  private async enrichDashboard(dashboard: any, asOf: Date) {
    const kpis = await Promise.all((dashboard.kpis || []).map((kpi: any) => this.enrichKpi(kpi, asOf)));
    return {
      ...dashboard,
      healthRulesVersion: HEALTH_RULES_VERSION,
      kpis,
      automaticSubtaskSummary: dashboard.defaultSubtaskKpi?.summary,
      customKpis: kpis,
    };
  }

  private async enrichKpi(kpi: any, asOf = new Date()) {
    const targets = await Promise.all((kpi.targets || []).map((target: any) => this.enrichTarget(kpi.projectId, target, asOf)));
    const summary = summarizeHealth(targets);
    return {
      healthRulesVersion: HEALTH_RULES_VERSION,
      id: kpi.id, projectId: kpi.projectId, name: kpi.name, description: kpi.description,
      chartTypes: kpi.chartTypes, summary, targets,
      createdAt: kpi.createdAt, updatedAt: kpi.updatedAt,
    };
  }

  private async enrichTarget(projectId: string, target: any, asOf: Date) {
    const sourceType = detectSourceType(target);
    const [actualProgress, dates, sourceDetails] = await Promise.all([
      this.getProgressValue(sourceType, { ...target, projectId }),
      this.getDateRange(sourceType, { ...target, projectId }),
      this.getSourceDetails(projectId, target),
    ]);
    const result = await this.evaluateSource(projectId, target, actualProgress, dates, asOf);
    return {
      id: target.id, kpiId: target.kpiId, sourceType,
      scopeId: target.scopeId, taskId: target.taskId, subtaskId: target.subtaskId,
      sourceDetails, field: target.field, unit: target.unit,
      actualProgress: this.displayProgress(result.actualProgress), expectedProgress: this.displayProgress(result.expectedProgress),
      variance: this.displayProgress(result.variance), status: result.status, statusReason: result.statusReason,
      thresholds: { warningBelow: 0 }, sortOrder: target.sortOrder,
    };
  }

  private async getSourceDetails(projectId: string, target: any) {
    const sourceType = detectSourceType(target);
    if (sourceType === "SUBTASK") {
      const subtask = await prisma.subtask.findUnique({
        where: { id: target.subtaskId },
        select: { title: true, task: { select: { title: true, scope: { select: { name: true } } } } },
      });
      return subtask ? { scopeName: subtask.task.scope.name, taskTitle: subtask.task.title, title: subtask.title } : null;
    }
    if (sourceType === "TASK") {
      const task = await prisma.task.findUnique({
        where: { id: target.taskId }, select: { title: true, scope: { select: { name: true } } },
      });
      return task ? { scopeName: task.scope.name, taskTitle: task.title, title: task.title } : null;
    }
    if (sourceType === "SCOPE") {
      const scope = await prisma.scope.findUnique({ where: { id: target.scopeId }, select: { name: true } });
      return scope ? { scopeName: scope.name, taskTitle: null, title: scope.name } : null;
    }
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    return project ? { scopeName: null, taskTitle: null, title: project.name } : null;
  }

  private async findKpi(projectId: string, kpiId: string) {
    const kpi = await (prisma as any).dashboardKpi.findFirst({
      where: { id: kpiId, projectId },
      include: { targets: { orderBy: { sortOrder: "asc" } } },
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

    if (!Array.isArray(dto.targets) || dto.targets.length === 0) {
      throw new Error("A KPI must contain at least one target.");
    }
  }

  private validateChartTypes(chartTypes: any = ["DONUT"]) {
    if (!Array.isArray(chartTypes) || chartTypes.length === 0 || chartTypes.some((v) => !["DONUT", "BAR"].includes(v))) {
      throw new Error("chartTypes must contain at least one of DONUT or BAR");
    }
    return [...new Set(chartTypes)];
  }

  private validateThresholds(criticalBelow: number, healthyAtOrAbove: number) {
    if (!Number.isFinite(criticalBelow) || !Number.isFinite(healthyAtOrAbove)) throw new Error("KPI thresholds must be numeric");
    if (criticalBelow < -100 || criticalBelow > 100 || healthyAtOrAbove < -100 || healthyAtOrAbove > 100) throw new Error("KPI thresholds must be between -100 and 100");
    if (criticalBelow >= healthyAtOrAbove) throw new Error("criticalBelow must be less than healthyAtOrAbove");
  }

  private targetData(target: KpiTargetDTO, index: number) {
    validateWarningBelow(target.warningBelow);
    const criticalBelow = target.criticalBelow === undefined ? DEFAULT_KPI_THRESHOLDS.criticalBelow : Number(target.criticalBelow);
    const healthyAtOrAbove = target.healthyAtOrAbove === undefined ? DEFAULT_KPI_THRESHOLDS.healthyAtOrAbove : Number(target.healthyAtOrAbove);
    this.validateThresholds(criticalBelow, healthyAtOrAbove);
    if (target.field && target.field !== "PROGRESS") throw new Error("Only PROGRESS is supported for now");
    if (target.unit && target.unit !== "%") throw new Error("PROGRESS targets must use % as the unit");
    return { scopeId: target.scopeId || null, taskId: target.taskId || null, subtaskId: target.subtaskId || null,
      field: "PROGRESS", unit: "%",
      ...(target.id ? {} : { criticalBelow, healthyAtOrAbove }),
      sortOrder: target.sortOrder ?? index };
  }

  private async validateTargets(projectId: string, targets: KpiTargetDTO[], kpiId?: string, ignoredIds: string[] = []) {
    const keys = new Set<string>();
    const existing = kpiId ? await (prisma as any).kpiTarget.findMany({ where: { kpiId } }) : [];
    for (const target of targets) {
      this.targetData(target, 0);
      await this.validateSourceHierarchy(projectId, target);
      const type = detectSourceType(target);
      const sourceId = target.subtaskId || target.taskId || target.scopeId || projectId;
      const key = `${type}:${sourceId}:PROGRESS`;
      if (keys.has(key) || existing.some((item: any) => !ignoredIds.includes(item.id) && item.id !== target.id && `${detectSourceType(item)}:${item.subtaskId || item.taskId || item.scopeId || projectId}:PROGRESS` === key)) {
        throw new Error("The same source and field cannot be added to a KPI more than once.");
      }
      keys.add(key);
    }
  }

  private async ensureProjectAccess(projectId: string, userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    const hasGlobalProjectAccess =
      user?.role?.name === "SUPERADMIN" || user?.role?.name === "OP";
    const hasBusinessUnitProjectAccess =
      user?.role?.name === "BU_HEAD" && !!user.businessUnitId;

    const project = await prisma.project.findFirst({
      where:
        hasGlobalProjectAccess
          ? { id: projectId }
          : {
              id: projectId,
              OR: [
                { ownerId: userId },
                { projectMembers: { some: { userId } } },
                ...(hasBusinessUnitProjectAccess
                  ? [{ businessUnit: user.businessUnitId }]
                  : []),
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
    if (!membership || !["CO_OWNER", "SUB_OWNER"].includes(membership.role)) {
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
        where: { taskId: input.taskId, deletedAt: null },
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
        where: { deletedAt: null, task: { scopeId: input.scopeId, deletedAt: null } },
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
      return subtask.progress == null ? null : validProgress(Number(subtask.progress));
    }

    if (sourceType === "TASK") {
      const task = await prisma.task.findUnique({ where: { id: input.taskId } });
      if (!task) throw new Error("Task not found");
      return task.progress == null ? null : validProgress(Number(task.progress));
    }

    if (sourceType === "SCOPE") {
      const scope = await prisma.scope.findUnique({ where: { id: input.scopeId } });
      if (!scope) throw new Error("Scope not found");
      return scope.progress == null ? null : validProgress(Number(scope.progress));
    }

    const project = await prisma.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new Error("Project not found");
    return project.progress == null ? null : validProgress(Number(project.progress));
  }

  private async getWorkSchedule(projectId: string): Promise<WorkSchedule> {
    const [project, holidays] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.holiday.findMany({ select: { date: true } }),
    ]);
    if (!project) throw new Error("Project not found");
    return {
      ...project,
      holidayKeys: new Set(holidays.map(({ date }) => manilaCalendarDay(date).toISOString().slice(0, 10))),
    };
  }

  private async evaluateSource(
    projectId: string,
    source: { scopeId?: string | null; taskId?: string | null; subtaskId?: string | null },
    actualProgress: number | null,
    dates: { expectedStartDate: Date | null; expectedEndDate: Date | null },
    asOf: Date
  ) {
    const [schedule, children, project] = await Promise.all([
      this.getWorkSchedule(projectId),
      prisma.subtask.findMany({
        where: {
          deletedAt: null,
          ...(source.subtaskId ? { id: source.subtaskId } : {}),
          ...(source.taskId ? { taskId: source.taskId } : {}),
          task: { deletedAt: null, scope: { projectId, deletedAt: null, ...(source.scopeId ? { id: source.scopeId } : {}) } },
        },
        select: { actualStartDate: true, progress: true },
      }),
      !source.scopeId && !source.taskId && !source.subtaskId
        ? prisma.project.findUnique({ where: { id: projectId }, select: { actualStartDate: true } })
        : Promise.resolve(null),
    ]);
    const starts = [...children.map((child) => child.actualStartDate), project?.actualStartDate]
      .filter((date): date is Date => date instanceof Date && Number.isFinite(date.getTime()) && date <= asOf);
    const actualStartDate = starts.length ? new Date(Math.min(...starts.map((date) => date.getTime())))
      : children.some((child) => child.progress != null && (validProgress(Number(child.progress)) ?? 0) > 0) ? asOf : null;
    return evaluateScheduleHealth({
      actualProgress, startDate: dates.expectedStartDate, endDate: dates.expectedEndDate,
      actualStartDate, schedule, asOf,
    });
  }

  private displayProgress(value: number | null) {
    return value === null ? null : this.roundNumber(value, 2);
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
      (subtask) => Number(subtask.progress) >= 100 || subtask.status === 2 || subtask.status === 3
    ).length;

    const ongoing = subtasks.filter(
      (subtask) =>
        !(Number(subtask.progress) >= 100 || subtask.status === 2 || subtask.status === 3) &&
        (subtask.status === 1 ||
          (Number(subtask.progress) > 0 && Number(subtask.progress) < 100))
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
