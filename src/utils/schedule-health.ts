import { isWorkingDay, manilaCalendarDay } from "../modules/progress/planned-progress";

export const HEALTH_RULES_VERSION = 2;
export type ScheduleHealthStatus = "DANGER" | "WARNING" | "HEALTHY" | "NOT_STARTED" | "UNCLASSIFIED";

export interface WorkSchedule {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  includeHolidays: boolean;
  holidayKeys: Set<string>;
}

export interface HealthSummary {
  total: number;
  danger: number;
  warning: number;
  healthy: number;
  notStarted: number;
  unclassified: number;
}

function validDate(date: Date | null | undefined): date is Date {
  return date instanceof Date && Number.isFinite(date.getTime());
}

export function validProgress(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value : null;
}

export interface RecordedProgress {
  date: Date;
  cumulativePercent: number | null;
}

export function recordedProgressAt(logs: ReadonlyArray<RecordedProgress>, cutoff: Date): number | null {
  let latest: RecordedProgress | undefined;
  for (const log of logs) {
    if (log.date <= cutoff && (!latest || log.date >= latest.date)) latest = log;
  }
  return latest ? validProgress(latest.cumulativePercent) : 0;
}

export function recordedStartAt(
  logs: ReadonlyArray<RecordedProgress>, actualStartDate: Date | null | undefined, cutoff: Date
): Date | null {
  const dates = logs
    .filter((log) => log.date <= cutoff && (validProgress(log.cumulativePercent) ?? 0) > 0)
    .map((log) => log.date);
  if (validDate(actualStartDate) && actualStartDate <= cutoff) dates.push(actualStartDate);
  return dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
}

export function expectedProgressAt(
  asOf: Date, startDate: Date | null, endDate: Date | null, schedule: WorkSchedule
): number | null {
  if (!validDate(asOf)) throw new Error("Schedule health evaluation date is invalid");
  if (!validDate(startDate) || !validDate(endDate)) return null;
  const start = manilaCalendarDay(startDate);
  const end = manilaCalendarDay(endDate);
  const day = manilaCalendarDay(asOf);
  if (end < start) return null;
  if (day < start) return 0;
  if (day >= end) return 100;
  let total = 0;
  let elapsed = 0;
  for (let time = start.getTime(); time <= end.getTime(); time += 86400000) {
    const date = new Date(time);
    if (isWorkingDay(date, schedule, schedule.holidayKeys)) {
      total++;
      if (date <= day) elapsed++;
    }
  }
  return total ? elapsed / total * 100 : null;
}

export function evaluateScheduleHealth(input: {
  actualProgress: number | null;
  startDate: Date | null;
  endDate: Date | null;
  actualStartDate?: Date | null;
  forecastEndDate?: Date | null;
  asOf: Date;
  schedule: WorkSchedule;
}) {
  const { asOf, startDate, endDate, schedule } = input;
  const expectedProgress = expectedProgressAt(asOf, startDate, endDate, schedule);
  const actualProgress = validProgress(input.actualProgress);
  const variance = actualProgress !== null && expectedProgress !== null
    ? actualProgress - expectedProgress : null;
  const result = (status: ScheduleHealthStatus, statusReason: string) =>
    ({ status, statusReason, actualProgress, expectedProgress, variance });

  if (actualProgress === null) return result("UNCLASSIFIED", "Actual progress is missing or invalid.");
  if (actualProgress === 100) return result("HEALTHY", "Completed at 100%.");
  if (expectedProgress === null || !validDate(startDate) || !validDate(endDate)) {
    return result("UNCLASSIFIED", "Planned schedule is missing or invalid.");
  }
  const day = manilaCalendarDay(asOf);
  const deadline = manilaCalendarDay(endDate);
  if (day > deadline) return result("DANGER", `Incomplete after the ${deadline.toISOString().slice(0, 10)} deadline.`);
  const started = actualProgress > 0 ||
    (validDate(input.actualStartDate) && input.actualStartDate <= asOf);
  if (!started && day > manilaCalendarDay(startDate)) {
    return result("WARNING", "Planned start has been missed.");
  }
  if (variance !== null && variance < 0) return result("WARNING", "Actual progress is behind expected progress.");
  if (validDate(input.forecastEndDate) && manilaCalendarDay(input.forecastEndDate) > deadline) {
    return result("WARNING", "Forecast finish exceeds the planned deadline.");
  }
  if (!started) return result("NOT_STARTED", "Not started and not yet behind schedule.");
  return result("HEALTHY", "Progress is on schedule.");
}

export function summarizeHealth(items: ReadonlyArray<{ status: ScheduleHealthStatus }>): HealthSummary {
  const summary: HealthSummary = { total: items.length, danger: 0, warning: 0, healthy: 0, notStarted: 0, unclassified: 0 };
  const keys = { DANGER: "danger", WARNING: "warning", HEALTHY: "healthy", NOT_STARTED: "notStarted", UNCLASSIFIED: "unclassified" } as const;
  for (const item of items) summary[keys[item.status]]++;
  return summary;
}

export function rollupHealth(summary: HealthSummary): ScheduleHealthStatus {
  if (summary.danger) return "DANGER";
  if (summary.warning) return "WARNING";
  if (summary.healthy) return "HEALTHY";
  if (summary.notStarted) return "NOT_STARTED";
  return "UNCLASSIFIED";
}

export function validateWarningBelow(value: unknown, required = false) {
  if (value === undefined && !required) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value !== 0) {
    throw new Error("Configurable V2 tolerance is not supported; warningBelow must be the number 0.");
  }
}
