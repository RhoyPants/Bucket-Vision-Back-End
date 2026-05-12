import { PrismaClient } from "@prisma/client";
import { DurationCalculator } from "../../utils/duration-calculator";
import { HolidayService } from "../admin/holidays/holiday.service";

const prisma = new PrismaClient();

export async function getSCurve(projectId: string) {
  // ========================================
  // 1. PROJECT (with embedded schedule)
  // ========================================
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project || !project.startDate || !project.expectedEndDate) {
    throw new Error("Project dates are required");
  }

  const start = new Date(project.startDate);
  const end = new Date(project.expectedEndDate);

  // 🔥 FETCHED: Global holidays from database
  const holidays = await HolidayService.getHolidaysInRange(start, end);

  // 🔥 UPDATED: Use DurationCalculator for working days with project schedule + actual holidays
  const scheduleConfig = {
    monday: project.monday,
    tuesday: project.tuesday,
    wednesday: project.wednesday,
    thursday: project.thursday,
    friday: project.friday,
    saturday: project.saturday,
    sunday: project.sunday,
    includeHolidays: project.includeHolidays,
    holidays: holidays, // 🔥 ACTUAL GLOBAL HOLIDAYS FROM DATABASE
  };

  const totalWorkDays = DurationCalculator.calculateWorkDays(start, end, scheduleConfig);

  // ========================================
  // 2. DATE RANGE (working days only)
  // ========================================
  const dates: Date[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    // Only add working days
    const dayOfWeek = current.getDay();
    const workingDays = [
      project.sunday,    // 0
      project.monday,    // 1
      project.tuesday,   // 2
      project.wednesday, // 3
      project.thursday,  // 4
      project.friday,    // 5
      project.saturday   // 6
    ];

    if (workingDays[dayOfWeek]) {
      dates.push(new Date(current));
    }

    current.setDate(current.getDate() + 1);
  }

  // ========================================
  // 🔥 3. GET ALL SUBTASKS WITH LOGS
  // ========================================
  const subtasks = await prisma.subtask.findMany({
    where: {
      task: {
        scope: {
          projectId,
        },
      },
    },
    include: {
      task: {
        include: {
          scope: true,
        },
      },
      progressLogs: true, // 🔥 IMPORTANT
    },
  });

  // ========================================
  // 🔥 4. BUILD CURVE
  // ========================================
  const result = [];

  let lastActual = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const key = date.toISOString().split("T")[0];

    // ========================================
    // 🔵 PLANNED (NORMALIZED)
    // ========================================
    let plannedTotal = 0;
    let plannedWeightSum = 0;

    for (const sub of subtasks) {
      if (!sub.projectedStartDate || !sub.projectedEndDate) continue;

      const subStart = new Date(sub.projectedStartDate);
      const subEnd = new Date(sub.projectedEndDate);

      const weight =
        (sub.budgetPercent ||
          sub.task?.scope?.budgetPercent ||
          1) / 100;

      plannedWeightSum += weight;

      // BEFORE START
      if (date < subStart) continue;

      // AFTER END
      if (date > subEnd) {
        plannedTotal += 1 * weight;
        continue;
      }

      // DURING - Calculate using working days
      const totalWorkDays = DurationCalculator.calculateWorkDays(subStart, subEnd, scheduleConfig);
      const elapsedWorkDays = DurationCalculator.calculateWorkDays(subStart, date, scheduleConfig);

      const progress = totalWorkDays > 0 ? elapsedWorkDays / totalWorkDays : 0;

      plannedTotal += progress * weight;
    }

    const planned =
      plannedWeightSum > 0 ? (plannedTotal / plannedWeightSum) * 100 : 0;

    // ========================================
    // 🟢 ACTUAL (CORRECT LOGIC 🔥)
    // ========================================
    let totalWeight = 0;
    let weightedProgress = 0;

    for (const sub of subtasks) {
      const weight =
        (sub.budgetPercent ||
          sub.task?.scope?.budgetPercent ||
          1) / 100;

      totalWeight += weight;

      // 🔥 GET LATEST LOG UP TO THIS DATE
      const logs = sub.progressLogs
        .filter((l) => new Date(l.date) <= date)
        .sort(
          (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );

      const latestProgress = logs[0]?.cumulativePercent || 0;

      weightedProgress += latestProgress * weight;
    }

    const actual =
      totalWeight > 0 ? weightedProgress / totalWeight : 0;

    // 🔥 PREVENT BACKWARD
    lastActual = Math.max(lastActual, actual);

    result.push({
      date: key,
      planned: Number(planned.toFixed(2)),
      actual: Number(lastActual.toFixed(2)),
    });
  }

  // ========================================
  // 🔥 5. STATUS
  // ========================================
  const lastPlanned = result[result.length - 1]?.planned || 0;
  const lastActualVal = result[result.length - 1]?.actual || 0;

  let status = "ON_TRACK";

  if (lastActualVal + 5 < lastPlanned) {
    status = "DELAYED";
  } else if (lastActualVal > lastPlanned + 5) {
    status = "AHEAD";
  }

  return {
    data: result,
    status,
  };
}
