import { Prisma } from "@prisma/client";

/** Equal weight per leaf, without rounding intermediate task/scope averages. */
export function averageSubtaskProgress(rows: Array<{ progress: unknown }>): number {
  return rows.length ? rows.reduce((sum, row) => sum + Number(row.progress), 0) / rows.length : 0;
}

export function parseIsBudgeted(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("isBudgeted must be true or false");
}

export async function recomputeNonBudgetedProject(db: Prisma.TransactionClient, projectId: string, force = false): Promise<boolean> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { isBudgeted: true } });
  if (!project || (project.isBudgeted && !force)) return false;
  const scopes = await db.scope.findMany({
    where: { projectId, deletedAt: null },
    include: { tasks: { where: { deletedAt: null }, include: { subtasks: { where: { deletedAt: null }, select: { progress: true, budgetPercent: true } } } } },
  });
  if (project.isBudgeted) {
    const weighted = (rows: Array<{progress: unknown; budgetPercent: number | null}>) => {
      const total = rows.reduce((sum, row) => sum + (row.budgetPercent ?? 1), 0);
      return total > 0 ? Number((rows.reduce((sum, row) => sum + Number(row.progress) * (row.budgetPercent ?? 1), 0) / total).toFixed(2)) : 0;
    };
    for (const scope of scopes) {
      for (const task of scope.tasks) {
        task.progress = new Prisma.Decimal(weighted(task.subtasks));
        await db.task.update({where: {id: task.id}, data: {progress: task.progress}});
      }
      scope.progress = new Prisma.Decimal(weighted(scope.tasks));
      await db.scope.update({where: {id: scope.id}, data: {progress: scope.progress}});
    }
    await db.project.update({where: {id: projectId}, data: {progress: weighted(scopes)}});
    return true;
  }
  const all: Array<{ progress: unknown }> = [];
  for (const scope of scopes) {
    const leaves = scope.tasks.flatMap(task => task.subtasks);
    for (const task of scope.tasks) {
      await db.task.update({ where: { id: task.id }, data: { progress: Number(averageSubtaskProgress(task.subtasks).toFixed(2)) } });
    }
    await db.scope.update({ where: { id: scope.id }, data: { progress: Number(averageSubtaskProgress(leaves).toFixed(2)) } });
    all.push(...leaves);
  }
  await db.project.update({ where: { id: projectId }, data: { progress: Number(averageSubtaskProgress(all).toFixed(2)) } });
  return true;
}
