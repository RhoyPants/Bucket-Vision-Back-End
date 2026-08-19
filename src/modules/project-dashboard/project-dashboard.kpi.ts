import { KpiSourceType, KpiStatus } from "./project-dashboard.dto";

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

export function expectedProgressAt(
  now: Date,
  startDate: Date | null,
  endDate: Date | null
): number | null {
  if (!startDate || !endDate) return null;
  const start = startDate.getTime();
  const end = endDate.getTime();
  const current = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (current < start) return 0;
  if (current >= end) return 100;
  return round(((current - start) / (end - start)) * 100);
}

export function evaluateVarianceStatus(
  actualProgress: number | null,
  expectedProgress: number | null,
  criticalBelow: number,
  healthyAtOrAbove: number
): { variance: number | null; status: KpiStatus } {
  if (actualProgress === null || expectedProgress === null) {
    return { variance: null, status: "UNCLASSIFIED" };
  }
  const variance = round(actualProgress - expectedProgress);
  if (variance < criticalBelow) return { variance, status: "CRITICAL" };
  if (variance >= healthyAtOrAbove) return { variance, status: "HEALTHY" };
  return { variance, status: "ONFLOW" };
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
