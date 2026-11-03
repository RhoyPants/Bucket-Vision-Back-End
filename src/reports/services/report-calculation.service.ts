import { evaluateScheduleHealth, expectedProgressAt, recordedProgressAt, recordedStartAt, WorkSchedule } from "../../utils/schedule-health";
import { orderedProgressLogs, StoredProgressLog } from "./report-progress";
export type { WorkSchedule } from "../../utils/schedule-health";

export interface CalculableSubtask {
  isBudgeted?: boolean;
  id: string;
  budgetPercent: number | null;
  budgetAllocated: number | null;
  projectedStartDate: Date | null;
  projectedEndDate: Date | null;
  actualStartDate?: Date | null;
  forecastEndDate?: Date | null;
  progressLogs: StoredProgressLog[];
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

  actualAt(subtask: CalculableSubtask, cutoff: Date): number | null {
    return recordedProgressAt(orderedProgressLogs(subtask.progressLogs), cutoff);
  }

  actualStartAt(subtask: CalculableSubtask, cutoff: Date): Date | null {
    return recordedStartAt(orderedProgressLogs(subtask.progressLogs), subtask.actualStartDate, cutoff);
  }

  expectedAt(
    subtask: CalculableSubtask,
    cutoff: Date,
    schedule: WorkSchedule
  ): number | null {
    return expectedProgressAt(cutoff, subtask.projectedStartDate, subtask.projectedEndDate, schedule);
  }

  aggregate(
    subtasks: CalculableSubtask[],
    value: (subtask: CalculableSubtask) => number | null,
    options: { strict?: boolean; round?: boolean } = {}
  ): number | null {
    const candidates = subtasks.map((subtask) => ({ subtask, value: value(subtask) }));
    if (options.strict && candidates.some((item) => item.value === null || !Number.isFinite(item.value))) {
      return null;
    }
    const values = candidates
      .map(({ subtask, value }) => ({ subtask, value: value ?? (subtask.isBudgeted === false ? 0 : null) }))
      .filter((item): item is { subtask: CalculableSubtask; value: number } =>
        item.value !== null && Number.isFinite(item.value)
      );
    if (!values.length) return null;

    const weights = values.map(({ subtask }) => this.weight(subtask));
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    const actualWeights = weightTotal > 0 ? weights : weights.map(() => 1);
    const denominator = actualWeights.reduce((sum, weight) => sum + weight, 0);

    const result = values.reduce((sum, item, index) => sum + item.value * actualWeights[index], 0) / denominator;
    return options.round === false ? result : this.round(result);
  }

  health(
    subtask: CalculableSubtask,
    cutoff: Date,
    schedule: WorkSchedule
  ) {
    return evaluateScheduleHealth({
      actualProgress: this.actualAt(subtask, cutoff),
      startDate: subtask.projectedStartDate,
      endDate: subtask.projectedEndDate,
      actualStartDate: this.actualStartAt(subtask, cutoff),
      forecastEndDate: subtask.forecastEndDate,
      asOf: cutoff,
      schedule,
    });
  }

  private weight(subtask: CalculableSubtask): number {
    if (subtask.isBudgeted === false) return 1;
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

}

export const reportCalculationService = new ReportCalculationService();
