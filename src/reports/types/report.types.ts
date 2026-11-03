import { ScheduleHealthStatus } from "../../utils/schedule-health";

export type ProjectReportType = "DAILY" | "WEEKLY";
export type ReportHealth = ScheduleHealthStatus;

export interface ReportPeriod {
  type: ProjectReportType;
  timezone: "Asia/Manila";
  startDate: string;
  endDate: string;
  startUtc: Date;
  endExclusiveUtc: Date;
  cutoffUtc: Date;
  openingCutoffUtc: Date;
}

export interface ProgressMetrics {
  expectedProgress: number | null;
  actualProgress: number | null;
  variance: number | null;
  health: ReportHealth;
  statusReason: string;
  periodProgress: number | null;
}

export interface ReportRequestQuery {
  type?: unknown;
  date?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  timezone?: unknown;
}
