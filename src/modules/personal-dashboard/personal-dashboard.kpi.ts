import {
  KpiSourceType,
  KpiStatus,
  KpiThresholdDTO,
  KpiValueOperator,
} from "./personal-dashboard.dto";

export const REQUIRED_THRESHOLD_STATUSES: Array<Exclude<KpiStatus, "UNCLASSIFIED">> = [
  "CRITICAL",
  "ONFLOW",
  "HEALTHY",
];

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

export function validateProgressThresholds(thresholds: KpiThresholdDTO[]) {
  if (!Array.isArray(thresholds) || thresholds.length !== 3) {
    throw new Error("Critical, Onflow, and Healthy threshold rules are required");
  }

  const seen = new Set(thresholds.map((rule) => rule.status));

  for (const status of REQUIRED_THRESHOLD_STATUSES) {
    if (!seen.has(status)) {
      throw new Error(`${status} threshold rule is required`);
    }
  }

  for (const rule of thresholds) {
    validateOperator(rule.operator);

    if (typeof rule.value1 !== "number" || Number.isNaN(rule.value1)) {
      throw new Error(`${rule.status} value1 is required`);
    }

    validateProgressValue(rule.value1, `${rule.status} value1`);

    if (rule.operator === "BETWEEN") {
      if (typeof rule.value2 !== "number" || Number.isNaN(rule.value2)) {
        throw new Error(`${rule.status} value2 is required when operator is BETWEEN`);
      }

      validateProgressValue(rule.value2, `${rule.status} value2`);

      if (rule.value2 < rule.value1) {
        throw new Error(`${rule.status} value2 must be greater than or equal to value1`);
      }
    }
  }
}

export function evaluateProgressStatus(
  progress: number,
  thresholds: KpiThresholdDTO[]
): KpiStatus {
  const orderedStatuses: KpiStatus[] = ["CRITICAL", "ONFLOW", "HEALTHY"];

  for (const status of orderedStatuses) {
    const rule = thresholds.find((item) => item.status === status);
    if (rule && matchesOperator(progress, rule.operator, rule.value1, rule.value2)) {
      return status;
    }
  }

  return "UNCLASSIFIED";
}

export function buildProgressPreview(
  sourceType: KpiSourceType,
  progress: number,
  expectedStartDate: Date | null = null,
  expectedEndDate: Date | null = null
) {
  return {
    sourceType,
    field: "PROGRESS",
    unit: "%",
    currentProgress: Number(progress.toFixed(2)),
    currentValue: Number(progress.toFixed(2)),
    expectedStartDate: expectedStartDate ?? null,
    expectedEndDate: expectedEndDate ?? null,
  };
}

function matchesOperator(
  value: number,
  operator: KpiValueOperator,
  value1: number,
  value2?: number
) {
  switch (operator) {
    case "LT":
      return value < value1;
    case "LTE":
      return value <= value1;
    case "EQ":
      return value === value1;
    case "GTE":
      return value >= value1;
    case "GT":
      return value > value1;
    case "BETWEEN":
      return typeof value2 === "number" && value >= value1 && value <= value2;
    default:
      return false;
  }
}

function validateOperator(operator: KpiValueOperator) {
  const validOperators: KpiValueOperator[] = ["LT", "LTE", "EQ", "GTE", "GT", "BETWEEN"];

  if (!validOperators.includes(operator)) {
    throw new Error("Invalid threshold operator");
  }
}

function validateProgressValue(value: number, label: string) {
  if (value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100`);
  }
}
