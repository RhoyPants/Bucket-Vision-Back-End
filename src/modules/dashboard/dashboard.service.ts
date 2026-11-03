import prisma from "../../config/prisma";
import { projectDashboardService } from "../project-dashboard/project-dashboard.service";
import {
  evaluateScheduleHealth, HEALTH_RULES_VERSION, recordedProgressAt, recordedStartAt,
  rollupHealth, summarizeHealth, HealthSummary, WorkSchedule,
} from "../../utils/schedule-health";
import { manilaCalendarDay } from "../progress/planned-progress";

const HEALTH_RANK: Record<string, number> = {
  DANGER: 0,
  WARNING: 1,
  HEALTHY: 2,
  NOT_STARTED: 3,
  UNCLASSIFIED: 4,
};

const INCIDENT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const DAY_MS = 86400000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const HEALTH_TREND_KEYS = ["danger", "warning", "healthy", "notStarted"] as const;
type TrendProject = Omit<WorkSchedule, "holidayKeys"> & { id: string; createdAt: Date };
type TrendCounts = Pick<HealthSummary, typeof HEALTH_TREND_KEYS[number]> & { incidentReports: number };
type TrendPoint = { date: string; value: number | null };

export class DashboardService {
  async get(userId: string, asOf = new Date()) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new Error("User not found");

    const accessibleProjectWhere: any = {
      deletedAt: null,
      ...(user.role?.name === "SUPERADMIN" || user.role?.name === "OP"
        ? {}
        : {
            OR: [
              { ownerId: userId },
              { projectMembers: { some: { userId } } },
            ],
          }),
    };

    const projectSelect = {
      id: true,
      name: true,
      description: true,
      progress: true,
      isBudgeted: true,
      versionLabel: true,
      versionNumber: true,
      status: true,
      startDate: true,
      expectedEndDate: true,
      businessUnit: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: true,
      includeHolidays: true,
    } as const;

    const [projects, pendingProjects] = await Promise.all([
      prisma.project.findMany({
        where: {
          ...accessibleProjectWhere,
          status: "ACTIVE",
        },
        select: projectSelect,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.project.findMany({
        where: {
          ...accessibleProjectWhere,
          status: { in: ["FOR_REVIEW", "FOR_APPROVAL"] },
        },
        select: projectSelect,
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
    ]);
    const projectIds = projects.map((project) => project.id);

    const businessUnitIds = [
      ...new Set(
        [...projects, ...pendingProjects]
          .map((project) => project.businessUnit)
          .filter(Boolean)
      ),
    ] as string[];
    const businessUnits = businessUnitIds.length
      ? await prisma.businessUnit.findMany({
          where: { id: { in: businessUnitIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const businessUnitMap = new Map(businessUnits.map((unit) => [unit.id, unit]));

    const projectKpiResults = await Promise.all(
      projects.map(async (project) => ({
        projectId: project.id,
        data: await projectDashboardService.getSubtaskKpi(project.id, userId, asOf),
      }))
    );
    const kpiByProject = new Map(
      projectKpiResults.map((result) => [result.projectId, result.data])
    );

    const kpiSummary = summarizeHealth([]);
    for (const result of projectKpiResults) {
      if (!result.data) continue;
      kpiSummary.total += result.data.summary.total;
      kpiSummary.danger += result.data.summary.danger;
      kpiSummary.warning += result.data.summary.warning;
      kpiSummary.healthy += result.data.summary.healthy;
      kpiSummary.notStarted += result.data.summary.notStarted;
      kpiSummary.unclassified += result.data.summary.unclassified;
    }

    const rankedProjects = projects
      .map((project) => {
        const kpi = kpiByProject.get(project.id);
        const healthStatus = rollupHealth(kpi?.summary || summarizeHealth([]));
        return {
          id: project.id,
          name: project.name,
          description: project.description,
          progress: this.round(Number(project.progress)),
          version: project.versionLabel || `v${project.versionNumber}`,
          isBudgeted: project.isBudgeted,
          versionLabel: project.versionLabel,
          versionNumber: project.versionNumber,
          status: project.status,
          healthStatus,
          expectedStartDate: project.startDate,
          expectedEndDate: project.expectedEndDate,
          businessUnit: project.businessUnit
            ? businessUnitMap.get(project.businessUnit) || null
            : null,
          location: project.location,
          kpiSummary: kpi?.summary || summarizeHealth([]),
          subtasks: kpi?.subtasks || [],
          topSubtasks: [...(kpi?.subtasks || [])]
            .sort((a: any, b: any) => {
              const rank = HEALTH_RANK[a.status] - HEALTH_RANK[b.status];
              if (rank !== 0) return rank;
              return (
                (a.variance ?? Number.POSITIVE_INFINITY) -
                (b.variance ?? Number.POSITIVE_INFINITY)
              );
            })
            .slice(0, 3),
        };
      })
      .sort((a, b) => {
        const rank = HEALTH_RANK[a.healthStatus] - HEALTH_RANK[b.healthStatus];
        if (rank !== 0) return rank;
        const dangerDifference =
          b.kpiSummary.danger - a.kpiSummary.danger;
        if (dangerDifference !== 0) return dangerDifference;
        const warningDifference = b.kpiSummary.warning - a.kpiSummary.warning;
        if (warningDifference !== 0) return warningDifference;
        return a.progress - b.progress;
      });

    const topIncidents: any[] = [];
    if (projectIds.length) {
      for (const severity of INCIDENT_SEVERITIES) {
        const remaining = 10 - topIncidents.length;
        if (remaining <= 0) break;
        const incidents = await (prisma as any).incidentReport.findMany({
          where: { projectId: { in: projectIds }, severity },
          include: {
            project: { select: { id: true, name: true } },
            reportedBy: {
              select: { id: true, name: true, email: true, position: true },
            },
            scope: { select: { id: true, name: true } },
            task: { select: { id: true, title: true } },
            subtask: { select: { id: true, title: true } },
          },
          orderBy: { dateRaised: "desc" },
          take: remaining,
        });
        topIncidents.push(...incidents);
      }
    }

    const incidentCountGroups = projectIds.length
      ? await (prisma as any).incidentReport.groupBy({
          by: ["projectId"],
          where: { projectId: { in: projectIds } },
          _count: { _all: true },
        })
      : [];
    const incidentCountByProject = new Map<string, number>(
      incidentCountGroups.map((group: any) => [
        group.projectId,
        group._count._all,
      ])
    );
    const incidentReports = Array.from(incidentCountByProject.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    const trends = await this.buildSevenDayTrends(projects, asOf, { ...kpiSummary, incidentReports });

    const statusCounts = new Map<string, number>();
    projects.forEach((project) => {
      statusCounts.set(project.status, (statusCounts.get(project.status) || 0) + 1);
    });
    const totalProjects = projects.length;
    const statusDistribution = Array.from(statusCounts.entries()).map(
      ([status, count]) => ({
        status,
        count,
        percentage: totalProjects ? this.round((count / totalProjects) * 100) : 0,
      })
    );

    const progressCounts = {
      NOT_STARTED: projects.filter((project) => Number(project.progress) <= 0).length,
      IN_PROGRESS: projects.filter(
        (project) => Number(project.progress) > 0 && Number(project.progress) < 100
      ).length,
      COMPLETED: projects.filter((project) => Number(project.progress) >= 100).length,
    };
    const progressDistribution = Object.entries(progressCounts).map(
      ([status, count]) => ({
        status,
        count,
        percentage: totalProjects ? this.round((count / totalProjects) * 100) : 0,
      })
    );
    const averageProgress = totalProjects
      ? this.round(
          projects.reduce((sum, project) => sum + Number(project.progress), 0) /
            totalProjects
        )
      : 0;

    const pendingReviewAndApproval = pendingProjects
      .map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        progress: this.round(Number(project.progress)),
        version: project.versionLabel || `v${project.versionNumber}`,
        isBudgeted: project.isBudgeted,
        versionLabel: project.versionLabel,
        versionNumber: project.versionNumber,
        status: project.status,
        expectedStartDate: project.startDate,
        expectedEndDate: project.expectedEndDate,
        businessUnit: project.businessUnit
          ? businessUnitMap.get(project.businessUnit) || null
          : null,
        location: project.location,
        updatedAt: project.updatedAt,
      }));

    return {
      healthRulesVersion: HEALTH_RULES_VERSION,
      summary: {
        danger: kpiSummary.danger,
        warning: kpiSummary.warning,
        healthy: kpiSummary.healthy,
        notStarted: kpiSummary.notStarted,
        unclassified: kpiSummary.unclassified,
        totalKpis: kpiSummary.total,
        incidentReports,
        activeProjects: projects.filter((project) => project.status === "ACTIVE").length,
        totalProjects,
      },
      trends,
      topProjects: rankedProjects.slice(0, 5),
      breakdownProjects: rankedProjects,
      topIncidents,
      overallProjects: {
        total: totalProjects,
        statusDistribution,
        progress: {
          average: averageProgress,
          distribution: progressDistribution,
        },
      },
      pendingReviewAndApproval,
      generatedAt: asOf.toISOString(),
    };
  }

  private round(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private async buildSevenDayTrends(projects: TrendProject[], asOf: Date, current: TrendCounts) {
    const today = manilaCalendarDay(asOf);
    const days = Array.from({ length: 7 }, (_, index) => {
      return new Date(today.getTime() - (6 - index) * DAY_MS);
    });
    const projectIds = projects.map((project) => project.id);
    const historyStart = new Date(days[0].getTime() - MANILA_OFFSET_MS);
    const existedDuringPeriod = {
      createdAt: { lte: asOf },
      OR: [{ deletedAt: null }, { deletedAt: { gt: historyStart } }],
    };
    const [subtasks, incidents, holidays] = projectIds.length ? await Promise.all([
      prisma.subtask.findMany({
        where: {
          ...existedDuringPeriod,
          task: {
            ...existedDuringPeriod,
            scope: { ...existedDuringPeriod, projectId: { in: projectIds } },
          },
        },
        select: {
          createdAt: true, deletedAt: true, progress: true,
          projectedStartDate: true, projectedEndDate: true, actualStartDate: true,
          progressLogs: {
            where: { date: { lte: asOf } },
            orderBy: [{ date: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
            select: { date: true, cumulativePercent: true },
          },
          task: {
            select: {
              createdAt: true, deletedAt: true,
              scope: { select: { projectId: true, createdAt: true, deletedAt: true } },
            },
          },
        },
      }),
      prisma.incidentReport.findMany({
        where: { projectId: { in: projectIds }, dateRaised: { lte: asOf } },
        select: { dateRaised: true, projectId: true },
      }),
      prisma.holiday.findMany({ select: { date: true } }),
    ]) : [[], [], []];
    const holidayKeys = new Set(holidays.map(({ date }) => manilaCalendarDay(date).toISOString().slice(0, 10)));
    const projectById = new Map(projects.map((project) => [project.id, { ...project, holidayKeys }]));
    const history = subtasks.map((subtask) => ({
      ...subtask,
      progressLogs: subtask.progressLogs.map((log) => ({
        date: log.date, cumulativePercent: log.cumulativePercent == null ? null : Number(log.cumulativePercent),
      })),
    }));
    const metricPoints = {
      danger: [] as TrendPoint[], warning: [] as TrendPoint[],
      healthy: [] as TrendPoint[], notStarted: [] as TrendPoint[],
      incidentReports: [] as TrendPoint[],
    };
    const aliveAt = (item: { createdAt: Date; deletedAt: Date | null }, cutoff: Date) =>
      item.createdAt <= cutoff && (!item.deletedAt || item.deletedAt > cutoff);

    for (const day of days) {
      const date = day.toISOString().slice(0, 10);
      if (day.getTime() === today.getTime()) {
        for (const key of [...HEALTH_TREND_KEYS, "incidentReports"] as const) {
          metricPoints[key].push({ date, value: current[key] });
        }
        continue;
      }
      const cutoff = new Date(day.getTime() + DAY_MS - MANILA_OFFSET_MS - 1);
      let complete = true;
      const evaluations = [];
      for (const subtask of history) {
        const project = projectById.get(subtask.task.scope.projectId);
        if (!project || project.createdAt > cutoff || !aliveAt(subtask, cutoff) ||
            !aliveAt(subtask.task, cutoff) || !aliveAt(subtask.task.scope, cutoff)) continue;
        // Legacy imports with progress but no logs cannot establish historical completion.
        const actualProgress = !subtask.progressLogs.length && Number(subtask.progress) > 0
          ? null : recordedProgressAt(subtask.progressLogs, cutoff);
        const result = evaluateScheduleHealth({
          actualProgress, startDate: subtask.projectedStartDate, endDate: subtask.projectedEndDate,
          actualStartDate: recordedStartAt(subtask.progressLogs, subtask.actualStartDate, cutoff),
          asOf: cutoff, schedule: project,
        });
        if (result.status === "UNCLASSIFIED") complete = false;
        evaluations.push(result);
      }
      const summary = summarizeHealth(evaluations);
      for (const key of HEALTH_TREND_KEYS) metricPoints[key].push({ date, value: complete ? summary[key] : null });
      metricPoints.incidentReports.push({
        date, value: incidents.filter((incident) => incident.dateRaised <= cutoff &&
          projectById.get(incident.projectId)!.createdAt <= cutoff).length,
      });
    }

    const isComplete = Object.values(metricPoints).every((points) => points.every((point) => point.value !== null));
    return {
      healthRulesVersion: HEALTH_RULES_VERSION, period: "LAST_7_DAYS",
      basis: "RECALCULATED_PROGRESS_LOGS",
      dateFrom: days[0].toISOString().slice(0, 10),
      dateTo: today.toISOString().slice(0, 10),
      isComplete,
      note: "Recalculated from recorded progress using the current approved schedule and currently accessible active projects." +
        (isComplete ? "" : " Gaps indicate missing or invalid historical inputs."),
      danger: this.metricTrend(metricPoints.danger, current.danger),
      warning: this.metricTrend(metricPoints.warning, current.warning),
      healthy: this.metricTrend(metricPoints.healthy, current.healthy),
      notStarted: this.metricTrend(metricPoints.notStarted, current.notStarted),
      incidentReports: this.metricTrend(metricPoints.incidentReports, current.incidentReports),
    };
  }

  private metricTrend(points: TrendPoint[], currentValue: number) {
    const baseline = points.slice(0, -1).find((point) => point.value !== null);
    const change = baseline ? this.round(currentValue - baseline.value!) : null;
    const changePercentage = baseline && change !== null
      ? baseline.value === 0 ? (currentValue === 0 ? 0 : null) : this.round((change / baseline.value!) * 100)
      : null;
    return {
      value: currentValue, change, changePercentage,
      direction: change === null || change === 0 ? "FLAT" : change > 0 ? "UP" : "DOWN",
      baselineDate: baseline?.date ?? null,
      points,
    };
  }
}

export const dashboardService = new DashboardService();
