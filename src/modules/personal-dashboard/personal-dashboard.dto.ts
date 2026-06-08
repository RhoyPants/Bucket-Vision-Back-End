export type KpiSourceType = "PROJECT" | "SCOPE" | "TASK" | "SUBTASK";
export type KpiField = "PROGRESS";
export type KpiStatus = "CRITICAL" | "ONFLOW" | "HEALTHY" | "UNCLASSIFIED";
export type KpiValueOperator = "LT" | "LTE" | "EQ" | "GTE" | "GT" | "BETWEEN";
export type DashboardChartType =
  | "KPI_SUMMARY"
  | "SCURVE"
  | "PROGRESS_TREND"
  | "KPI_STATUS_DISTRIBUTION"
  | "TASK_COMPLETION";

export interface CreatePersonalDashboardDTO {
  name: string;
  description?: string;
  projectId: string;
}

export interface UpdatePersonalDashboardDTO {
  name?: string;
  description?: string | null;
}

export interface KpiThresholdDTO {
  status: Exclude<KpiStatus, "UNCLASSIFIED">;
  operator: KpiValueOperator;
  value1: number;
  value2?: number;
  dateOperator?: KpiValueOperator | null;
  dateValue1?: Date | null;
  dateValue2?: Date | null;
}

export interface CreateDashboardKpiDTO {
  name: string;
  description?: string;
  projectId?: string;
  scopeId?: string;
  taskId?: string;
  subtaskId?: string;
  field?: KpiField;
  thresholds: KpiThresholdDTO[];
}

export interface UpdateDashboardKpiDTO {
  name?: string;
  description?: string | null;
  scopeId?: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
  thresholds?: KpiThresholdDTO[];
}

export interface SourcePreviewQueryDTO {
  projectId?: string;
  scopeId?: string;
  taskId?: string;
  subtaskId?: string;
}

export interface ChartConfigDTO {
  chartType: DashboardChartType;
  isEnabled?: boolean;
  sortOrder?: number;
}

export interface DashboardNoteItemDTO {
  text: string;
  isDone?: boolean;
  sortOrder?: number;
}

export interface CreateDashboardNoteDTO {
  title?: string;
  content?: string;
  sortOrder?: number;
  items?: DashboardNoteItemDTO[];
}

export interface UpdateDashboardNoteDTO {
  title?: string | null;
  content?: string | null;
  sortOrder?: number;
}

export interface UpdateDashboardNoteItemDTO {
  text?: string;
  isDone?: boolean;
  sortOrder?: number;
}
