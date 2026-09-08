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

async function resolveProjectBUHead(tx: Tx, progressLogId: string) {
  const log = await tx.progressLog.findUnique({
    where: { id: progressLogId },
    select: {
      subtask: {
        select: {
          task: {
            select: {
              scope: {
                select: {
                  project: { select: { id: true, name: true, businessUnit: true, owner: { select: { businessUnitId: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!log) throw new ProgressRuleError("Progress log not found", 404, "PROGRESS_NOT_FOUND");

  const project = log.subtask.task.scope.project;
  const projectBusinessUnit = String(project.businessUnit || "").trim();
  const ownerBusinessUnitId = project.owner.businessUnitId;
  if (!projectBusinessUnit && !ownerBusinessUnitId) {
    throw new ProgressRuleError(
      "The project Business Unit does not have an assigned BU Head.",
      422,
      "BU_HEAD_NOT_ASSIGNED",
    );
  }

  const businessUnit = await tx.businessUnit.findFirst({
    where: {
      isActive: true,
      OR: [
        ...(projectBusinessUnit
          ? [
              { id: projectBusinessUnit },
              { code: { equals: projectBusinessUnit, mode: "insensitive" as const } },
              { name: { equals: projectBusinessUnit, mode: "insensitive" as const } },
            ]
          : []),
        ...(!projectBusinessUnit && ownerBusinessUnitId ? [{ id: ownerBusinessUnitId }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      buHeadUser: { select: { id: true, name: true, email: true, isActive: true } },
    },
  });
  if (!businessUnit?.buHeadUser?.isActive) {
    throw new ProgressRuleError(
      "The project Business Unit does not have an assigned BU Head.",
      422,
      "BU_HEAD_NOT_ASSIGNED",
    );
  }
  return {
    businessUnit: { id: businessUnit.id, name: businessUnit.name },
    assignedApprover: {
      id: businessUnit.buHeadUser.id,
      name: businessUnit.buHeadUser.name,
      email: businessUnit.buHeadUser.email,
    },
    project: { id: project.id, name: project.name },
  };
}

export async function changeProgressValue(params: {
  progressLogId: string;
  requestedById: string;
  requestedPercent: number;
  remarks?: string | null;
  immediateData?: Record<string, unknown>;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.progressLog.findUnique({
      where: { id: params.progressLogId },
      select: { id: true, subtaskId: true, userId: true, dailyPercent: true },
    });
    if (!existing) throw new ProgressRuleError("Progress log not found", 404, "PROGRESS_NOT_FOUND");
    if (existing.userId !== params.requestedById) {
      throw new ProgressRuleError("You can only update your own progress entry.", 403, "PROGRESS_NOT_OWNED");
    }

    await lockSubtask(tx, existing.subtaskId);
    const pending = await tx.progressUpdateRequest.findFirst({
      where: { progressLogId: existing.id, status: "PENDING" },
      select: { id: true },
    });
    if (pending) {
      throw new ProgressRuleError(
        "This progress entry already has a pending decrease request. Cancel it or wait for BU Head review.",
        409,
        "PROGRESS_UPDATE_PENDING",
        { requestId: pending.id },
      );
    }

    const current = roundProgress(existing.dailyPercent);
    const requested = roundProgress(params.requestedPercent);
    const difference = roundProgress(requested - current);
    const remarks = String(params.remarks || "").trim();

    if (requested < current) {
      if (!remarks) {
        throw new ProgressRuleError("Remarks are required when requesting a progress decrease.", 400, "REMARKS_REQUIRED");
      }
      const assignment = await resolveProjectBUHead(tx, existing.id);
      const request = await tx.progressUpdateRequest.create({
        data: {
          progressLogId: existing.id,
          requestedById: params.requestedById,
          assignedApproverId: assignment.assignedApprover.id,
          businessUnitId: assignment.businessUnit.id,
          currentPercent: decimal(current),
          requestedPercent: decimal(requested),
          difference: decimal(difference),
          remarks,
          status: "PENDING",
        },
      });
      return {
        requiresApproval: true as const,
        request: {
          ...request,
          assignedApprover: assignment.assignedApprover,
          businessUnit: assignment.businessUnit,
          project: assignment.project,
        },
        log: null,
      };
    }

    const log = await tx.progressLog.update({
      where: { id: existing.id },
      data: { ...(params.immediateData || {}), dailyPercent: decimal(requested) } as any,
    });
    await recomputeSubtaskProgressInTx(tx, existing.subtaskId);
    const audit = await tx.progressUpdateRequest.create({
      data: {
        progressLogId: existing.id,
        requestedById: params.requestedById,
        currentPercent: decimal(current),
        requestedPercent: decimal(requested),
        difference: decimal(difference),
        remarks: remarks || "Progress updated",
        status: "APPLIED",
        appliedAt: new Date(),
      },
    });
    return { requiresApproval: false as const, request: audit, log };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewProgressUpdateRequest(params: {
  requestId: string; reviewerId: string; decision: "APPROVED" | "REJECTED"; reviewRemarks?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.progressUpdateRequest.findUnique({
      where: { id: params.requestId },
      include: { progressLog: { select: { id: true, subtaskId: true, dailyPercent: true } } },
    });
    if (!request) throw new ProgressRuleError("Progress update request not found", 404, "UPDATE_REQUEST_NOT_FOUND");
    if (request.status !== "PENDING") throw new ProgressRuleError("This request is no longer pending.", 409, "UPDATE_REQUEST_RESOLVED");
    if (!request.assignedApproverId || request.assignedApproverId !== params.reviewerId) {
      throw new ProgressRuleError("Only the assigned project BU Head can review this request.", 403, "NOT_ASSIGNED_BU_HEAD");
    }
    const reviewRemarks = String(params.reviewRemarks || "").trim();
    if (params.decision === "REJECTED" && !reviewRemarks) {
      throw new ProgressRuleError("A rejection reason is required.", 400, "REVIEW_REMARKS_REQUIRED");
    }

    await lockSubtask(tx, request.progressLog.subtaskId);
    if (params.decision === "APPROVED") {
      if (toProgressUnits(request.progressLog.dailyPercent) !== toProgressUnits(request.currentPercent)) {
        throw new ProgressRuleError(
          "Progress changed after this request was submitted. Cancel it and submit a new correction.",
          409,
          "PROGRESS_VALUE_CHANGED",
        );
      }
      await tx.progressLog.update({
        where: { id: request.progressLogId },
        data: { dailyPercent: request.requestedPercent },
      });
      await recomputeSubtaskProgressInTx(tx, request.progressLog.subtaskId);
    }

    return tx.progressUpdateRequest.update({
      where: { id: request.id },
      data: {
        status: params.decision,
        reviewedById: params.reviewerId,
        reviewRemarks: reviewRemarks || null,
        reviewedAt: new Date(),
        appliedAt: params.decision === "APPROVED" ? new Date() : null,
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        assignedApprover: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function cancelProgressUpdateRequest(requestId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.progressUpdateRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new ProgressRuleError("Progress update request not found", 404, "UPDATE_REQUEST_NOT_FOUND");
    if (request.requestedById !== userId) throw new ProgressRuleError("Only the requester can cancel this request.", 403, "NOT_UPDATE_REQUEST_OWNER");
    if (request.status !== "PENDING") throw new ProgressRuleError("Only a pending request can be cancelled.", 409, "UPDATE_REQUEST_RESOLVED");
    return tx.progressUpdateRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  });
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
