import prisma from "../../config/prisma";
import { getSCurve } from "../progress/scurve.service";
import {
  ChartConfigDTO,
  CreateDashboardKpiDTO,
  CreatePersonalDashboardDTO,
  KpiThresholdDTO,
  SourcePreviewQueryDTO,
  UpdateDashboardKpiDTO,
  UpdatePersonalDashboardDTO,
} from "./personal-dashboard.dto";
import {
  buildProgressPreview,
  detectSourceType,
  evaluateProgressStatus,
  validateProgressThresholds,
} from "./personal-dashboard.kpi";

const MAX_PERSONAL_DASHBOARDS = 5;
const DEFAULT_CHARTS = [
  "KPI_SUMMARY",
  "SCURVE",
  "PROGRESS_TREND",
  "KPI_STATUS_DISTRIBUTION",
  "TASK_COMPLETION",
];

export class PersonalDashboardService {
  async list(userId: string) {
    const dashboards = await (prisma as any).personalDashboard.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { id: true, name: true, progress: true, status: true } },
        kpis: { include: { thresholds: true } },
        charts: { orderBy: { sortOrder: "asc" } },
      },
    });

    return Promise.all(dashboards.map((dashboard: any) => this.enrichDashboard(dashboard)));
  }

  async getById(id: string, userId: string) {
    const dashboard = await this.findOwnedDashboard(id, userId);
    return this.enrichDashboard(dashboard);
  }

  async create(userId: string, dto: CreatePersonalDashboardDTO) {
    this.validateDashboardInput(dto);
    await this.ensureProjectAccess(dto.projectId, userId);

    return (prisma as any).$transaction(async (tx: any) => {
      const count = await tx.personalDashboard.count({ where: { userId } });

      if (count >= MAX_PERSONAL_DASHBOARDS) {
        throw new Error("User cannot exceed 5 personal dashboards");
      }

      const dashboard = await tx.personalDashboard.create({
        data: {
          userId,
          projectId: dto.projectId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          charts: {
            create: DEFAULT_CHARTS.map((chartType, index) => ({
              chartType,
              sortOrder: index,
              isEnabled: true,
            })),
          },
        },
        include: {
          project: { select: { id: true, name: true, progress: true, status: true } },
          kpis: { include: { thresholds: true } },
          charts: { orderBy: { sortOrder: "asc" } },
        },
      });

      return this.enrichDashboard(dashboard);
    });
  }

  async update(id: string, userId: string, dto: UpdatePersonalDashboardDTO) {
    await this.findOwnedDashboard(id, userId);

    if (dto.name !== undefined && dto.name.trim().length < 2) {
      throw new Error("Dashboard name must be at least 2 characters");
    }

    const dashboard = await (prisma as any).personalDashboard.update({
      where: { id },
      data: {
        name: dto.name === undefined ? undefined : dto.name.trim(),
        description:
          dto.description === undefined ? undefined : dto.description?.trim() || null,
      },
      include: {
        project: { select: { id: true, name: true, progress: true, status: true } },
        kpis: { include: { thresholds: true } },
        charts: { orderBy: { sortOrder: "asc" } },
      },
    });

    return this.enrichDashboard(dashboard);
  }

  async delete(id: string, userId: string) {
    await this.findOwnedDashboard(id, userId);
    await (prisma as any).personalDashboard.delete({ where: { id } });

    return { id };
  }

  async getSourceOptions(id: string, userId: string) {
    const dashboard = await this.findOwnedDashboard(id, userId);

    const project = await prisma.project.findUnique({
      where: { id: dashboard.projectId },
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

  async previewSource(id: string, userId: string, query: SourcePreviewQueryDTO) {
    const dashboard = await this.findOwnedDashboard(id, userId);
    const sourceInput = {
      projectId: query.projectId || dashboard.projectId,
      scopeId: query.scopeId,
      taskId: query.taskId,
      subtaskId: query.subtaskId,
    };

    if (sourceInput.projectId !== dashboard.projectId) {
      throw new Error("KPI project must match dashboard project");
    }

    await this.validateSourceHierarchy(sourceInput.projectId, sourceInput);
    const sourceType = detectSourceType(sourceInput);
    const [progress, dates] = await Promise.all([
      this.getProgressValue(sourceType, sourceInput),
      this.getDateRange(sourceType, sourceInput),
    ]);

    return buildProgressPreview(sourceType, progress, dates.expectedStartDate, dates.expectedEndDate);
  }

  async createKpi(dashboardId: string, userId: string, dto: CreateDashboardKpiDTO) {
    const dashboard = await this.findOwnedDashboard(dashboardId, userId);

    this.validateKpiInput(dto);
    const projectId = dto.projectId || dashboard.projectId;

    if (projectId !== dashboard.projectId) {
      throw new Error("KPI project must match dashboard project");
    }

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
        dashboardId,
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
          create: dto.thresholds.map((rule) => ({
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
    dashboardId: string,
    kpiId: string,
    userId: string,
    dto: UpdateDashboardKpiDTO
  ) {
    const dashboard = await this.findOwnedDashboard(dashboardId, userId);
    const existing = await this.findKpi(dashboardId, kpiId);

    if (dto.name !== undefined && dto.name.trim().length < 2) {
      throw new Error("KPI name must be at least 2 characters");
    }

    if (dto.thresholds) {
      validateProgressThresholds(dto.thresholds);
    }

    const sourceInput = {
      projectId: dashboard.projectId,
      scopeId: dto.scopeId === undefined ? existing.scopeId : dto.scopeId || undefined,
      taskId: dto.taskId === undefined ? existing.taskId : dto.taskId || undefined,
      subtaskId: dto.subtaskId === undefined ? existing.subtaskId : dto.subtaskId || undefined,
    };

    await this.validateSourceHierarchy(dashboard.projectId, sourceInput);
    const sourceType = detectSourceType(sourceInput);

    const kpi = await (prisma as any).$transaction(async (tx: any) => {
      if (dto.thresholds) {
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
          thresholds: dto.thresholds
            ? {
                create: dto.thresholds.map((rule) => ({
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

  async deleteKpi(dashboardId: string, kpiId: string, userId: string) {
    await this.findOwnedDashboard(dashboardId, userId);
    await this.findKpi(dashboardId, kpiId);
    await (prisma as any).dashboardKpi.delete({ where: { id: kpiId } });

    return { id: kpiId };
  }

  async updateCharts(dashboardId: string, userId: string, charts: ChartConfigDTO[]) {
    await this.findOwnedDashboard(dashboardId, userId);

    if (!Array.isArray(charts)) {
      throw new Error("charts must be an array");
    }

    await (prisma as any).$transaction(
      charts.map((chart, index) =>
        (prisma as any).dashboardChartConfig.upsert({
          where: {
            dashboardId_chartType: {
              dashboardId,
              chartType: chart.chartType,
            },
          },
          update: {
            isEnabled: chart.isEnabled ?? true,
            sortOrder: chart.sortOrder ?? index,
          },
          create: {
            dashboardId,
            chartType: chart.chartType,
            isEnabled: chart.isEnabled ?? true,
            sortOrder: chart.sortOrder ?? index,
          },
        })
      )
    );

    return this.getById(dashboardId, userId);
  }

  async getChartData(dashboardId: string, userId: string) {
    const dashboard = await this.findOwnedDashboard(dashboardId, userId);
    const enriched = await this.enrichDashboard(dashboard);
    const scurve = await getSCurve(dashboard.projectId).catch(() => null);

    return {
      summary: enriched.summary,
      scurve,
      progressTrend: scurve?.data || [],
      kpiStatusDistribution: enriched.summary,
      taskCompletion: await this.getTaskCompletion(dashboard.projectId),
    };
  }

  private async enrichDashboard(dashboard: any) {
    const kpis = await Promise.all((dashboard.kpis || []).map((kpi: any) => this.enrichKpi(kpi)));
    const summary = {
      totalKpis: kpis.length,
      criticalKpis: kpis.filter((kpi) => kpi.status === "CRITICAL").length,
      onflowKpis: kpis.filter((kpi) => kpi.status === "ONFLOW").length,
      healthyKpis: kpis.filter((kpi) => kpi.status === "HEALTHY").length,
      unclassifiedKpis: kpis.filter((kpi) => kpi.status === "UNCLASSIFIED").length,
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

    return {
      ...kpi,
      thresholds,
      currentValue: Number(progress.toFixed(2)),
      preview: buildProgressPreview(kpi.sourceType, progress),
      status,
    };
  }

  private async findOwnedDashboard(id: string, userId: string) {
    const dashboard = await (prisma as any).personalDashboard.findFirst({
      where: { id, userId },
      include: {
        project: { select: { id: true, name: true, progress: true, status: true } },
        kpis: { include: { thresholds: true } },
        charts: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!dashboard) {
      throw new Error("Dashboard not found");
    }

    return dashboard;
  }

  private async findKpi(dashboardId: string, kpiId: string) {
    const kpi = await (prisma as any).dashboardKpi.findFirst({
      where: { id: kpiId, dashboardId },
      include: { thresholds: true },
    });

    if (!kpi) {
      throw new Error("KPI not found");
    }

    return kpi;
  }

  private validateDashboardInput(dto: CreatePersonalDashboardDTO) {
    if (!dto.name || dto.name.trim().length < 2) {
      throw new Error("Dashboard name must be at least 2 characters");
    }

    if (!dto.projectId) {
      throw new Error("Project is required");
    }
  }

  private validateKpiInput(dto: CreateDashboardKpiDTO) {
    if (!dto.name || dto.name.trim().length < 2) {
      throw new Error("KPI name must be at least 2 characters");
    }

    if (dto.field && dto.field !== "PROGRESS") {
      throw new Error("Only progress KPIs are supported for now");
    }

    validateProgressThresholds(dto.thresholds);
  }

  private async ensureProjectAccess(projectId: string, userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    const project = await prisma.project.findFirst({
      where:
        user?.role?.name === "SUPERADMIN"
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
        task: {
          scope: { projectId },
        },
      },
      select: { status: true, progress: true },
    });

    const completed = subtasks.filter((subtask) => subtask.progress >= 100 || subtask.status === 2).length;

    return {
      completed,
      pending: Math.max(0, subtasks.length - completed),
      total: subtasks.length,
    };
  }
}

export const personalDashboardService = new PersonalDashboardService();
