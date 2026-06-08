import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * 🔥 MAIN ENTRY POINT
 * Call this AFTER creating/updating a ProgressLog
 */
export async function recomputeSubtaskProgress(subtaskId: string) {
  // 1. Get all logs sorted by date
  const logs = await prisma.progressLog.findMany({
    where: { subtaskId },
    orderBy: { date: "asc" },
  });

  let cumulative = 0;

  // 2. Recompute cumulative safely
  for (const log of logs) {
    cumulative += log.dailyPercent;

    if (cumulative > 100) cumulative = 100;
    if (cumulative < 0) cumulative = 0;

    await prisma.progressLog.update({
      where: { id: log.id },
      data: { cumulativePercent: cumulative },
    });
  }

  const latestProgress = cumulative;

  // 3. Detect actual dates
  const actualStart =
    logs.find((l) => l.dailyPercent > 0)?.date || null;

  const actualEnd =
    logs.find((l) => l.cumulativePercent >= 100)?.date || null;

  // ========================================
  // 🔥 STATUS COMPUTATION (NEW)
  // ========================================
  let status = 0; // PENDING

  if (latestProgress > 0 && latestProgress < 100) {
    status = 1; // ONGOING
  }

  if (latestProgress >= 100) {
    status = 2; // DONE
  }

  // 4. Update Subtask
  const subtask = await prisma.subtask.update({
    where: { id: subtaskId },
    data: {
      progress: latestProgress,
      actualStartDate: actualStart,
      actualEndDate: actualEnd,
      status, // 🔥 AUTO STATUS
    },
    include: {
      task: true,
    },
  });

  // 5. Cascade updates
  await recomputeTaskProgress(subtask.taskId);
}

/**
 * 🔥 TASK LEVEL COMPUTATION
 */
async function recomputeTaskProgress(taskId: string) {
  const subtasks = await prisma.subtask.findMany({
    where: { taskId },
  });

  if (!subtasks.length) {
    await prisma.task.update({
      where: { id: taskId },
      data: { progress: 0 },
    });
    return;
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (const st of subtasks) {
    const weight = st.budgetPercent ?? 1;

    totalWeight += weight;
    weightedSum += st.progress * weight;
  }

  const progress =
    totalWeight > 0 ? weightedSum / totalWeight : 0;

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { progress },
    include: { scope: true },
  });

  await recomputescopeProgress(task.scopeId);
}

/**
 * 🔥 scope LEVEL COMPUTATION
 */
async function recomputescopeProgress(scopeId: string) {
  const tasks = await prisma.task.findMany({
    where: { scopeId },
  });

  if (!tasks.length) {
    await prisma.scope.update({
      where: { id: scopeId },
      data: { progress: 0 },
    });
    return;
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (const t of tasks) {
    const weight = t.budgetPercent ?? 1;

    totalWeight += weight;
    weightedSum += t.progress * weight;
  }

  const progress =
    totalWeight > 0 ? weightedSum / totalWeight : 0;

  const scope = await prisma.scope.update({
    where: { id: scopeId },
    data: { progress },
  });

  await recomputeProjectProgress(scope.projectId);
}

/**
 * 🔥 PROJECT LEVEL COMPUTATION
 */
async function recomputeProjectProgress(projectId: string) {
  const categories = await prisma.scope.findMany({
    where: { projectId },
  });

  if (!categories.length) {
    await prisma.project.update({
      where: { id: projectId },
      data: { progress: 0 },
    });
    return;
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (const c of categories) {
    const weight = c.budgetPercent ?? 1;

    totalWeight += weight;
    weightedSum += c.progress * weight;
  }

  const progress =
    totalWeight > 0 ? weightedSum / totalWeight : 0;

  await prisma.project.update({
    where: { id: projectId },
    data: { progress },
  });
}

/**
 * 🔥 OPTIONAL HELPER
 * Use this instead of raw create (recommended)
 */
export async function addProgressLog(data: {
  subtaskId: string;
  date: Date;
  dailyPercent: number;
  remarks?: string;
  photoUrl?: string;
  attachmentUrl?: string;
  latitude?: number | null;
  longitude?: number | null;
  userId?: string;
}) {
  // 1. Validate
  if (data.dailyPercent < 0 || data.dailyPercent > 100) {
    throw new Error("Daily percent must be between 0 and 100");
  }

  // 2. Create / Update log
  const log = await prisma.progressLog.upsert({
    where: {
      subtaskId_date: {
        subtaskId: data.subtaskId,
        date: data.date,
      },
    },
    update: {
      dailyPercent: data.dailyPercent,
      remarks: data.remarks,
      photoUrl: data.photoUrl,
      attachmentUrl: data.attachmentUrl,
      latitude: data.latitude,
      longitude: data.longitude,
      userId: data.userId,
    },
    create: {
      subtaskId: data.subtaskId,
      date: data.date,
      dailyPercent: data.dailyPercent,
      cumulativePercent: 0,
      remarks: data.remarks,
      photoUrl: data.photoUrl,
      attachmentUrl: data.attachmentUrl,
      latitude: data.latitude,
      longitude: data.longitude,
      userId: data.userId,
    },
  });

  // 3. Recompute everything
  await recomputeSubtaskProgress(data.subtaskId);

  return await prisma.progressLog.findUnique({
    where: { id: log.id },
  });
}
