import { ReportHealth } from "../types/report.types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WorkSchedule {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  includeHolidays: boolean;
  holidayKeys: Set<string>;
}

export interface CalculableSubtask {
  id: string;
  budgetPercent: number | null;
  budgetAllocated: number | null;
  projectedStartDate: Date | null;
  projectedEndDate: Date | null;
  progressLogs: Array<{ date: Date; cumulativePercent: number }>;
  task: {
    budgetPercent: number | null;
    budgetAllocated: number | null;
    scope: {
      budgetPercent: number | null;
      budgetAllocated: number | null;
    };
  };
}

export class ReportCalculationService {
  round(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  actualAt(subtask: CalculableSubtask, cutoff: Date): number {
    let latest: { date: Date; cumulativePercent: number } | undefined;
    for (const log of subtask.progressLogs) {
      if (log.date <= cutoff && (!latest || log.date > latest.date)) latest = log;
    }
    return this.clamp(latest?.cumulativePercent ?? 0);
  }

  expectedAt(
    subtask: CalculableSubtask,
    cutoff: Date,
    schedule: WorkSchedule
  ): number | null {
    if (!subtask.projectedStartDate || !subtask.projectedEndDate) return null;
    const start = this.manilaCalendarDay(subtask.projectedStartDate);
    const end = this.manilaCalendarDay(subtask.projectedEndDate);
    const target = this.manilaCalendarDay(cutoff);

    if (target < start) return 0;
    if (target >= end) return 100;

    const total = this.countWorkingDays(start, end, schedule);
    if (total === 0) return null;
    const elapsed = this.countWorkingDays(start, target, schedule);
    return this.round(this.clamp((elapsed / total) * 100));
  }

  aggregate(
    subtasks: CalculableSubtask[],
    value: (subtask: CalculableSubtask) => number | null
  ): number | null {
    const values = subtasks
      .map((subtask) => ({ subtask, value: value(subtask) }))
      .filter((item): item is { subtask: CalculableSubtask; value: number } =>
        item.value !== null && Number.isFinite(item.value)
      );
    if (!values.length) return null;

    const weights = values.map(({ subtask }) => this.weight(subtask));
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    const actualWeights = weightTotal > 0 ? weights : weights.map(() => 1);
    const denominator = actualWeights.reduce((sum, weight) => sum + weight, 0);

    return this.round(
      values.reduce((sum, item, index) => sum + item.value * actualWeights[index], 0) /
        denominator
    );
  }

  health(
    actual: number,
    expected: number | null,
    config: { criticalBelow: number; healthyAtOrAbove: number }
  ): ReportHealth {
    if (expected === null) return "UNCLASSIFIED";
    if (actual >= 100) return "HEALTHY";
    const variance = actual - expected;
    if (variance < config.criticalBelow) return "DELAYED";
    if (variance >= config.healthyAtOrAbove) return "HEALTHY";
    return "AT_RISK";
  }

  private weight(subtask: CalculableSubtask): number {
    const candidates = [
      subtask.budgetPercent,
      subtask.budgetAllocated,
      subtask.task.budgetPercent,
      subtask.task.budgetAllocated,
      subtask.task.scope.budgetPercent,
      subtask.task.scope.budgetAllocated,
    ];
    const selected = candidates.find(
      (candidate): candidate is number =>
        typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
    );
    return selected ?? 1;
  }

  private countWorkingDays(start: Date, end: Date, schedule: WorkSchedule): number {
    let count = 0;
    for (let value = start.getTime(); value <= end.getTime(); value += DAY_MS) {
      const date = new Date(value);
      const enabled = [
        schedule.sunday,
        schedule.monday,
        schedule.tuesday,
        schedule.wednesday,
        schedule.thursday,
        schedule.friday,
        schedule.saturday,
      ][date.getUTCDay()];
      const key = date.toISOString().slice(0, 10);
      if (enabled && !(schedule.includeHolidays && schedule.holidayKeys.has(key))) count++;
    }
    return count;
  }

  private manilaCalendarDay(date: Date): Date {
    return new Date(Date.parse(
      `${new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)}T00:00:00.000Z`
    ));
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, value));
  }
}

export const reportCalculationService = new ReportCalculationService();
