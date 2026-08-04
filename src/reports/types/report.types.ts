export type ProjectReportType = "DAILY" | "WEEKLY";
export type ReportHealth = "HEALTHY" | "AT_RISK" | "DELAYED" | "UNCLASSIFIED";

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
  actualProgress: number;
  variance: number | null;
  health: ReportHealth;
  periodProgress: number;
}

export interface ReportRequestQuery {
  type?: unknown;
  date?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  timezone?: unknown;
}
