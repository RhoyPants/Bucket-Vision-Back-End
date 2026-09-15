const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Converts a stored timestamp to its business calendar date (Asia/Manila). */
export function manilaCalendarDay(date: Date): Date {
  const key = new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

export function isWorkingDay(date: Date, project: any, holidayKeys: Set<string>): boolean {
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

export function plannedProgressAt(subtask: any, day: Date, project: any, holidayKeys: Set<string>): number | null {
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

