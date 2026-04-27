import prisma from "../../config/prisma";

export interface TimelineSnapshot {
  date: Date;
  planned: number;
  actual: number;
  variance: number;
  daysAhead: number;
}

/**
 * Calculate PLANNED progress based on project schedule
 * Assumes linear progression from start to end date
 */
export async function calculatePlannedProgress(
  projectId: string,
  targetDate: Date
): Promise<number> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project || !project.startDate || !project.expectedEndDate) {
    return 0;
  }

  const start = project.startDate;
  const end = project.expectedEndDate;
  const now = new Date(targetDate);

  // If before start, planned = 0%
  if (now < start) return 0;

  // If after end, planned = 100%
  if (now > end) return 100;

  // Linear calculation
  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = now.getTime() - start.getTime();
  const planned = (elapsedMs / totalMs) * 100;

  return Math.min(100, Math.max(0, planned));
}

/**
 * Calculate ACTUAL progress based on subtask progress logs
 */
export async function calculateActualProgress(
  projectId: string,
  targetDate: Date
): Promise<number> {
  const subtasks = await prisma.subtask.findMany({
    where: {
      task: {
        category: {
          projectId,
        },
      },
    },
    include: {
      progressLogs: {
        where: {
          date: { lte: targetDate },
        },
        orderBy: { date: "desc" },
        take: 1, // Get latest log up to targetDate
      },
      task: {
        include: {
          category: true,
        },
      },
    },
  });

  if (subtasks.length === 0) return 0;

  let totalProgress = 0;
  let weightedSum = 0;
  let totalWeight = 0;

  for (const subtask of subtasks) {
    const weight = subtask.budgetPercent || 1;
    let progress = 0;

    if (subtask.progressLogs.length > 0) {
      progress = subtask.progressLogs[0].cumulativePercent || 0;
    } else if (subtask.actualEndDate && subtask.actualEndDate <= targetDate) {
      // If task is completed, assume 100%
      progress = 100;
    }

    weightedSum += progress * weight;
    totalWeight += weight;
  }

  const actual = totalWeight > 0 ? (weightedSum / totalWeight) : 0;
  return Math.min(100, Math.max(0, actual));
}

/**
 * Calculate variance and days ahead/behind
 */
export async function calculateVariance(
  projectId: string,
  targetDate: Date
): Promise<{ variance: number; daysAhead: number }> {
  const planned = await calculatePlannedProgress(projectId, targetDate);
  const actual = await calculateActualProgress(projectId, targetDate);

  const variance = actual - planned;

  // Calculate days ahead/behind based on progress delta
  // Assumes 1% progress = 1 day of buffer (scalable)
  const daysAhead = variance;

  return { variance, daysAhead };
}

/**
 * Generate timeline snapshot for a specific date
 */
export async function generateTimelineSnapshot(
  projectId: string,
  date: Date
): Promise<TimelineSnapshot> {
  const planned = await calculatePlannedProgress(projectId, date);
  const actual = await calculateActualProgress(projectId, date);
  const { variance, daysAhead } = await calculateVariance(projectId, date);

  return {
    date,
    planned: Number(planned.toFixed(2)),
    actual: Number(actual.toFixed(2)),
    variance: Number(variance.toFixed(2)),
    daysAhead: Number(daysAhead.toFixed(2)),
  };
}

/**
 * Generate and store timeline snapshots for entire project duration
 * Call this daily/weekly to track progress over time
 */
export async function generateProjectTimeline(
  projectId: string,
  interval: "daily" | "weekly" = "daily"
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project || !project.startDate || !project.expectedEndDate) {
    throw new Error("Project must have start and end dates");
  }

  const start = new Date(project.startDate);
  const end = new Date(project.expectedEndDate);

  // Generate dates based on interval
  const dates: Date[] = [];
  const current = new Date(start);

  while (current <= end) {
    dates.push(new Date(current));

    if (interval === "daily") {
      current.setDate(current.getDate() + 1);
    } else if (interval === "weekly") {
      current.setDate(current.getDate() + 7);
    }
  }

  // Always include today's date
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today > end && !dates.find(d => d.getTime() === today.getTime())) {
    dates.push(today);
  }

  // Generate and store snapshots
  for (const date of dates) {
    const snapshot = await generateTimelineSnapshot(projectId, date);

    // Upsert (update if exists, create if not)
    await prisma.projectTimeline.upsert({
      where: {
        id: `${projectId}-${date.toISOString().split('T')[0]}`, // Simple ID
      },
      create: {
        projectId,
        date,
        planned: snapshot.planned,
        actual: snapshot.actual,
        variance: snapshot.variance,
        daysAhead: snapshot.daysAhead,
      },
      update: {
        actual: snapshot.actual,
        variance: snapshot.variance,
        daysAhead: snapshot.daysAhead,
      },
    }).catch(() => {
      // If upsert fails due to unique constraint, use standard create/update
      return prisma.projectTimeline.create({
        data: {
          projectId,
          date,
          planned: snapshot.planned,
          actual: snapshot.actual,
          variance: snapshot.variance,
          daysAhead: snapshot.daysAhead,
        },
      });
    });
  }
}

/**
 * Get timeline for a project (for charting)
 */
export async function getProjectTimeline(
  projectId: string,
  options?: {
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
  }
): Promise<TimelineSnapshot[]> {
  const query: any = { projectId };

  if (options?.dateFrom || options?.dateTo) {
    query.date = {};
    if (options.dateFrom) query.date.gte = options.dateFrom;
    if (options.dateTo) query.date.lte = options.dateTo;
  }

  const timelines = await prisma.projectTimeline.findMany({
    where: query,
    orderBy: { date: "asc" },
    take: options?.limit || 365, // Default 1 year
  });

  return timelines.map(t => ({
    date: t.date,
    planned: t.planned,
    actual: t.actual,
    variance: t.variance,
    daysAhead: t.daysAhead,
  }));
}

/**
 * Get latest timeline snapshot (current status)
 */
export async function getLatestTimelineSnapshot(
  projectId: string
): Promise<TimelineSnapshot | null> {
  const timeline = await prisma.projectTimeline.findFirst({
    where: { projectId },
    orderBy: { date: "desc" },
  });

  if (!timeline) return null;

  return {
    date: timeline.date,
    planned: timeline.planned,
    actual: timeline.actual,
    variance: timeline.variance,
    daysAhead: timeline.daysAhead,
  };
}

/**
 * Calculate forecast completion date based on current velocity
 */
export async function forecastCompletionDate(
  projectId: string
): Promise<Date | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) return null;

  const timelines = await getProjectTimeline(projectId, { limit: 30 });

  if (timelines.length < 2) return null;

  // Get last 2 snapshots to calculate velocity
  const latest = timelines[timelines.length - 1];
  const previous = timelines[timelines.length - 2];

  const actualProgressRate = latest.actual - previous.actual;
  const remainingProgress = 100 - latest.actual;

  if (actualProgressRate <= 0) {
    // No progress, can't forecast
    return project.expectedEndDate;
  }

  const daysToComplete = remainingProgress / actualProgressRate;
  const today = new Date();
  const forecastDate = new Date(today.getTime() + daysToComplete * 24 * 60 * 60 * 1000);

  return forecastDate;
}
