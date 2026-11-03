import assert from "node:assert/strict";
import { ProjectStatus, Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { ProjectController } from "./project.controller";
import { ScopeController } from "../scope/scope.controller";

async function run() {
  const originals: Array<[any, string, any]> = [];
  const patch = (object: any, key: string, fn: any) => { originals.push([object, key, object[key]]); object[key] = fn; };
  let project: any;
  let phases: any[];
  let scopes: any[];
  let tasks: any[];
  let subtasks: any[];
  let countCalls = 0;
  let locks: string[] = [];
  let failUpdate = false;
  const reset = (isPhasing = false, status: ProjectStatus = "DRAFT") => {
    project = { id: "p", name: "Original", isPhasing, status, isBudgeted: true, totalBudget: 1000,
      startDate: new Date("2026-10-01"), expectedEndDate: new Date("2026-10-30"), monday: true };
    phases = []; scopes = []; tasks = []; subtasks = []; countCalls = 0; locks = []; failUpdate = false;
  };
  const assignDefined = (target: any, data: any) => Object.assign(target,
    Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
  const response = () => ({ statusCode: 200, body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = structuredClone(body); return this; } });
  const update = async (body: any) => {
    const res = response();
    await ProjectController.update({ params: { id: "p" }, body } as any, res as any);
    return res;
  };
  patch(prisma, "$transaction", async (fn: any, options: any) => {
    assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.ReadCommitted);
    const before = structuredClone({ project, phases, scopes });
    try { return await fn(prisma); } catch (error) {
      ({ project, phases, scopes } = before); throw error;
    }
  });
  patch(prisma, "$queryRaw", async (query: TemplateStringsArray) => { locks.push(query.join("?")); return []; });
  patch(prisma.project, "findUnique", async () => project ? { ...project, scopes, projectMembers: [], wbsBusinessUnits: [] } : null);
  patch(prisma.project, "update", async ({ data }: any) => {
    if (failUpdate) throw new Error("Simulated update failure");
    assignDefined(project, data); return { ...project, wbsBusinessUnits: [] };
  });
  patch(prisma.scope, "findMany", async ({ where }: any) => where.OR
    ? scopes.filter((s) => !s.phaseId || !phases.some((p) => !p.deletedAt && p.id === s.phaseId)) : scopes);
  patch(prisma.scope, "updateMany", async ({ where, data }: any) => {
    for (const scope of scopes.filter((s) => where.id.in.includes(s.id))) assignDefined(scope, data);
    return { count: where.id.in.length };
  });
  patch(prisma.scope, "findUnique", async () => scopes[0]);
  patch(prisma.scope, "update", async ({ data }: any) => assignDefined(scopes[0], data));
  patch(prisma.phase, "findMany", async () => phases.filter((p) => !p.deletedAt));
  patch(prisma.phase, "findFirst", async ({ where }: any) => phases.find((p) => p.id === where.id && !p.deletedAt));
  patch(prisma.phase, "create", async ({ data }: any) => {
    const phase = { id: "generated-phase", ...data }; phases.push(phase); return phase;
  });
  patch(prisma.task, "findMany", async () => tasks);
  patch(prisma.subtask, "findMany", async () => subtasks);
  patch(prisma.subtask, "count", async ({ where }: any) => {
    countCalls++;
    assert.deepEqual(where, { task: { scope: { projectId: "p" } } }, "Count all subtasks including phase-linked and soft-deleted structure");
    assert.match(locks[0], /"Project".*FOR UPDATE/);
    assert.ok(locks.some((query) => query.includes('FOR UPDATE OF s')));
    assert.ok(locks.some((query) => query.includes('FOR UPDATE OF t')));
    return subtasks.length;
  });
  try {
    for (const initialMode of [false, true]) {
      reset(initialMode);
      let res = await update({ isPhasing: !initialMode });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.isPhasing, !initialMode);
      assert.equal(project.isPhasing, !initialMode);
      assert.equal(countCalls, 1);
      res = response();
      await ProjectController.getById({ params: { id: "p" } } as any, res as any);
      assert.equal(res.body.isPhasing, !initialMode);
      res = response();
      await ProjectController.getFull({ params: { id: "p" } } as any, res as any);
      assert.equal(res.body.isPhasing, !initialMode);
    }
    reset(true); phases = [{ id: "phase", name: "Empty", order: 0 }];
    assert.equal((await update({ isPhasing: false })).statusCode, 200);
    assert.equal(phases.length, 1);
    assert.equal((await update({ isPhasing: true })).statusCode, 200);

    reset();
    scopes = [{ id: "s", projectId: "p", phaseId: null, name: "Scope", budgetAllocated: 500, order: 2 }];
    tasks = [{ id: "t", scopeId: "s", title: "Task", budgetAllocated: 250, assignees: [{ userId: "user" }] }];
    const originalTasks = structuredClone(tasks);
    const originalProject = structuredClone(project);
    for (const mode of [true, false, true, false, true]) {
      const res = await update({ isPhasing: mode });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.isPhasing, mode);
      assert.deepEqual(tasks, originalTasks);
      assert.equal(scopes[0].id, "s");
      assert.equal(scopes[0].budgetAllocated, 500);
      assert.equal(scopes[0].phaseId, "generated-phase");
      assert.equal(phases.length, 1);
      assert.deepEqual({ ...project, isPhasing: false }, originalProject);
      const full = response();
      await ProjectController.getFull({ params: { id: "p" } } as any, full as any);
      assert.equal(full.body.isPhasing, mode);
      assert.equal(full.body.scopes[0].tasks[0].id, "t");
      assert.equal(full.body.phases[0].scopes[0].id, "s");
    }
    // Preserve existing phase associations and group newly added Standard scopes.
    reset(true);
    phases = [{ id: "original", name: "Original phase", order: 0 }];
    scopes = [{ id: "s", projectId: "p", phaseId: "original" }];
    await update({ isPhasing: false });
    const scopeRes = response();
    await ScopeController.update({ params: { id: "s" }, body: { description: "Still editable" } } as any, scopeRes as any);
    assert.equal(scopeRes.statusCode, 200);
    assert.equal(scopes[0].phaseId, "original");
    const unchangedLink = response();
    await ScopeController.update({ params: { id: "s" }, body: { description: "Full save", phaseId: "original" } } as any, unchangedLink as any);
    assert.equal(unchangedLink.statusCode, 200);
    assert.equal(scopes[0].phaseId, "original");
    scopes.push({ id: "new", projectId: "p", phaseId: null });
    await update({ isPhasing: true });
    assert.ok(scopes.every((scope) => scope.phaseId === "original"));
    assert.equal(phases.length, 1);

    for (const phased of [false, true]) {
      reset(phased);
      subtasks = [{ id: "existing" }];
      assert.equal((await update({ isPhasing: phased })).statusCode, 200);
      assert.equal((await update({ name: "Draft unrelated edit" })).statusCode, 200);
      assert.equal(countCalls, 0);
      for (const deletedAt of [null, new Date()]) {
        reset(phased);
        subtasks = [{ id: "child", taskId: "under-any-scope-or-phase", deletedAt }];
        const res = await update({ isPhasing: !phased });
        assert.equal(res.statusCode, 409);
        assert.match(res.body.message, /subtasks exist anywhere/);
        assert.equal(project.isPhasing, phased);
      }
      for (const status of Object.values(ProjectStatus).filter((s) => s !== "DRAFT")) {
        reset(phased, status);
        const res = await update({ isPhasing: !phased });
        assert.equal(res.statusCode, 409);
        assert.match(res.body.message, /DRAFT/);
        assert.equal(project.isPhasing, phased);
        assert.equal(countCalls, 0);
        // Unchanged values and unrelated updates must bypass conversion checks.
        subtasks = [{ id: "existing" }];
        assert.equal((await update({ isPhasing: phased, description: "Updated" })).statusCode, 200);
        assert.equal((await update({ name: "Unrelated" })).statusCode, 200);
        assert.equal(project.isPhasing, phased);
        assert.equal(countCalls, 0);
      }
    }
    reset(true);
    assert.equal((await update({ isPhasing: "false" })).body.isPhasing, false);
    assert.equal((await update({ isPhasing: false })).statusCode, 200);
    assert.equal(countCalls, 1);
    assert.equal((await update({ description: "Omitted" })).body.isPhasing, false);
    assert.equal(countCalls, 1);
    assert.equal((await update({ isPhasing: null })).statusCode, 400);
    reset(false, "NEEDS_REVISION");
    assert.equal((await update({ isPhasing: true, status: "DRAFT" })).statusCode, 409);
    assert.equal(project.status, "NEEDS_REVISION");

    // Failed project updates roll back any newly created grouping/phase links.
    reset(); scopes = [{ id: "s", phaseId: null }]; failUpdate = true;
    assert.equal((await update({ isPhasing: true })).statusCode, 400);
    assert.equal(scopes[0].phaseId, null);
    assert.deepEqual(phases, []);
    project = null;
    assert.equal((await update({ isPhasing: true })).statusCode, 404);
    console.log("Project structure mode regression tests passed");
  } finally {
    for (const [object, key, original] of originals.reverse()) object[key] = original;
    await prisma.$disconnect();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
