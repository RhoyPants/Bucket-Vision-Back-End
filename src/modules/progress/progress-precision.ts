export const PROGRESS_SCALE = 100;

export class ProgressValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressValidationError";
  }
}

/** Parse an API value without silently discarding decimal places. */
export function parseDailyPercent(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    throw new ProgressValidationError("dailyPercent is required");
  }

  const raw = typeof value === "string" ? value.trim() : String(value);
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    throw new ProgressValidationError("dailyPercent must be a number");
  }
  if (numeric <= 0 || numeric > 100) {
    throw new ProgressValidationError("dailyPercent must be greater than 0 and at most 100");
  }
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(raw)) {
    throw new ProgressValidationError("dailyPercent must have at most 2 decimal places");
  }

  return fromProgressUnits(toProgressUnits(numeric));
}

export function toProgressUnits(value: number | string | { toString(): string }): number {
  return Math.round(Number(value.toString()) * PROGRESS_SCALE);
}

export function fromProgressUnits(units: number): number {
  return units / PROGRESS_SCALE;
}

export function roundProgress(value: number | string | { toString(): string }): number {
  return fromProgressUnits(toProgressUnits(value));
}

export function sumProgress(values: Array<number | string | { toString(): string }>): number {
  return fromProgressUnits(values.reduce<number>((sum, value) => sum + toProgressUnits(value), 0));
}

export type ProgressPlan = { cumulativeUnits: number[]; totalUnits: number; status: 0 | 1 | 2 };

export function calculateProgressPlan(
  values: Array<number | string | { toString(): string }>,
  incompleteChecklistCount: number,
): ProgressPlan {
  let totalUnits = 0;
  const cumulativeUnits = values.map((value) => {
    totalUnits += toProgressUnits(value);
    if (totalUnits > 10000) throw new ProgressValidationError("Cumulative progress cannot exceed 100.00%.");
    return totalUnits;
  });
  if (totalUnits === 10000 && incompleteChecklistCount > 0) {
    throw new ProgressValidationError("Complete all checklist items before setting this subtask to 100%.");
  }
  return { cumulativeUnits, totalUnits, status: totalUnits === 10000 ? 2 : totalUnits > 0 ? 1 : 0 };
}
