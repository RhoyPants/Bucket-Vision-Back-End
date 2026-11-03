import assert from "node:assert/strict";
import { request, Request, Response } from "express";
import prisma from "../../config/prisma";
import { ProjectDashboardService, projectDashboardService } from "./project-dashboard.service";
import { ProjectDashboardController } from "./project-dashboard.controller";
import { DashboardService } from "../dashboard/dashboard.service";
import { summarizeHealth } from "../../utils/schedule-health";
import * as scurveService from "../progress/scurve.service";

const restores: Array<() => void> = [];
const mock = {
  method<T extends object, K extends keyof T, A extends unknown[], R>(
    target: T, key: K, implementation: (...args: A) => R
  ) {
    const original = target[key];
    let calls = 0;
    Reflect.set(target, key, (...args: A) => { calls++; return implementation(...args); });
    restores.push(() => { Reflect.set(target, key, original); });
    return { mock: { callCount: () => calls } };
  },
  restoreAll() { for (const restore of restores.reverse()) restore(); },
};

async function main() {
  const calendar = {
    monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
    saturday: false, sunday: false, includeHolidays: true,
  };
  const asOf = new Date("2026-10-30T09:00:00+08:00");
  const project = {
    ...calendar, id: "p1", name: "Legacy project", ownerId: "owner", progress: 50, status: "ACTIVE",
    startDate: new Date("2026-10-20T00:00:00+08:00"),
    expectedEndDate: new Date("2026-10-29T00:00:00+08:00"),
  };
  const rows = [
    { id: "late", progress: 99 }, { id: "complete", progress: 100 },
    { id: "missing", progress: null },
    { id: "future", progress: 0, projectedStartDate: new Date("2099-01-01"), projectedEndDate: new Date("2099-02-01") },
  ].map((row) => ({
    title: row.id, projectedStartDate: project.startDate, projectedEndDate: project.expectedEndDate,
    actualStartDate: null, task: { id: "t1", title: "Task", scope: { id: "s1", name: "Scope" } },
    ...row,
  }));
  mock.method(prisma.user, "findUnique", async () => ({ id: "owner", role: { name: "SUPERADMIN" } }));
  mock.method(prisma.project, "findFirst", async () => project);
  mock.method(prisma.project, "findUnique", async () => project);
  mock.method(prisma.projectMember, "findUnique", async () => ({ role: "PROJECT_MANAGER" }));
  mock.method(prisma.holiday, "findMany", async () => []);
  mock.method(prisma.subtask, "findMany", async () => rows);
  const settingRead = mock.method(prisma.projectSubtaskKpiConfig, "findUnique", async () => {
    throw new Error("V2 must not read legacy thresholds");
  });
  const settingWrite = mock.method(prisma.projectSubtaskKpiConfig, "upsert", async () => {
    throw new Error("V2 must not overwrite legacy settings");
  });
  const settingDelete = mock.method(prisma.projectSubtaskKpiConfig, "deleteMany", async () => {
    throw new Error("V2 reset must not delete legacy settings");
  });
  const snapshotWrite = mock.method(prisma.projectDashboardSnapshot, "upsert", async () => {
    throw new Error("V2 must not write legacy snapshots");
  });
  const snapshotRead = mock.method(prisma.projectDashboardSnapshot, "findMany", async () => {
    throw new Error("V2 must not reinterpret legacy snapshots");
  });
  const service = new ProjectDashboardService();
  const result = await service.getSubtaskKpi("p1", "owner", asOf);
  assert.equal(result.healthRulesVersion, 2);
  assert.deepEqual(result.summary, { total: 4, danger: 1, warning: 0, healthy: 1, notStarted: 1, unclassified: 1 });
  assert.deepEqual(result.summary, summarizeHealth(result.subtasks));
  assert.equal(result.subtasks[2].actualProgress, null);
  assert.ok(result.subtasks.every((row) => row.statusReason.length > 0));
  assert.equal((await service.getSubtaskKpi("p1", "owner", new Date("2026-10-28"))).subtasks[0].status, "HEALTHY");

  assert.deepEqual(await service.updateSubtaskKpiConfig("p1", "owner", { warningBelow: 0 }),
    { healthRulesVersion: 2, warningBelow: 0, isCustom: false });
  await service.resetSubtaskKpiConfig("p1", "owner");
  const controller = new ProjectDashboardController();
  for (const body of [{}, { warningBelow: "0" }, { warningBelow: 1 }, { warningBelow: null }]) {
    let status = 200;
    let payload: { message?: string } = {};
    const req: Request = Object.assign(Object.create(request), { params: { projectId: "p1" }, user: { id: "owner" }, body });
    const res = {
      status(code: number) { status = code; return this; },
      json(value: { message?: string }) { payload = value; return this; },
    } as Response;
    await controller.updateSubtaskKpiConfig(req, res);
    assert.equal(status, 400);
    assert.match(payload.message!, /not supported/);
  }
  const target = { id: "legacy-target", kpiId: "k1", subtaskId: "late", taskId: "t1", scopeId: "s1", criticalBelow: -90, healthyAtOrAbove: -80 };
  const kpi = { id: "k1", projectId: "p1", name: "Legacy KPI", targets: [target] };
  mock.method(prisma.dashboardKpi, "findMany", async () => [kpi]);
  mock.method(prisma.dashboardKpi, "findFirst", async () => kpi);
  mock.method(prisma.subtask, "findUnique", async () => rows[0]);
  mock.method(prisma.subtask, "findFirst", async () => rows[0]);
  mock.method(prisma.task, "findFirst", async () => ({ id: "t1" }));
  mock.method(prisma.scope, "findFirst", async () => ({ id: "s1" }));
  const dashboard = await service.get("p1", "owner", asOf);
  assert.equal(dashboard.healthRulesVersion, 2);
  assert.equal(dashboard.kpis[0].targets[0].status, "DANGER");
  assert.deepEqual(dashboard.kpis[0].targets[0].thresholds, { warningBelow: 0 });
  assert.deepEqual(dashboard.kpis[0].summary, summarizeHealth(dashboard.kpis[0].targets));
  assert.equal(target.criticalBelow, -90);
  const preview = await service.previewSource("p1", "owner", {
    scopeId: "s1", taskId: "t1", subtaskId: "late", warningBelow: 0,
  });
  assert.equal(preview.healthRulesVersion, 2);
  assert.ok(preview.statusReason.length > 0);
  mock.method(scurveService, "getSCurve", async () => ({ data: [], status: "ON_TRACK" }));
  const charts = await service.getChartData("p1", "owner");
  assert.equal(charts.healthRulesVersion, 2);
  assert.deepEqual(charts.summary, charts.defaultSubtaskKpi.summary);
  assert.deepEqual(charts.kpiStatusDistribution, charts.defaultSubtaskKpi.summary);
  assert.deepEqual(charts.customKpis[0].summary, summarizeHealth(charts.customKpis[0].targets));
  assert.ok(charts.scurve);

  let writtenTarget: Record<string, unknown> | undefined;
  mock.method(prisma.kpiTarget, "findMany", async () => [target]);
  mock.method(prisma.kpiTarget, "updateMany", async ({ data }: { data: Record<string, unknown> }) => {
    writtenTarget = data;
    return { count: 1 };
  });
  mock.method(prisma.dashboardKpi, "update", async () => kpi);
  mock.method(prisma, "$transaction", async (action: (tx: typeof prisma) => Promise<unknown>) => action(prisma));
  await service.updateTarget("p1", "k1", "legacy-target", "owner", { ...target, warningBelow: 0 });
  assert.ok(writtenTarget);
  for (const key of ["criticalBelow", "healthyAtOrAbove", "warningBelow"]) {
    assert.equal(key in writtenTarget, false);
  }
  await assert.rejects(() => service.previewSource("p1", "owner", { warningBelow: 1 }), /not supported/);
  await assert.rejects(() => service.createKpi("p1", "owner", { name: "Invalid KPI", targets: [{ warningBelow: 1 }] }), /not supported/);
  await assert.rejects(() => service.updateKpi("p1", "k1", "owner", { targets: [{ ...target, warningBelow: 1 }] }), /not supported/);

  mock.method(prisma.subtask, "findMany", async () => [{
    ...rows[3], progress: 10, actualStartDate: new Date("2026-01-01"),
  }, { ...rows[3], progress: 0 }]);
  mock.method(prisma.scope, "findUnique", async () => ({ progress: 0 }));
  mock.method(prisma.task, "findUnique", async () => ({ progress: 0 }));
  mock.method(prisma.project, "findUnique", async () => ({
    ...project, progress: 0, startDate: new Date("2099-01-01"), expectedEndDate: new Date("2099-02-01"),
  }));
  for (const source of [{ scopeId: "s1" }, { scopeId: "s1", taskId: "t1" }, {}]) {
    const aggregatePreview = await service.previewSource("p1", "owner", source);
    assert.equal(aggregatePreview.previewStatus, "HEALTHY", "A started child must prevent aggregate Not Started");
  }

  const projects = Array.from({ length: 7 }, (_, index) => ({ ...project, id: `p${index}` }));
  mock.method(prisma.project, "findMany", async ({ where }: { where: { status: unknown } }) =>
    where.status === "ACTIVE" ? projects : []);
  mock.method(prisma.incidentReport, "findMany", async () => []);
  mock.method(prisma.incidentReport, "groupBy", async () => []);
  const healthSpy = mock.method(projectDashboardService, "getSubtaskKpi", async (id: string, user: string, instant: Date) => {
    assert.equal(user, "owner");
    assert.equal(instant, asOf);
    return { ...result, project: { id, name: "Project" } };
  });
  const global = await new DashboardService().get("owner", asOf);
  assert.equal(global.healthRulesVersion, 2);
  assert.equal(global.breakdownProjects.length, 7);
  assert.equal(global.topProjects.length, 5);
  assert.equal(global.summary.totalKpis, 28);
  assert.equal(global.summary.danger, 7);
  assert.equal(global.topProjects[0].healthStatus, "DANGER");
  assert.equal(global.topProjects[0].topSubtasks[0].status, "DANGER");
  for (const key of ["danger", "warning", "healthy", "notStarted", "unclassified"] as const) {
    assert.equal(global.summary[key], global.breakdownProjects.reduce((sum, item) => sum + item.kpiSummary[key], 0));
  }
  assert.equal("trends" in global, false);
  assert.equal(healthSpy.mock.callCount(), 7);
  for (const spy of [settingRead, settingWrite, settingDelete, snapshotRead, snapshotWrite]) {
    assert.equal(spy.mock.callCount(), 0);
  }
  console.log("Schedule health V2 dashboard/API tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { mock.restoreAll(); await prisma.$disconnect(); });
