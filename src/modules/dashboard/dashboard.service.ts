import prisma from "../../config/prisma";
import { projectDashboardService } from "../project-dashboard/project-dashboard.service";

const HEALTH_RANK: Record<string, number> = {
  CRITICAL: 0,
  ONFLOW: 1,
  HEALTHY: 2,
  UNCLASSIFIED: 3,
};

const INCIDENT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export class DashboardService {
  async get(userId: string) {
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
      versionLabel: true,
      versionNumber: true,
      status: true,
      startDate: true,
      expectedEndDate: true,
      businessUnit: true,
      location: true,
      createdAt: true,
      updatedAt: true,
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
        data: await projectDashboardService.getSubtaskKpi(project.id, userId),
      }))
    );
    const kpiByProject = new Map(
      projectKpiResults.map((result) => [result.projectId, result.data])
    );

    const kpiSummary = {
      total: 0,
      critical: 0,
      onflow: 0,
      healthy: 0,
      unclassified: 0,
    };
    for (const result of projectKpiResults) {
      if (!result.data) continue;
      kpiSummary.total += result.data.summary.total;
      kpiSummary.critical += result.data.summary.critical;
      kpiSummary.onflow += result.data.summary.onflow;
      kpiSummary.healthy += result.data.summary.healthy;
      kpiSummary.unclassified += result.data.summary.unclassified;
    }

    const rankedProjects = projects
      .map((project) => {
        const kpi = kpiByProject.get(project.id);
        const healthStatus = this.getHealthStatus(kpi?.summary);
        return {
          id: project.id,
          name: project.name,
          description: project.description,
          progress: this.round(project.progress || 0),
          version: project.versionLabel || `v${project.versionNumber}`,
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
          kpiSummary: kpi?.summary || {
            total: 0,
            critical: 0,
            onflow: 0,
            healthy: 0,
            unclassified: 0,
          },
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
        const criticalDifference =
          (b.kpiSummary?.critical || 0) - (a.kpiSummary?.critical || 0);
        if (criticalDifference !== 0) return criticalDifference;
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
      NOT_STARTED: projects.filter((project) => project.progress <= 0).length,
      IN_PROGRESS: projects.filter(
        (project) => project.progress > 0 && project.progress < 100
      ).length,
      COMPLETED: projects.filter((project) => project.progress >= 100).length,
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
          projects.reduce((sum, project) => sum + (project.progress || 0), 0) /
            totalProjects
        )
      : 0;

    const today = this.startOfUtcDay(new Date());
    await Promise.all(
      projects.map((project) => {
        const projectKpi = kpiByProject.get(project.id);
        const summary = projectKpi?.summary || {
          total: 0,
          critical: 0,
          onflow: 0,
          healthy: 0,
          unclassified: 0,
        };
        return (prisma as any).projectDashboardSnapshot.upsert({
          where: {
            projectId_snapshotDate: {
              projectId: project.id,
              snapshotDate: today,
            },
          },
          update: {
            critical: summary.critical,
            onflow: summary.onflow,
            healthy: summary.healthy,
            unclassified: summary.unclassified,
            totalKpis: summary.total,
            incidentReports: incidentCountByProject.get(project.id) || 0,
            projectProgress: project.progress || 0,
            projectStatus: project.status,
          },
          create: {
            projectId: project.id,
            snapshotDate: today,
            critical: summary.critical,
            onflow: summary.onflow,
            healthy: summary.healthy,
            unclassified: summary.unclassified,
            totalKpis: summary.total,
            incidentReports: incidentCountByProject.get(project.id) || 0,
            projectProgress: project.progress || 0,
            projectStatus: project.status,
          },
        });
      })
    );

    const trendStart = new Date(today);
    trendStart.setUTCDate(trendStart.getUTCDate() - 6);
    const snapshots = projectIds.length
      ? await (prisma as any).projectDashboardSnapshot.findMany({
          where: {
            projectId: { in: projectIds },
            snapshotDate: { gte: trendStart, lte: today },
            projectStatus: "ACTIVE",
          },
          orderBy: { snapshotDate: "asc" },
        })
      : [];
    const trends = this.buildSevenDayTrends(snapshots, today, {
      critical: kpiSummary.critical,
      onflow: kpiSummary.onflow,
      healthy: kpiSummary.healthy,
      incidentReports,
      activeProjects: totalProjects,
    });

    const pendingReviewAndApproval = pendingProjects
      .map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        progress: this.round(project.progress || 0),
        version: project.versionLabel || `v${project.versionNumber}`,
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
      summary: {
        critical: kpiSummary.critical,
        onflow: kpiSummary.onflow,
        healthy: kpiSummary.healthy,
        unclassified: kpiSummary.unclassified,
        totalKpis: kpiSummary.total,
        incidentReports,
        activeProjects: projects.filter((project) => project.status === "ACTIVE").length,
        totalProjects,
      },
      topProjects: rankedProjects.slice(0, 5),
      topIncidents,
      overallProjects: {
        total: totalProjects,
        statusDistribution,
        progress: {
          average: averageProgress,
          distribution: progressDistribution,
        },
      },
      trends,
      pendingReviewAndApproval,
      generatedAt: new Date().toISOString(),
    };
  }

  private getHealthStatus(summary: any) {
    if (!summary || summary.total === 0) return "UNCLASSIFIED";
    if (summary.critical > 0) return "CRITICAL";
    if (summary.onflow > 0) return "ONFLOW";
    if (summary.healthy > 0) return "HEALTHY";
    return "UNCLASSIFIED";
  }

  private round(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private startOfUtcDay(date: Date) {
    const result = new Date(date);
    result.setUTCHours(0, 0, 0, 0);
    return result;
  }

  private buildSevenDayTrends(
    snapshots: any[],
    today: Date,
    current: {
      critical: number;
      onflow: number;
      healthy: number;
      incidentReports: number;
      activeProjects: number;
    }
  ) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() - (6 - index));
      return date;
    });
    const grouped = new Map<string, any[]>();
    snapshots.forEach((snapshot) => {
      const key = this.dateKey(snapshot.snapshotDate);
      const values = grouped.get(key) || [];
      values.push(snapshot);
      grouped.set(key, values);
    });

    const metricPoints = {
      critical: [] as Array<{ date: string; value: number | null }>,
      onflow: [] as Array<{ date: string; value: number | null }>,
      healthy: [] as Array<{ date: string; value: number | null }>,
      incidentReports: [] as Array<{ date: string; value: number | null }>,
      activeProjects: [] as Array<{ date: string; value: number | null }>,
      averageProgress: [] as Array<{ date: string; value: number | null }>,
    };

    days.forEach((day) => {
      const date = this.dateKey(day);
      const rows = grouped.get(date) || [];
      const valueOrNull = (field: string) =>
        rows.length
          ? rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)
          : null;
      metricPoints.critical.push({ date, value: valueOrNull("critical") });
      metricPoints.onflow.push({ date, value: valueOrNull("onflow") });
      metricPoints.healthy.push({ date, value: valueOrNull("healthy") });
      metricPoints.incidentReports.push({
        date,
        value: valueOrNull("incidentReports"),
      });
      metricPoints.activeProjects.push({
        date,
        value: rows.length ? rows.length : null,
      });
      metricPoints.averageProgress.push({
        date,
        value: rows.length
          ? this.round(
              rows.reduce(
                (sum, row) => sum + Number(row.projectProgress || 0),
                0
              ) / rows.length
            )
          : null,
      });
    });

    const isComplete = days.every((day) => grouped.has(this.dateKey(day)));
    return {
      period: "LAST_7_DAYS",
      dateFrom: this.dateKey(days[0]),
      dateTo: this.dateKey(days[days.length - 1]),
      isComplete,
      note: isComplete
        ? null
        : "Trend history begins when daily dashboard snapshots are first captured.",
      critical: this.metricTrend(metricPoints.critical, current.critical),
      onflow: this.metricTrend(metricPoints.onflow, current.onflow),
      healthy: this.metricTrend(metricPoints.healthy, current.healthy),
      incidentReports: this.metricTrend(
        metricPoints.incidentReports,
        current.incidentReports
      ),
      activeProjects: this.metricTrend(
        metricPoints.activeProjects,
        current.activeProjects
      ),
      averageProjectProgress: this.metricTrend(
        metricPoints.averageProgress,
        metricPoints.averageProgress[metricPoints.averageProgress.length - 1]
          ?.value || 0
      ),
    };
  }

  private metricTrend(
    points: Array<{ date: string; value: number | null }>,
    currentValue: number
  ) {
    const firstAvailable = points.find((point) => point.value !== null)?.value;
    const baseline = firstAvailable ?? currentValue;
    const change = this.round(currentValue - baseline);
    const changePercentage =
      baseline === 0
        ? currentValue > 0
          ? 100
          : 0
        : this.round((change / baseline) * 100);
    return {
      value: currentValue,
      change,
      changePercentage,
      direction: change > 0 ? "UP" : change < 0 ? "DOWN" : "FLAT",
      points,
    };
  }

  private dateKey(value: Date | string) {
    return new Date(value).toISOString().slice(0, 10);
  }
}

export const dashboardService = new DashboardService();
