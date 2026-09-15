import assert from "node:assert/strict";
import { averageSubtaskProgress, parseIsBudgeted, recomputeNonBudgetedProject } from "./non-budgeted-progress";
import { reportCalculationService } from "../../reports/services/report-calculation.service";
import { plannedProgressAt } from "./planned-progress";

async function main() {
  assert.equal(parseIsBudgeted(undefined), undefined);
  for (const input of [false, "false"]) assert.equal(parseIsBudgeted(input), false);
  for (const input of [true, "true"]) assert.equal(parseIsBudgeted(input), true);
  for (const input of [null, "", 0, "yes"]) assert.throws(() => parseIsBudgeted(input));
  assert.equal(averageSubtaskProgress([]), 0);
  assert.equal(averageSubtaskProgress([{progress: 100}, {progress: 50}]), 75);

  const writes = new Map<string, number>();
  let isBudgeted = false;
  let scopes: any[] = [
    { id: "scope-a", budgetPercent: 80, tasks: [
      { id: "task-a", budgetPercent: 90, subtasks: [{ progress: 100, budgetPercent: 99 }] },
      { id: "task-b", budgetPercent: 10, subtasks: [{ progress: 0, budgetPercent: 1 }, { progress: 50, budgetPercent: 0 }] },
    ] },
    { id: "empty-scope", budgetPercent: 20, tasks: [{ id: "empty-task", budgetPercent: 100, subtasks: [] }] },
  ];
  const update = async ({where, data}: any) => { writes.set(where.id, Number(data.progress)); return data; };
  const db: any = {
    project: { findUnique: async () => ({isBudgeted}), update },
    scope: { findMany: async (query: any) => { assert.equal(query.where.deletedAt, null); return scopes; }, update },
    task: { update },
  };
  await recomputeNonBudgetedProject(db, "project");
  assert.equal(writes.get("task-a"), 100);
  assert.equal(writes.get("task-b"), 25);
  assert.equal(writes.get("scope-a"), 50);
  assert.equal(writes.get("project"), 50); // Not the 62.5% average of task averages.
  assert.equal(writes.get("empty-task"), 0);
  scopes[0].tasks[1].subtasks.push({progress: 0, budgetPercent: 1000});
  await recomputeNonBudgetedProject(db, "project");
  assert.equal(writes.get("project"), 37.5);
  scopes = [];
  await recomputeNonBudgetedProject(db, "project");
  assert.equal(writes.get("project"), 0);
  isBudgeted = true;
  writes.clear();
  assert.equal(await recomputeNonBudgetedProject(db, "project"), false);
  assert.equal(writes.size, 0); // Existing budgeted path is left alone.
  scopes = [{id: "scope", budgetPercent: 100, tasks: [{id: "task", budgetPercent: 100, subtasks: [
    {progress: 100, budgetPercent: 70}, {progress: 0, budgetPercent: 30},
  ]}]}];
  await recomputeNonBudgetedProject(db, "project", true);
  assert.equal(writes.get("project"), 70); // Switching a draft back restores budget weights.

  const calendar = {monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false, includeHolidays: true};
  const scheduled = {projectedStartDate: new Date("2026-09-14T00:00:00Z"), projectedEndDate: new Date("2026-09-18T00:00:00Z")};
  assert.equal(plannedProgressAt(scheduled, new Date("2026-09-15T00:00:00Z"), calendar, new Set()), 40);
  assert.equal(plannedProgressAt(scheduled, new Date("2026-09-15T00:00:00Z"), calendar, new Set(["2026-09-14"])), 25);
  assert.equal(plannedProgressAt({}, new Date(), calendar, new Set()), null);

  const rows: any[] = [{isBudgeted: false, budgetPercent: 99, progress: 100}, {isBudgeted: false, budgetPercent: 1, progress: 0}];
  assert.equal(reportCalculationService.aggregate(rows, (row: any) => row.progress), 50);
  assert.equal(reportCalculationService.aggregate(rows, (row: any) => row.progress || null), 50);
  console.log("Non-budgeted progress tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
