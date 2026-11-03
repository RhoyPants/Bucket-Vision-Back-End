import { KpiSourceType } from "./project-dashboard.dto";

export { evaluateScheduleHealth, expectedProgressAt } from "../../utils/schedule-health";

export const DEFAULT_KPI_THRESHOLDS = { criticalBelow: -15, healthyAtOrAbove: -5 };

export function detectSourceType(input: {
  scopeId?: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
}): KpiSourceType {
  if (input.subtaskId) return "SUBTASK";
  if (input.taskId) return "TASK";
  if (input.scopeId) return "SCOPE";
  return "PROJECT";
}
