export type KpiSourceType = "PROJECT" | "SCOPE" | "TASK" | "SUBTASK";
export type KpiField = "PROGRESS";
export type KpiStatus = "CRITICAL" | "ONFLOW" | "HEALTHY" | "UNCLASSIFIED";
export type KpiChartType = "DONUT" | "BAR";

export interface KpiTargetDTO {
  id?: string;
  scopeId?: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
  field?: KpiField;
  unit?: string;
  criticalBelow?: number;
  healthyAtOrAbove?: number;
  sortOrder?: number;
}

export interface CreateDashboardKpiDTO {
  name: string;
  description?: string;
  chartTypes?: KpiChartType[];
  targets: KpiTargetDTO[];
}

export interface UpdateDashboardKpiDTO {
  name?: string;
  description?: string | null;
  chartTypes?: KpiChartType[];
  targets?: KpiTargetDTO[];
  deletedTargetIds?: string[];
}

export interface SourcePreviewQueryDTO {
  projectId?: string;
  scopeId?: string;
  taskId?: string;
  subtaskId?: string;
  field?: KpiField;
  criticalBelow?: number;
  healthyAtOrAbove?: number;
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
