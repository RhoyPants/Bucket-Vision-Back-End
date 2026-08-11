import { Prisma, PrismaClient } from "@prisma/client";
import { fromProgressUnits, roundProgress, toProgressUnits } from "./progress-precision";

const prisma = new PrismaClient();
type Tx = Prisma.TransactionClient;

export class ProgressRuleError extends Error {
  constructor(
    message: string,
    public readonly httpStatus = 400,
    public readonly code?: string,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProgressRuleError";
  }
}

function decimal(value: number): number {
  // Prisma sends this to DECIMAL(5,2); arithmetic itself is performed in integer hundredths.
  return Number(value.toFixed(2));
}

async function lockSubtask(tx: Tx, subtaskId: string) {
  // Serializes mutations for one subtask, including requests for different logs.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subtaskId}))`;
}

async function recomputeProjectHierarchy(tx: Tx, taskId: string) {
  const subtasks = await tx.subtask.findMany({ where: { taskId }, select: { progress: true, budgetPercent: true } });
  const taskUnits = weightedProgressUnits(subtasks);
  const task = await tx.task.update({ where: { id: taskId }, data: { progress: decimal(fromProgressUnits(taskUnits)) }, select: { scopeId: true } });

  const tasks = await tx.task.findMany({ where: { scopeId: task.scopeId }, select: { progress: true, budgetPercent: true } });
  const scopeUnits = weightedProgressUnits(tasks);
  const scope = await tx.scope.update({ where: { id: task.scopeId }, data: { progress: decimal(fromProgressUnits(scopeUnits)) }, select: { projectId: true } });

  const scopes = await tx.scope.findMany({ where: { projectId: scope.projectId }, select: { progress: true, budgetPercent: true } });
  const projectUnits = weightedProgressUnits(scopes);
  await tx.project.update({ where: { id: scope.projectId }, data: { progress: decimal(fromProgressUnits(projectUnits)) } });
}

function weightedProgressUnits(rows: Array<{ progress: unknown; budgetPercent: number | null }>): number {
  if (!rows.length) return 0;
  let totalWeight = 0;
  let weightedUnits = 0;
  for (const row of rows) {
    const weight = row.budgetPercent ?? 1;
    totalWeight += weight;
    weightedUnits += toProgressUnits(row.progress as any) * weight;
  }
  return totalWeight > 0 ? Math.round(weightedUnits / totalWeight) : 0;
}

async function recomputeSubtaskProgressInTx(tx: Tx, subtaskId: string) {
  const logs = await tx.progressLog.findMany({
    where: { subtaskId },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  let cumulativeUnits = 0;
  const cumulativeById = new Map<string, number>();
  for (const log of logs) {
    cumulativeUnits += toProgressUnits(log.dailyPercent);
    if (cumulativeUnits > 10000) {
      throw new ProgressRuleError("Cumulative progress cannot exceed 100.00%.", 400, "PROGRESS_EXCEEDS_100");
    }
    cumulativeById.set(log.id, cumulativeUnits);
  }

  if (cumulativeUnits === 10000) {
    const incompleteCount = await tx.checklist.count({ where: { subtaskId, isCompleted: false } });
    if (incompleteCount > 0) {
      throw new ProgressRuleError(
        "Complete all checklist items before setting this subtask to 100%.",
        409,
        "CHECKLIST_INCOMPLETE",
        { incompleteCount },
      );
    }
  }

  for (const log of logs) {
    await tx.progressLog.update({
      where: { id: log.id },
      data: { cumulativePercent: decimal(fromProgressUnits(cumulativeById.get(log.id)!)) },
    });
  }

  const actualStart = logs[0]?.date ?? null;
  const actualEnd = cumulativeUnits === 10000 ? logs[logs.length - 1]?.date ?? null : null;
  const status = cumulativeUnits === 10000 ? 2 : cumulativeUnits > 0 ? 1 : 0;
  const subtask = await tx.subtask.update({
    where: { id: subtaskId },
    data: { progress: decimal(fromProgressUnits(cumulativeUnits)), actualStartDate: actualStart, actualEndDate: actualEnd, status },
    select: { taskId: true },
  });
  await recomputeProjectHierarchy(tx, subtask.taskId);
}

export async function recomputeSubtaskProgress(subtaskId: string) {
  return prisma.$transaction(async (tx) => {
    await lockSubtask(tx, subtaskId);
    await recomputeSubtaskProgressInTx(tx, subtaskId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function addProgressLog(data: {
  subtaskId: string; date: Date; dailyPercent: number; remarks?: string; photoUrl?: string;
  attachmentUrl?: string; latitude?: number | null; longitude?: number | null; userId?: string;
  attachments?: Array<{ url: string; name: string; mimeType?: string; size?: number; sortOrder?: number }>;
}) {
  if (!data.userId) throw new ProgressRuleError("User is required to add progress");
  const start = new Date(data.date); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);

  return prisma.$transaction(async (tx) => {
    await lockSubtask(tx, data.subtaskId);
    const duplicate = await tx.progressLog.findFirst({ where: { subtaskId: data.subtaskId, userId: data.userId, date: { gte: start, lt: end } }, select: { id: true } });
    if (duplicate) throw new ProgressRuleError("Progress can only be added once per assignee per day. Please update the existing progress entry.");

    const log = await tx.progressLog.create({ data: {
      subtaskId: data.subtaskId, date: start, dailyPercent: decimal(roundProgress(data.dailyPercent)), cumulativePercent: decimal(0),
      remarks: data.remarks, photoUrl: data.photoUrl, attachmentUrl: data.attachmentUrl,
      latitude: data.latitude, longitude: data.longitude, userId: data.userId,
      attachments: data.attachments?.length ? { create: data.attachments.map((a, i) => ({ ...a, sortOrder: a.sortOrder ?? i })) } : undefined,
    }});
    await recomputeSubtaskProgressInTx(tx, data.subtaskId);
    return tx.progressLog.findUnique({ where: { id: log.id }, include: { attachments: { orderBy: { sortOrder: "asc" } }, user: { select: { id: true, name: true, email: true } } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateProgressLog(id: string, data: Record<string, unknown>) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.progressLog.findUnique({ where: { id }, select: { subtaskId: true } });
    if (!existing) throw new ProgressRuleError("Progress log not found", 404, "PROGRESS_NOT_FOUND");
    await lockSubtask(tx, existing.subtaskId);
    const log = await tx.progressLog.update({ where: { id }, data: data as any });
    await recomputeSubtaskProgressInTx(tx, existing.subtaskId);
    return log;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteProgressLog(id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.progressLog.findUnique({ where: { id }, select: { subtaskId: true } });
    if (!existing) throw new ProgressRuleError("Progress log not found", 404, "PROGRESS_NOT_FOUND");
    await lockSubtask(tx, existing.subtaskId);
    await tx.progressLog.delete({ where: { id } });
    await recomputeSubtaskProgressInTx(tx, existing.subtaskId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
