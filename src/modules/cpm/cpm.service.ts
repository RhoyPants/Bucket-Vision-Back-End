import prisma from "../../config/prisma";
import { buildAccessibleProjectWhere, canViewProjectForApproval } from "../project/project-access";
import { calculateCpm, CpmCycleError } from "./cpm.calculator";
import { CpmHttpError, DependencyInput } from "./cpm.types";

interface ProjectData {
  id: string; name: string; startDate: Date | null; expectedEndDate: Date | null;
  monday: boolean; tuesday: boolean; wednesday: boolean; thursday: boolean; friday: boolean;
  saturday: boolean; sunday: boolean; includeHolidays: boolean;
  scopes: Array<{ id: string; name: string; tasks: Array<{ id: string; title: string; subtasks: Array<{
    id: string; title: string; projectedStartDate: Date | null; projectedEndDate: Date | null;
  }> }> }>;
  cpmDependencies: DependencyInput[];
}

const dateKey = (date: Date): string => date.toISOString().slice(0, 10);
const utcDate = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const moveDate = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);

function calendarFor(project: ProjectData, holidays: Date[]) {
  return {
    monday: project.monday,
    tuesday: project.tuesday,
    wednesday: project.wednesday,
    thursday: project.thursday,
    friday: project.friday,
    saturday: project.saturday,
    sunday: project.sunday,
    includeGlobalHolidays: project.includeHolidays,
    holidayKeys: new Set(holidays.map(dateKey)),
  };
}

type Calendar = ReturnType<typeof calendarFor>;

function isWorkingDay(date: Date, calendar: Calendar): boolean {
  const enabled = [calendar.sunday, calendar.monday, calendar.tuesday, calendar.wednesday,
    calendar.thursday, calendar.friday, calendar.saturday][date.getUTCDay()];
  return enabled && (!calendar.includeGlobalHolidays || !calendar.holidayKeys.has(dateKey(date)));
}

function countWorkingDays(start: Date, end: Date, calendar: Calendar): number {
  let count = 0;
  for (let current = utcDate(start); current <= utcDate(end); current = moveDate(current, 1)) {
    if (isWorkingDay(current, calendar)) count++;
  }
  return count;
}

/**
 * CPM uses inclusive day durations. A valid same-calendar-day activity is a
 * one-day milestone even when that date is not enabled in the work calendar.
 * This keeps the dependency graph schedulable instead of reporting a zero
 * duration for a same-day subtask.
 */
export function scheduledDurationDays(start: Date, end: Date, calendar: Calendar): number {
  if (utcDate(start).getTime() === utcDate(end).getTime()) return 1;
  return countWorkingDays(start, end, calendar);
}

function firstWorkingDay(date: Date, calendar: Calendar): Date {
  let current = utcDate(date);
  while (!isWorkingDay(current, calendar)) current = moveDate(current, 1);
  return current;
}

function dateForCpmDay(start: Date, day: number, calendar: Calendar): Date {
  let current = firstWorkingDay(start, calendar);
  let index = 1;
  while (index < day) {
    current = moveDate(current, 1);
    if (isWorkingDay(current, calendar)) index++;
  }
  return current;
}

function workingDayVariance(finish: Date, deadline: Date, calendar: Calendar): number {
  const finishDate = utcDate(finish);
  const deadlineDate = utcDate(deadline);
  if (finishDate.getTime() === deadlineDate.getTime()) return 0;
  if (finishDate < deadlineDate) return countWorkingDays(moveDate(finishDate, 1), deadlineDate, calendar);
  return -countWorkingDays(moveDate(deadlineDate, 1), finishDate, calendar);
}

async function loadProject(projectId: string): Promise<ProjectData | null> {
  return (prisma as any).project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, name: true, startDate: true, expectedEndDate: true,
      monday: true, tuesday: true, wednesday: true, thursday: true,
      friday: true, saturday: true, sunday: true, includeHolidays: true,
      scopes: {
        where: { deletedAt: null }, orderBy: { order: "asc" },
        select: { id: true, name: true, tasks: {
          where: { deletedAt: null }, orderBy: { order: "asc" },
          select: { id: true, title: true, subtasks: {
            where: { deletedAt: null }, orderBy: { order: "asc" },
            select: { id: true, title: true, projectedStartDate: true, projectedEndDate: true },
          } },
        } },
      },
      cpmDependencies: { select: { predecessorSubtaskId: true, successorSubtaskId: true } },
    },
  }) as Promise<ProjectData | null>;
}

async function requireAccessibleProject(
  projectId: string,
  userId: string,
  roleId: string,
  allowApprovalView = false,
) {
  const project = await loadProject(projectId);
  if (!project) throw new CpmHttpError(404, "CPM_PROJECT_NOT_FOUND", "Project not found.");
  const accessible = allowApprovalView
    ? await canViewProjectForApproval(projectId, userId, roleId)
    : Boolean(await prisma.project.findFirst({
      where: { AND: [{ id: projectId }, await buildAccessibleProjectWhere(userId, roleId)] },
      select: { id: true },
    }));
  if (!accessible) throw new CpmHttpError(403, "CPM_PERMISSION_DENIED", "You do not have access to this project.");
  return project;
}

function flattenSubtasks(project: ProjectData) {
  return project.scopes.flatMap((scope) => scope.tasks.flatMap((task) => task.subtasks.map((subtask) => ({
    ...subtask,
    scopeId: scope.id,
    scopeName: scope.name,
    taskId: task.id,
    taskTitle: task.title,
  }))));
}

function missingDates(subtasks: ReturnType<typeof flattenSubtasks>) {
  return subtasks.flatMap((subtask) => {
    const missingFields = [
      !subtask.projectedStartDate && "projectedStartDate",
      !subtask.projectedEndDate && "projectedEndDate",
    ].filter(Boolean) as string[];
    return missingFields.length ? [{ subtaskId: subtask.id, title: subtask.title, missingFields }] : [];
  });
}

async function buildResult(
  project: ProjectData,
  dependencyOverride?: DependencyInput[],
  calculateEmptyGraph = false,
) {
  const subtasks = flattenSubtasks(project);
  const dependencies = dependencyOverride ?? project.cpmDependencies;
  const holidays = project.includeHolidays ? await prisma.holiday.findMany({ select: { date: true } }) : [];
  const calendar = calendarFor(project, holidays.map((holiday) => holiday.date));
  if (![calendar.monday, calendar.tuesday, calendar.wednesday, calendar.thursday,
    calendar.friday, calendar.saturday, calendar.sunday].some(Boolean)) {
    throw new CpmHttpError(422, "CPM_NO_WORKING_DAYS", "The project calendar must include at least one working day.");
  }
  const predecessors = new Map(subtasks.map((subtask) => [subtask.id, [] as string[]]));
  for (const dependency of dependencies) predecessors.get(dependency.successorSubtaskId)?.push(dependency.predecessorSubtaskId);
  const missing = missingDates(subtasks);
  const invalidRanges = subtasks.filter((subtask) => subtask.projectedStartDate && subtask.projectedEndDate && subtask.projectedEndDate < subtask.projectedStartDate);
  const durations = new Map(subtasks.map((subtask) => [subtask.id,
    subtask.projectedStartDate && subtask.projectedEndDate && subtask.projectedEndDate >= subtask.projectedStartDate
      ? scheduledDurationDays(subtask.projectedStartDate, subtask.projectedEndDate, calendar) : null]));
  const zeroDurations = subtasks.filter((subtask) => durations.get(subtask.id) === 0);
  const canCalculate = (calculateEmptyGraph || dependencies.length > 0) && !missing.length && !invalidRanges.length && !zeroDurations.length;
  const calculation = canCalculate ? calculateCpm(
    subtasks.map((subtask) => ({ id: subtask.id, duration: durations.get(subtask.id)! })),
    dependencies.map((edge) => ({ predecessorId: edge.predecessorSubtaskId, successorId: edge.successorSubtaskId })),
  ) : null;
  const anchor = project.startDate || subtasks.reduce<Date | null>((earliest, subtask) =>
    subtask.projectedStartDate && (!earliest || subtask.projectedStartDate < earliest) ? subtask.projectedStartDate : earliest, null);
  const calculatedStart = calculation && calculation.projectDurationDays > 0 && anchor ? firstWorkingDay(anchor, calendar) : null;
  const calculatedFinish = calculation && calculation.projectDurationDays > 0 && anchor ? dateForCpmDay(anchor, calculation.projectDurationDays, calendar) : null;
  const warnings: Array<{ code: string; message: string; details?: unknown }> = [];
  if (!dependencies.length && !calculateEmptyGraph) warnings.push({ code: "CPM_NO_DEPENDENCIES", message: "No subtask dependencies have been configured." });
  if (missing.length) warnings.push({ code: "CPM_MISSING_DATES", message: "All scheduled subtasks must have projected start and end dates.", details: { subtasks: missing } });
  if (invalidRanges.length) warnings.push({ code: "CPM_INVALID_DATE_RANGE", message: "A projected end date cannot be before its projected start date." });
  if (zeroDurations.length) warnings.push({ code: "CPM_NO_WORKING_DAYS", message: "One or more subtask date ranges contain no working days." });

  return {
    project: { id: project.id, name: project.name, startDate: project.startDate ? dateKey(project.startDate) : null, expectedEndDate: project.expectedEndDate ? dateKey(project.expectedEndDate) : null },
    calendar: { monday: calendar.monday, tuesday: calendar.tuesday, wednesday: calendar.wednesday, thursday: calendar.thursday, friday: calendar.friday, saturday: calendar.saturday, sunday: calendar.sunday, includeGlobalHolidays: calendar.includeGlobalHolidays },
    activities: subtasks.map((subtask) => {
      const value = calculation?.values.get(subtask.id);
      return {
        subtaskId: subtask.id, subtaskTitle: subtask.title,
        scopeId: subtask.scopeId, scopeName: subtask.scopeName, taskId: subtask.taskId, taskTitle: subtask.taskTitle,
        projectedStartDate: subtask.projectedStartDate ? dateKey(subtask.projectedStartDate) : null,
        projectedEndDate: subtask.projectedEndDate ? dateKey(subtask.projectedEndDate) : null,
        durationDays: durations.get(subtask.id), predecessorIds: predecessors.get(subtask.id) || [],
        earlyStart: value?.earlyStart ?? null, earlyFinish: value?.earlyFinish ?? null,
        lateStart: value?.lateStart ?? null, lateFinish: value?.lateFinish ?? null,
        slackDays: value?.slackDays ?? null, isCritical: value?.isCritical ?? false,
        calculatedStartDate: value && anchor ? dateKey(dateForCpmDay(anchor, value.earlyStart, calendar)) : null,
        calculatedFinishDate: value && anchor ? dateKey(dateForCpmDay(anchor, value.earlyFinish, calendar)) : null,
      };
    }),
    summary: {
      status: calculation ? "CALCULATED" : dependencies.length || calculateEmptyGraph ? "INVALID" : "NOT_CONFIGURED",
      projectDurationDays: calculation?.projectDurationDays ?? null,
      calculatedStartDate: calculatedStart ? dateKey(calculatedStart) : null,
      calculatedFinishDate: calculatedFinish ? dateKey(calculatedFinish) : null,
      expectedEndDate: project.expectedEndDate ? dateKey(project.expectedEndDate) : null,
      deadlineVarianceDays: calculatedFinish && project.expectedEndDate ? workingDayVariance(calculatedFinish, project.expectedEndDate, calendar) : null,
      meetsDeadline: calculatedFinish && project.expectedEndDate ? calculatedFinish <= utcDate(project.expectedEndDate) : null,
      criticalActivityCount: calculation ? Array.from(calculation.values.values()).filter((value) => value.isCritical).length : 0,
      criticalPaths: calculation?.criticalPaths ?? [],
    },
    warnings,
  };
}

async function validateDependencies(
  project: ProjectData,
  dependencies: DependencyInput[],
  requireSchedulingValidation: boolean,
): Promise<void> {
  const subtasks = flattenSubtasks(project);
  const projectIds = new Set(subtasks.map((subtask) => subtask.id));
  const seen = new Set<string>();
  for (const dependency of dependencies) {
    if (dependency.predecessorSubtaskId === dependency.successorSubtaskId) {
      throw new CpmHttpError(422, "CPM_SELF_DEPENDENCY", "A subtask cannot depend on itself.", { subtaskId: dependency.predecessorSubtaskId });
    }
    const key = `${dependency.predecessorSubtaskId}:${dependency.successorSubtaskId}`;
    if (seen.has(key)) throw new CpmHttpError(422, "CPM_DUPLICATE_DEPENDENCY", "The same dependency was submitted more than once.", dependency);
    seen.add(key);
  }
  const referencedIds = [...new Set(dependencies.flatMap((dependency) => [dependency.predecessorSubtaskId, dependency.successorSubtaskId]))];
  const unknownIds = referencedIds.filter((id) => !projectIds.has(id));
  if (unknownIds.length) {
    const existing = await prisma.subtask.findMany({ where: { id: { in: unknownIds }, deletedAt: null }, select: { id: true } });
    const existingIds = new Set(existing.map((subtask) => subtask.id));
    const missingId = unknownIds.find((id) => !existingIds.has(id));
    if (missingId) throw new CpmHttpError(404, "CPM_SUBTASK_NOT_FOUND", "A referenced subtask was not found.", { subtaskId: missingId });
    const edge = dependencies.find((dependency) => unknownIds.includes(dependency.predecessorSubtaskId) || unknownIds.includes(dependency.successorSubtaskId));
    throw new CpmHttpError(422, "CPM_CROSS_PROJECT_DEPENDENCY", "Both subtasks must belong to the selected project.", edge);
  }
  if (requireSchedulingValidation) {
    const missing = missingDates(subtasks);
    if (missing.length) throw new CpmHttpError(422, "CPM_MISSING_DATES", "All scheduled subtasks must have projected start and end dates.", { subtasks: missing });
    const invalid = subtasks.find((subtask) => subtask.projectedStartDate! > subtask.projectedEndDate!);
    if (invalid) throw new CpmHttpError(422, "CPM_INVALID_DATE_RANGE", "A projected end date cannot be before its projected start date.", { subtaskId: invalid.id });
    const holidays = project.includeHolidays ? await prisma.holiday.findMany({ select: { date: true } }) : [];
    const calendar = calendarFor(project, holidays.map((holiday) => holiday.date));
    if (![calendar.monday, calendar.tuesday, calendar.wednesday, calendar.thursday,
      calendar.friday, calendar.saturday, calendar.sunday].some(Boolean)) {
      throw new CpmHttpError(422, "CPM_NO_WORKING_DAYS", "The project calendar must include at least one working day.");
    }
    const noWorkingDays = subtasks.find(
      (subtask) => scheduledDurationDays(subtask.projectedStartDate!, subtask.projectedEndDate!, calendar) === 0
    );
    if (noWorkingDays) throw new CpmHttpError(422, "CPM_NO_WORKING_DAYS", "A subtask date range contains no working days.", { subtaskId: noWorkingDays.id });
  }
  try {
    calculateCpm(subtasks.map((subtask) => ({ id: subtask.id, duration: 1 })), dependencies.map((edge) => ({ predecessorId: edge.predecessorSubtaskId, successorId: edge.successorSubtaskId })));
  } catch (error) {
    if (error instanceof CpmCycleError) {
      const titles = new Map(subtasks.map((subtask) => [subtask.id, subtask.title]));
      throw new CpmHttpError(409, "CPM_CYCLE_DETECTED", error.message, { subtaskIds: error.cycle, subtaskTitles: error.cycle.map((id) => titles.get(id)) });
    }
    throw error;
  }
}

export class CpmService {
  static async get(projectId: string, userId: string, roleId: string) {
    return buildResult(await requireAccessibleProject(projectId, userId, roleId, true));
  }

  static async save(projectId: string, dependencies: DependencyInput[], userId: string, roleId: string) {
    const project = await requireAccessibleProject(projectId, userId, roleId);
    await validateDependencies(project, dependencies, dependencies.length > 0);
    await prisma.$transaction(async (transaction: any) => {
      await transaction.cpmDependency.deleteMany({ where: { projectId } });
      if (dependencies.length) await transaction.cpmDependency.createMany({ data: dependencies.map((dependency) => ({ projectId, ...dependency })) });
    });
    return buildResult((await loadProject(projectId))!);
  }

  static async preview(projectId: string, dependencies: DependencyInput[], userId: string, roleId: string) {
    const project = await requireAccessibleProject(projectId, userId, roleId);
    await validateDependencies(project, dependencies, true);
    return buildResult(project, dependencies, true);
  }
}
