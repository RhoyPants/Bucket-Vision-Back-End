import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function getSCurve(projectId: string) {
  // ========================================
  // 1. PROJECT
  // ========================================
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project || !project.startDate || !project.expectedEndDate) {
    throw new Error("Project dates are required");
  }

  const start = new Date(project.startDate);
  const end = new Date(project.expectedEndDate);

  const totalDays =
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // ========================================
  // 2. DATE RANGE
  // ========================================
  const dates: Date[] = [];

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d);
  }

  // ========================================
  // 🔥 3. GET ALL SUBTASKS WITH LOGS
  // ========================================
  const subtasks = await prisma.subtask.findMany({
    where: {
      task: {
        category: {
          projectId,
        },
      },
    },
    include: {
      task: {
        include: {
          category: true,
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
          sub.task?.category?.budgetPercent ||
          1) / 100;

      plannedWeightSum += weight;

      // BEFORE START
      if (date < subStart) continue;

      // AFTER END
      if (date > subEnd) {
        plannedTotal += 1 * weight;
        continue;
      }

      // DURING
      const total =
        (subEnd.getTime() - subStart.getTime()) /
        (1000 * 60 * 60 * 24);

      const elapsed =
        (date.getTime() - subStart.getTime()) /
        (1000 * 60 * 60 * 24);

      const progress = total > 0 ? elapsed / total : 0;

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
          sub.task?.category?.budgetPercent ||
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