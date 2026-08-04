import prisma from "../../config/prisma";
import {
  parseCalendarMonth,
  parseReportPeriod,
  utcToManilaDateKey,
} from "../validators/report-request.validator";
import { ReportPeriod, ReportRequestQuery } from "../types/report.types";
import {
  CalculableSubtask,
  reportCalculationService as calculator,
  WorkSchedule,
} from "./report-calculation.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export class ReportDataService {
  async buildPreview(projectId: string, userId: string, query: ReportRequestQuery) {
    const period = parseReportPeriod(query);
    const project = await this.loadAccessibleProject(projectId, userId, period.cutoffUtc);
    const generatedBy = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (project.startDate && period.cutoffUtc < project.startDate) {
      throw httpError("Report period is before the project start date", 400);
    }

    const holidays = await prisma.holiday.findMany({
      where: {
        date: {
          gte: project.startDate || period.startUtc,
          lte: period.cutoffUtc,
        },
      },
      select: { date: true },
    });
    const schedule = this.schedule(project, holidays.map((item) => item.date));
    const kpiConfig = project.subtaskKpiConfig || {
      criticalBelow: -15,
      healthyAtOrAbove: -5,
    };
    const subtasks = this.flattenSubtasks(project);

    const actualProgress = calculator.aggregate(subtasks, (subtask) =>
      calculator.actualAt(subtask, period.cutoffUtc)
    ) ?? 0;
    const openingProgress =
      calculator.aggregate(subtasks, (subtask) =>
        calculator.actualAt(subtask, period.openingCutoffUtc)
      ) ?? 0;
    const expectedProgress = calculator.aggregate(subtasks, (subtask) =>
      calculator.expectedAt(subtask, period.cutoffUtc, schedule)
    );
    const variance =
      expectedProgress === null
        ? null
        : calculator.round(actualProgress - expectedProgress);

    const scopes = project.scopes.map((scope: any) => ({
      id: scope.id,
      name: scope.name,
      description: scope.description,
      metrics: this.metrics(scope.tasks.flatMap((task: any) => task.subtasks), period, schedule, kpiConfig),
      tasks: scope.tasks.map((task: any) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        metrics: this.metrics(task.subtasks, period, schedule, kpiConfig),
        subtasks: task.subtasks.map((subtask: any) => ({
          id: subtask.id,
          title: subtask.title,
          description: subtask.description,
          projectedStartDate: subtask.projectedStartDate,
          projectedEndDate: subtask.projectedEndDate,
          metrics: this.metrics([subtask], period, schedule, kpiConfig),
        })),
      })),
    }));

    const [incidents, photos] = await Promise.all([
      this.loadIncidents(projectId, period),
      this.loadPhotos(projectId, period),
    ]);
    const progressAudit = this.buildProgressAudit(
      subtasks,
      period,
      schedule,
      kpiConfig
    );

    return {
      report: {
        type: period.type,
        timezone: period.timezone,
        periodStart: period.startDate,
        periodEnd: period.endDate,
        generatedAt: new Date().toISOString(),
        generatedBy,
      },
      project: {
        id: project.id,
        name: project.name,
        pin: project.pin,
        description: project.description,
        location: project.location,
        startDate: project.startDate,
        expectedEndDate: project.expectedEndDate,
        totalBudget: project.totalBudget,
        owner: project.owner,
      },
      summary: {
        expectedProgress,
        actualProgress,
        openingProgress: period.type === "WEEKLY" ? openingProgress : null,
        periodProgress:
          period.type === "WEEKLY"
            ? calculator.round(actualProgress - openingProgress)
            : calculator.round(actualProgress - openingProgress),
        totalProjectProgress: actualProgress,
        variance,
        health: calculator.health(actualProgress, expectedProgress, kpiConfig),
      },
      sCurve: await this.buildSCurve(project, subtasks, period, schedule),
      progressAudit,
      incidents,
      photos,
      detailedProgress: scopes,
      calculationRules: {
        actual: "Latest cumulative progress log on or before the reporting cutoff.",
        expected:
          "Linear planned progress across configured working days and holidays for each dated subtask.",
        aggregation:
          "First positive available weight: subtask budget %, subtask budget, task budget %, task budget, scope budget %, scope budget; otherwise equal weight.",
        healthThresholds: {
          delayedBelowVariance: kpiConfig.criticalBelow,
          healthyAtOrAboveVariance: kpiConfig.healthyAtOrAbove,
        },
        limitations: [
          "Reasonableness checks identify data consistency and planned pace only; they do not assign delay causation.",
          "Changes to projected dates and weights are not historically versioned; Phase 2 snapshots are required for immutable regeneration after configuration edits.",
        ],
      },
      emptyStates: {
        noIncidents: incidents.length === 0,
        noPhotos: photos.length === 0,
        noProgressUpdates: !subtasks.some((subtask) =>
          subtask.progressLogs.some(
            (log) => log.date >= period.startUtc && log.date < period.endExclusiveUtc
          )
        ),
      },
    };
  }

  async getCalendar(projectId: string, userId: string, monthValue: unknown) {
    const month = parseCalendarMonth(monthValue);
    const project = await this.loadProjectForAccess(projectId, userId);

    const [progressLogs, incidents, dailyReports, weeklyReports] = await Promise.all([
      prisma.progressLog.findMany({
        where: {
          date: { gte: month.startUtc, lt: month.endExclusiveUtc },
          subtask: { task: { scope: { projectId } } },
        },
        select: {
          date: true,
          photoUrl: true,
          attachments: { select: { mimeType: true } },
        },
      }),
      prisma.incidentReport.findMany({
        where: {
          projectId,
          cancelledAt: null,
          dateRaised: { gte: month.startUtc, lt: month.endExclusiveUtc },
        },
        select: { dateRaised: true },
      }),
      prisma.dailyReport.findMany({
        where: { projectId, date: { gte: month.startUtc, lt: month.endExclusiveUtc } },
        select: { date: true },
      }),
      prisma.weeklyReport.findMany({
        where: {
          projectId,
          dateFrom: { lt: month.endExclusiveUtc },
          dateTo: { gte: month.startUtc },
        },
        select: { dateFrom: true, dateTo: true },
      }),
    ]);

    const entries = new Map<string, any>();
    const ensure = (key: string) => {
      if (!entries.has(key)) {
        entries.set(key, {
          date: key,
          hasProgress: false,
          progressUpdates: 0,
          photos: 0,
          incidents: 0,
          reportGenerated: false,
        });
      }
      return entries.get(key);
    };

    for (const log of progressLogs) {
      const entry = ensure(utcToManilaDateKey(log.date));
      entry.hasProgress = true;
      entry.progressUpdates++;
      entry.photos +=
        (log.photoUrl ? 1 : 0) +
        log.attachments.filter((attachment) =>
          attachment.mimeType?.toLowerCase().startsWith("image/")
        ).length;
    }
    for (const incident of incidents) ensure(utcToManilaDateKey(incident.dateRaised)).incidents++;
    for (const report of dailyReports) ensure(utcToManilaDateKey(report.date)).reportGenerated = true;
    for (const report of weeklyReports) {
      let cursor = this.manilaCalendarDay(report.dateFrom);
      const end = this.manilaCalendarDay(report.dateTo);
      while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 10);
        if (key.startsWith(month.month)) ensure(key).reportGenerated = true;
        cursor = new Date(cursor.getTime() + DAY_MS);
      }
    }

    return {
      project: { id: project.id, name: project.name, startDate: project.startDate },
      month: month.month,
      timezone: "Asia/Manila",
      dates: Array.from(entries.values()).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  private async loadAccessibleProject(projectId: string, userId: string, cutoff: Date) {
    await this.loadProjectForAccess(projectId, userId);
    const activeAtCutoff = {
      createdAt: { lte: cutoff },
      OR: [{ deletedAt: null }, { deletedAt: { gt: cutoff } }],
    };

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        subtaskKpiConfig: {
          select: { criticalBelow: true, healthyAtOrAbove: true },
        },
        scopes: {
          where: activeAtCutoff,
          orderBy: { order: "asc" },
          include: {
            tasks: {
              where: activeAtCutoff,
              orderBy: { order: "asc" },
              include: {
                scope: {
                  select: { budgetPercent: true, budgetAllocated: true },
                },
                subtasks: {
                  where: activeAtCutoff,
                  orderBy: { order: "asc" },
                  include: {
                    task: {
                      select: {
                        id: true,
                        title: true,
                        budgetPercent: true,
                        budgetAllocated: true,
                        scope: {
                          select: {
                            id: true,
                            name: true,
                            budgetPercent: true,
                            budgetAllocated: true,
                          },
                        },
                      },
                    },
                    progressLogs: {
                      where: { date: { lte: cutoff } },
                      orderBy: [{ date: "asc" }, { updatedAt: "asc" }],
                      include: {
                        user: {
                          select: { id: true, name: true, email: true },
                        },
                        attachments: {
                          select: { id: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!project) throw httpError("Project not found", 404);
    return project;
  }

  private async loadProjectForAccess(projectId: string, userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { businessUnitId: true, role: { select: { name: true } } },
    });
    if (!user) throw httpError("User not found", 401);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        businessUnit: true,
        startDate: true,
        projectMembers: { where: { userId }, select: { id: true } },
      },
    });
    if (!project) throw httpError("Project not found", 404);

    const role = user.role?.name?.toUpperCase();
    const canViewAll = role === "SUPERADMIN" || role === "OP";
    const sameBusinessUnitHead =
      role === "BU_HEAD" &&
      !!user.businessUnitId &&
      user.businessUnitId === project.businessUnit;
    const hasAccess =
      canViewAll ||
      sameBusinessUnitHead ||
      project.ownerId === userId ||
      project.projectMembers.length > 0;
    if (!hasAccess) throw httpError("You do not have access to this project", 403);
    return project;
  }

  private metrics(
    subtasks: CalculableSubtask[],
    period: ReportPeriod,
    schedule: WorkSchedule,
    config: { criticalBelow: number; healthyAtOrAbove: number }
  ) {
    const actual = calculator.aggregate(subtasks, (item) =>
      calculator.actualAt(item, period.cutoffUtc)
    ) ?? 0;
    const opening = calculator.aggregate(subtasks, (item) =>
      calculator.actualAt(item, period.openingCutoffUtc)
    ) ?? 0;
    const expected = calculator.aggregate(subtasks, (item) =>
      calculator.expectedAt(item, period.cutoffUtc, schedule)
    );
    const variance = expected === null ? null : calculator.round(actual - expected);
    return {
      expectedProgress: expected,
      actualProgress: actual,
      variance,
      health: calculator.health(actual, expected, config),
      periodProgress: calculator.round(actual - opening),
    };
  }

  private buildProgressAudit(
    subtasks: any[],
    period: ReportPeriod,
    schedule: WorkSchedule,
    config: { criticalBelow: number; healthyAtOrAbove: number }
  ) {
    const entries = subtasks
      .flatMap((subtask) => {
        const orderedLogs = [...subtask.progressLogs].sort(
          (a: any, b: any) =>
            a.date.getTime() - b.date.getTime() ||
            a.updatedAt.getTime() - b.updatedAt.getTime()
        );

        return orderedLogs
          .map((log: any, index: number) => {
            if (log.date < period.startUtc || log.date >= period.endExclusiveUtc) {
              return null;
            }

            const previousProgress =
              index > 0 ? Number(orderedLogs[index - 1].cumulativePercent) : 0;
            const progressAfter = Number(log.cumulativePercent);
            const expectedAfter = calculator.expectedAt(
              subtask,
              this.endOfManilaDay(log.date),
              schedule
            );
            const varianceAfter =
              expectedAfter === null
                ? null
                : calculator.round(progressAfter - expectedAfter);
            const expectedCumulative = Math.min(
              100,
              Math.max(0, previousProgress + Number(log.dailyPercent))
            );
            const checks: Array<{ code: string; severity: "INFO" | "WARNING"; message: string }> = [];

            if (Math.abs(expectedCumulative - progressAfter) > 0.01) {
              checks.push({
                code: "CUMULATIVE_MISMATCH",
                severity: "WARNING",
                message:
                  "Cumulative progress does not reconcile with the previous cumulative value plus this entry.",
              });
            }
            if (progressAfter < previousProgress) {
              checks.push({
                code: "PROGRESS_DECREASED",
                severity: "WARNING",
                message: "Cumulative progress decreased after this entry.",
              });
            }
            if (
              subtask.projectedStartDate &&
              log.date < this.startOfManilaDay(subtask.projectedStartDate)
            ) {
              checks.push({
                code: "BEFORE_PLANNED_START",
                severity: "INFO",
                message: "Progress was recorded before the projected start date.",
              });
            }
            if (
              subtask.projectedEndDate &&
              log.date > this.endOfManilaDay(subtask.projectedEndDate) &&
              progressAfter < 100
            ) {
              checks.push({
                code: "AFTER_PLANNED_END_INCOMPLETE",
                severity: "WARNING",
                message: "Progress was recorded after the projected end date while the subtask remained incomplete.",
              });
            }

            return {
              progressLogId: log.id,
              date: utcToManilaDateKey(log.date),
              submittedAt: log.createdAt,
              lastUpdatedAt: log.updatedAt,
              submittedBy: log.user
                ? {
                    id: log.user.id,
                    name: log.user.name,
                    email: log.user.email,
                  }
                : null,
              scope: subtask.task.scope,
              task: {
                id: subtask.task.id,
                title: subtask.task.title,
              },
              subtask: {
                id: subtask.id,
                title: subtask.title,
              },
              dailyProgress: Number(log.dailyPercent),
              previousProgress,
              progressAfter,
              subtaskStatusAfter: this.progressStatus(progressAfter),
              expectedProgressAfter: expectedAfter,
              varianceAfter,
              healthAfter: calculator.health(progressAfter, expectedAfter, config),
              paceStatus:
                expectedAfter === null
                  ? "UNCLASSIFIED"
                  : progressAfter >= expectedAfter
                    ? "ON_OR_ABOVE_PLAN"
                    : "BELOW_PLAN",
              assessment: checks.some((check) => check.severity === "WARNING")
                ? "REVIEW_REQUIRED"
                : "CONSISTENT",
              checks,
              remarks: log.remarks,
              location: log.location,
              coordinates:
                log.latitude === null || log.longitude === null
                  ? null
                  : { latitude: log.latitude, longitude: log.longitude },
              photoCount: (log.photoUrl ? 1 : 0) + log.attachments.length,
            };
          })
          .filter(Boolean);
      })
      .sort((a: any, b: any) =>
        a.date.localeCompare(b.date) ||
        String(a.lastUpdatedAt).localeCompare(String(b.lastUpdatedAt))
      );

    const openingExpected = calculator.aggregate(subtasks, (subtask) =>
      calculator.expectedAt(subtask, period.openingCutoffUtc, schedule)
    );
    const closingExpected = calculator.aggregate(subtasks, (subtask) =>
      calculator.expectedAt(subtask, period.cutoffUtc, schedule)
    );
    const openingActual =
      calculator.aggregate(subtasks, (subtask) =>
        calculator.actualAt(subtask, period.openingCutoffUtc)
      ) ?? 0;
    const closingActual =
      calculator.aggregate(subtasks, (subtask) =>
        calculator.actualAt(subtask, period.cutoffUtc)
      ) ?? 0;
    const plannedDuringPeriod =
      openingExpected === null || closingExpected === null
        ? null
        : calculator.round(closingExpected - openingExpected);
    const deliveredDuringPeriod = calculator.round(closingActual - openingActual);
    const paceVariance =
      plannedDuringPeriod === null
        ? null
        : calculator.round(deliveredDuringPeriod - plannedDuringPeriod);

    return {
      summary: {
        totalEntries: entries.length,
        contributors: new Set(
          entries.map((entry: any) => entry.submittedBy?.id).filter(Boolean)
        ).size,
        subtasksUpdated: new Set(entries.map((entry: any) => entry.subtask.id)).size,
        deliveredDuringPeriod,
        plannedDuringPeriod,
        paceVariance,
        paceStatus:
          paceVariance === null
            ? "UNCLASSIFIED"
            : paceVariance >= 0
              ? "ON_OR_ABOVE_PLAN"
              : "BELOW_PLAN",
        reviewRequiredEntries: entries.filter(
          (entry: any) => entry.assessment === "REVIEW_REQUIRED"
        ).length,
      },
      entries,
      assessmentNote:
        "CONSISTENT validates stored progress sequencing. Pace compares delivered progress with planned progress; it does not determine responsibility or root cause.",
    };
  }

  private flattenSubtasks(project: any): CalculableSubtask[] {
    return project.scopes.flatMap((scope: any) =>
      scope.tasks.flatMap((task: any) => task.subtasks)
    );
  }

  private schedule(project: any, holidays: Date[]): WorkSchedule {
    return {
      monday: project.monday,
      tuesday: project.tuesday,
      wednesday: project.wednesday,
      thursday: project.thursday,
      friday: project.friday,
      saturday: project.saturday,
      sunday: project.sunday,
      includeHolidays: project.includeHolidays,
      holidayKeys: new Set(holidays.map((date) => utcToManilaDateKey(date))),
    };
  }

  private async buildSCurve(
    project: any,
    subtasks: CalculableSubtask[],
    period: ReportPeriod,
    schedule: WorkSchedule
  ) {
    if (!project.startDate || !project.expectedEndDate || !subtasks.length) return [];
    const start = this.manilaCalendarDay(project.startDate);
    const end = this.manilaCalendarDay(project.expectedEndDate);
    const reportCutoffDay = this.manilaCalendarDay(period.cutoffUtc);
    const points = [];

    for (let day = start; day <= end; day = new Date(day.getTime() + DAY_MS)) {
      const cutoff = new Date(day.getTime() + DAY_MS - MANILA_OFFSET_MS - 1);
      points.push({
        date: day.toISOString().slice(0, 10),
        planned:
          calculator.aggregate(subtasks, (subtask) =>
            calculator.expectedAt(subtask, cutoff, schedule)
          ) ?? 0,
        actual:
          day <= reportCutoffDay
            ? calculator.aggregate(subtasks, (subtask) =>
                calculator.actualAt(subtask, cutoff)
              ) ?? 0
            : null,
      });
    }
    return points;
  }

  private async loadIncidents(projectId: string, period: ReportPeriod) {
    return prisma.incidentReport.findMany({
      where: {
        projectId,
        cancelledAt: null,
        dateRaised: { gte: period.startUtc, lt: period.endExclusiveUtc },
      },
      select: {
        id: true,
        incidentNumber: true,
        title: true,
        description: true,
        severity: true,
        status: true,
        dateRaised: true,
        dateAddressed: true,
        remarks: true,
        scope: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        subtask: { select: { id: true, title: true } },
      },
      orderBy: { dateRaised: "asc" },
    });
  }

  private async loadPhotos(projectId: string, period: ReportPeriod) {
    const logs = await prisma.progressLog.findMany({
      where: {
        date: { gte: period.startUtc, lt: period.endExclusiveUtc },
        subtask: {
          deletedAt: null,
          task: { deletedAt: null, scope: { projectId, deletedAt: null } },
        },
      },
      select: {
        id: true,
        date: true,
        photoUrl: true,
        remarks: true,
        user: { select: { id: true, name: true } },
        subtask: {
          select: {
            id: true,
            title: true,
            task: { select: { id: true, title: true, scope: { select: { id: true, name: true } } } },
          },
        },
        attachments: {
          where: { mimeType: { startsWith: "image/", mode: "insensitive" } },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { date: "desc" },
    });

    return logs
      .flatMap((log) => {
        const common = {
          progressLogId: log.id,
          date: log.date,
          caption: log.remarks || log.subtask.title,
          uploadedBy: log.user,
          scope: log.subtask.task.scope,
          task: { id: log.subtask.task.id, title: log.subtask.task.title },
          subtask: { id: log.subtask.id, title: log.subtask.title },
        };
        return [
          ...(log.photoUrl ? [{ ...common, url: log.photoUrl, name: null }] : []),
          ...log.attachments.map((attachment) => ({
            ...common,
            url: attachment.url,
            name: attachment.name,
          })),
        ];
      })
      .slice(0, 3);
  }

  private manilaCalendarDay(date: Date) {
    return new Date(`${utcToManilaDateKey(date)}T00:00:00.000Z`);
  }

  private startOfManilaDay(date: Date) {
    return new Date(this.manilaCalendarDay(date).getTime() - MANILA_OFFSET_MS);
  }

  private endOfManilaDay(date: Date) {
    return new Date(
      this.manilaCalendarDay(date).getTime() + DAY_MS - MANILA_OFFSET_MS - 1
    );
  }

  private progressStatus(progress: number) {
    if (progress >= 100) return "DONE";
    if (progress > 0) return "ONGOING";
    return "PENDING";
  }
}

export const reportDataService = new ReportDataService();
