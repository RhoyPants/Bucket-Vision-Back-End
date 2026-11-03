import { Prisma } from "@prisma/client";
import { validProgress } from "../../utils/schedule-health";

export interface StoredProgressLog {
  date: Date;
  cumulativePercent: unknown;
  dailyPercent?: unknown;
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Convert only supported database/JSON numeric representations. Number(null),
// Number("") and Number(false) would incorrectly turn missing data into zero.
export function progressNumber(value: unknown): number | null {
  if (Prisma.Decimal.isDecimal(value)) return validProgress(value.toNumber());
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    return validProgress(Number(value));
  }
  return validProgress(value);
}

export function orderedProgressLogs<T extends StoredProgressLog>(logs: ReadonlyArray<T>) {
  // Match recomputeSubtaskProgressInTx. Editing an entry must not move it after
  // another contributor's entry on the same effective date.
  return logs.map((log) => ({
    ...log,
    dailyPercent: progressNumber(log.dailyPercent),
    cumulativePercent: progressNumber(log.cumulativePercent),
  })).sort((a, b) => a.date.getTime() - b.date.getTime() ||
    (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
    (a.id ?? "").localeCompare(b.id ?? ""));
}
