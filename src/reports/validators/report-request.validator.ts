import { ReportPeriod, ReportRequestQuery } from "../types/report.types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WEEKLY_DAYS = 7;

function requestError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function scalar(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseCalendarDate(value: string, field: string): Date {
  if (!DATE_PATTERN.test(value)) {
    throw requestError(`${field} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  if (
    utcMidnight.getUTCFullYear() !== year ||
    utcMidnight.getUTCMonth() !== month - 1 ||
    utcMidnight.getUTCDate() !== day
  ) {
    throw requestError(`${field} is not a valid calendar date`);
  }
  return utcMidnight;
}

function toManilaStartUtc(calendarDate: Date): Date {
  return new Date(calendarDate.getTime() - MANILA_OFFSET_MS);
}

function dateKey(calendarDate: Date): string {
  return calendarDate.toISOString().slice(0, 10);
}

export function getManilaToday(now = new Date()): string {
  return new Date(now.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

export function utcToManilaDateKey(date: Date): string {
  return new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

export function parseReportPeriod(
  query: ReportRequestQuery,
  now = new Date()
): ReportPeriod {
  const type = scalar(query.type)?.toUpperCase();
  const timezone = scalar(query.timezone) || "Asia/Manila";

  if (type !== "DAILY" && type !== "WEEKLY") {
    throw requestError("type must be DAILY or WEEKLY");
  }
  if (timezone !== "Asia/Manila") {
    throw requestError("Only Asia/Manila timezone is currently supported");
  }

  let startValue: string;
  let endValue: string;

  if (type === "DAILY") {
    const date = scalar(query.date);
    if (!date) throw requestError("date is required for DAILY reports");
    startValue = date;
    endValue = date;
  } else {
    const dateFrom = scalar(query.dateFrom);
    const dateTo = scalar(query.dateTo);
    if (!dateFrom || !dateTo) {
      throw requestError("dateFrom and dateTo are required for WEEKLY reports");
    }
    startValue = dateFrom;
    endValue = dateTo;
  }

  const startCalendar = parseCalendarDate(startValue, type === "DAILY" ? "date" : "dateFrom");
  const endCalendar = parseCalendarDate(endValue, type === "DAILY" ? "date" : "dateTo");
  const spanDays = Math.round((endCalendar.getTime() - startCalendar.getTime()) / DAY_MS) + 1;

  if (spanDays < 1) throw requestError("dateTo must not be before dateFrom");
  if (type === "WEEKLY") {
    if (spanDays > MAX_WEEKLY_DAYS) {
      throw requestError("WEEKLY report ranges cannot exceed 7 calendar days");
    }
    if (startCalendar.getUTCDay() !== 1 || endCalendar.getUTCDay() !== 0 || spanDays !== 7) {
      throw requestError("WEEKLY reports must cover Monday through Sunday");
    }
  }

  if (endValue > getManilaToday(now)) {
    throw requestError("Reports cannot be generated for future dates");
  }

  const startUtc = toManilaStartUtc(startCalendar);
  const endExclusiveUtc = new Date(toManilaStartUtc(endCalendar).getTime() + DAY_MS);

  return {
    type,
    timezone: "Asia/Manila",
    startDate: dateKey(startCalendar),
    endDate: dateKey(endCalendar),
    startUtc,
    endExclusiveUtc,
    cutoffUtc: new Date(endExclusiveUtc.getTime() - 1),
    openingCutoffUtc: new Date(startUtc.getTime() - 1),
  };
}

export function parseCalendarMonth(value: unknown, now = new Date()) {
  const month = scalar(value);
  const resolved = month || getManilaToday(now).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(resolved)) {
    throw requestError("month must use YYYY-MM format");
  }

  const first = parseCalendarDate(`${resolved}-01`, "month");
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  return {
    month: resolved,
    startUtc: toManilaStartUtc(first),
    endExclusiveUtc: toManilaStartUtc(next),
  };
}
