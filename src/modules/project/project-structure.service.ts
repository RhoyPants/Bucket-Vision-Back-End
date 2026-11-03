import { Prisma } from "@prisma/client";

export function projectConflict(message: string, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

export async function lockProjectForStructureUpdate(tx: Prisma.TransactionClient, projectId: string) {
  // Also serializes mode validation with submission/lifecycle UPDATEs. Use READ
  // COMMITTED so reads after a lock wait see the preceding transaction's commit.
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { id: true, status: true, isPhasing: true, isBudgeted: true },
  });
  if (!project) throw projectConflict("Project not found", 404);
  return project;
}

export async function prepareProjectStructureMode(
  tx: Prisma.TransactionClient,
  project: { id: string; status: string; isPhasing: boolean },
  requestedIsPhasing: boolean | undefined,
) {
  if (requestedIsPhasing === undefined || requestedIsPhasing === project.isPhasing) return;
  if (project.status !== "DRAFT") {
    throw projectConflict("Project structure mode can only be changed while the project is DRAFT.");
  }

  // PostgreSQL FK checks take KEY SHARE locks on parents when inserting or
  // reparenting children. FOR UPDATE conflicts with those locks. Lock each
  // level before reading the next: Project -> Scope -> Task. This prevents a
  // concurrent subtask insert (including through a newly created scope/task)
  // from committing between the count and mode update, without global locks or
  // requiring every writer to remember an application-level advisory lock.
  await tx.$queryRaw`SELECT s.id FROM "Scope" s
    WHERE s."projectId" = ${project.id} ORDER BY s.id FOR UPDATE OF s`;
  await tx.$queryRaw`SELECT t.id FROM "Task" t JOIN "Scope" s ON s.id = t."scopeId"
    WHERE s."projectId" = ${project.id} ORDER BY t.id FOR UPDATE OF t`;
  const subtaskCount = await tx.subtask.count({
    where: { task: { scope: { projectId: project.id } } },
  });
  if (subtaskCount > 0) {
    throw projectConflict("Project structure mode cannot be changed while subtasks exist anywhere in the project, including under phases.");
  }

  // Standard mode uses the project's flat scopes list. Retain phase links so
  // switching back restores the original grouping without copying structure.
  if (!requestedIsPhasing) return;
  const phases = await tx.phase.findMany({
    where: { projectId: project.id, deletedAt: null },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const ungrouped = await tx.scope.findMany({
    where: { projectId: project.id, OR: [{ phaseId: null }, { phaseId: { notIn: phases.map((p) => p.id) } }] },
    select: { id: true },
  });
  if (!ungrouped.length) return;
  const phase = phases[0] ?? await tx.phase.create({
    data: { projectId: project.id, name: "Existing structure", order: 0 },
    select: { id: true },
  });
  await tx.scope.updateMany({
    where: { id: { in: ungrouped.map((scope) => scope.id) } },
    data: { phaseId: phase.id },
  });
}
