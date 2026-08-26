import { PrismaClient } from "@prisma/client";
import { HolidayService } from "../admin/holidays/holiday.service";

const prisma = new PrismaClient();
const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Converts a stored timestamp to its business calendar date (Asia/Manila). */
function manilaCalendarDay(date: Date): Date {
  const key = new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

function isWorkingDay(date: Date, project: any, holidayKeys: Set<string>): boolean {
  const enabled = [
    project.sunday, project.monday, project.tuesday, project.wednesday,
    project.thursday, project.friday, project.saturday,
  ][date.getUTCDay()];
  return Boolean(enabled) && !(project.includeHolidays && holidayKeys.has(date.toISOString().slice(0, 10)));
}

function countWorkingDays(start: Date, end: Date, project: any, holidayKeys: Set<string>): number {
  let count = 0;
  for (let day = start; day <= end; day = new Date(day.getTime() + DAY_MS)) {
    if (isWorkingDay(day, project, holidayKeys)) count++;
  }
  return count;
}

function plannedProgressAt(subtask: any, day: Date, project: any, holidayKeys: Set<string>): number | null {
  if (!subtask.projectedStartDate || !subtask.projectedEndDate) return null;
  const start = manilaCalendarDay(subtask.projectedStartDate);
  const end = manilaCalendarDay(subtask.projectedEndDate);
  if (day < start) return 0;
  // A same-day milestone is due in full on that calendar date.
  if (day >= end) return 100;

  const total = countWorkingDays(start, end, project, holidayKeys);
  if (total === 0) return 0;
  return Math.min(100, (countWorkingDays(start, day, project, holidayKeys) / total) * 100);
}

export async function getSCurve(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || !project.startDate || !project.expectedEndDate) {
    throw new Error("Project dates are required");
  }

  const start = manilaCalendarDay(project.startDate);
  const end = manilaCalendarDay(project.expectedEndDate);
  const holidays = await HolidayService.getHolidaysInRange(project.startDate, project.expectedEndDate);
  const holidayKeys = new Set(
    holidays.map((holiday: any) => manilaCalendarDay(new Date(holiday.date)).toISOString().slice(0, 10))
  );

  const dates: Date[] = [];
  for (let day = start; day <= end; day = new Date(day.getTime() + DAY_MS)) {
    if (isWorkingDay(day, project, holidayKeys)) dates.push(day);
  }

  const subtasks = await prisma.subtask.findMany({
    where: { task: { scope: { projectId } } },
    include: { task: { include: { scope: true } }, progressLogs: true },
  });

  const result: Array<{ date: string; planned: number; actual: number }> = [];
  let lastActual = 0;
  for (const day of dates) {
    let plannedTotal = 0;
    let plannedWeightSum = 0;
    let actualTotal = 0;
    let actualWeightSum = 0;
    // End of the Manila business day, despite `day` being represented at UTC midnight.
    const cutoff = new Date(day.getTime() + DAY_MS - MANILA_OFFSET_MS - 1);

    for (const subtask of subtasks) {
      const weight = (subtask.budgetPercent || subtask.task.scope.budgetPercent || 1) / 100;
      const planned = plannedProgressAt(subtask, day, project, holidayKeys);
      if (planned !== null) {
        plannedWeightSum += weight;
        plannedTotal += planned * weight;
      }

      actualWeightSum += weight;
      const latest = subtask.progressLogs.reduce<any | null>(
        (current, log) =>
          log.date <= cutoff && (!current || log.date > current.date) ? log : current,
        null,
      );
      actualTotal += Number(latest?.cumulativePercent || 0) * weight;
    }

    const planned = plannedWeightSum ? plannedTotal / plannedWeightSum : 0;
    const actual = actualWeightSum ? actualTotal / actualWeightSum : 0;
    lastActual = Math.max(lastActual, actual);
    result.push({
      date: day.toISOString().slice(0, 10),
      planned: Number(planned.toFixed(2)),
      actual: Number(lastActual.toFixed(2)),
    });
  }

  const last = result[result.length - 1];
  const status = last && last.actual + 5 < last.planned
    ? "DELAYED"
    : last && last.actual > last.planned + 5
      ? "AHEAD"
      : "ON_TRACK";
  return { data: result, status };
}
