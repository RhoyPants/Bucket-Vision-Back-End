import assert from "node:assert/strict";
import { test, TestContext } from "node:test";
import { response as expressResponse } from "express";
import type { Request, Response } from "express";
import type { ProjectParamsDTO } from "./project.dto";

process.env.ASSETS_ENV = "dev";
const prisma = (require("../../config/prisma") as typeof import("../../config/prisma")).default;
const assets = require("../../services/s3-assets.service") as typeof import("../../services/s3-assets.service");
const { ProjectController } = require("./project.controller") as typeof import("./project.controller");

function setup(t: TestContext, hasStructure = true) {
  const originals: Array<{ object: object; key: string; value: unknown }> = [];
  const patch = (object: object, key: string, implementation: Function) => {
    originals.push({ object, key, value: Reflect.get(object, key) });
    Reflect.set(object, key, implementation);
  };
  t.after(() => {
    for (const { object, key, value } of originals.reverse()) Reflect.set(object, key, value);
  });
  const deletedAssets: string[] = [];
  const events: string[] = [];
  const projectId = "selected-version";
  patch(prisma, "$transaction", async (fn: (tx: typeof prisma) => Promise<unknown>, options: { timeout: number }) => {
    assert.equal(options.timeout, 120_000);
    return fn(prisma);
  });
  patch(prisma.project, "findUnique", async () => ({
    id: projectId,
    scopes: hasStructure ? [{ id: "scope", tasks: [{ id: "task", subtasks: [{ id: "subtask" }] }] }] : [],
  }));
  patch(prisma.checklist, "findMany", async () => hasStructure ? [{ id: "checklist" }] : []);
  for (const delegate of [prisma.attachment, prisma.progressLog, prisma.progressLogAttachment,
    prisma.incidentAttachment, prisma.projectOrgChartNode]) {
    patch(delegate, "findMany", async () => []);
  }
  for (const [name, delegate] of [
    ["activityLog", prisma.activityLog], ["progressLog", prisma.progressLog],
    ["checklist", prisma.checklist], ["subtaskAssignee", prisma.subtaskAssignee],
    ["comment", prisma.comment], ["attachment", prisma.attachment],
    ["subtask", prisma.subtask], ["taskAssignee", prisma.taskAssignee],
    ["task", prisma.task], ["scope", prisma.scope], ["projectMember", prisma.projectMember],
  ] as const) {
    patch(delegate, "deleteMany", async () => { events.push(name); return { count: 1 }; });
  }
  patch(prisma.project, "delete", async ({ where }: { where: { id: string } }) => {
    assert.deepEqual(where, { id: projectId });
    events.push("project");
    return { id: projectId };
  });
  patch(assets, "deleteManagedAsset", async (value: string) => {
    assert.deepEqual(events, [], "S3 cleanup must finish before deleting any database row");
    deletedAssets.push(value);
    return true;
  });
  const res = Object.assign(Object.create(expressResponse) as Response, {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  });
  const run = async () => {
    await ProjectController.delete({ params: { id: projectId } } as Request<ProjectParamsDTO>, res);
    return res;
  };
  return { deletedAssets, events, run, projectId, patch };
}

test("deletes all file surfaces once, removes entity logs, and deletes only the selected version last", async (t) => {
  const { deletedAssets, events, run, projectId, patch } = setup(t);
  const key = "dev/projects/selected-version/shared.pdf";
  patch(prisma.attachment, "findMany", async (args: { where: { fileUrl?: unknown } }) =>
    args.where.fileUrl ? [] : [{ fileUrl: key }, { fileUrl: assets.buildAssetUrl(key) }]);
  patch(prisma.progressLog, "findMany", async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? [] : [{ photoUrl: "dev/progress/p/photo.jpg", attachmentUrl: "dev/progress/p/legacy.pdf" }]);
  patch(prisma.progressLogAttachment, "findMany", async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? [] : [{ url: "dev/progress/p/attachment.pdf" }]);
  patch(prisma.incidentAttachment, "findMany", async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? [] : [{ fileUrl: "dev/incidents/i/evidence.pdf" }]);
  patch(prisma.projectOrgChartNode, "findMany", async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? [] : [{ photoUrl: "dev/org-chart-photos/p/photo.jpg" }]);
  let logWhere: unknown;
  patch(prisma.activityLog, "deleteMany", async ({ where }: { where: unknown }) => {
    logWhere = where; events.push("activityLog"); return { count: 1 };
  });
  assert.equal((await run()).statusCode, 200);
  assert.equal(deletedAssets.length, 6);
  assert.equal(new Set(deletedAssets.map(assets.fileKeyFromStoredValue)).size, 6);
  assert.deepEqual(logWhere, {
    OR: [
      { subtaskId: { in: ["subtask"] } },
      { entityType: "PROJECT", entityId: projectId },
      { entityType: "SCOPE", entityId: { in: ["scope"] } },
      { entityType: "TASK", entityId: { in: ["task"] } },
      { entityType: "SUBTASK", entityId: { in: ["subtask"] } },
      { entityType: "CHECKLIST", entityId: { in: ["checklist"] } },
    ],
  });
  assert.ok(events.indexOf("activityLog") < events.indexOf("checklist"));
  assert.ok(events.indexOf("subtask") < events.indexOf("task"));
  assert.ok(events.indexOf("task") < events.indexOf("scope"));
  assert.equal(events[events.length - 1], "project");
});

test("retains assets referenced by other versions across every file surface", async (t) => {
  const { deletedAssets, run, patch } = setup(t);
  const keys = ["project", "legacy", "progress", "incident", "org"].map((id) => `dev/projects/p/${id}.pdf`);
  patch(prisma.attachment, "findMany", async (args: { where: { fileUrl?: unknown; AND?: unknown } }) => {
    if (!args.where.fileUrl) return keys.map((fileUrl) => ({ fileUrl }));
    assert.ok(args.where.AND, "nullable attachment owners must be checked explicitly");
    return [{ fileUrl: assets.buildAssetUrl(keys[0]) }];
  });
  patch(prisma.progressLog, "findMany", async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? [{ photoUrl: null, attachmentUrl: assets.buildAssetUrl(keys[1]) }] : []);
  patch(prisma.progressLogAttachment, "findMany", async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? [{ url: assets.buildAssetUrl(keys[2]) }] : []);
  patch(prisma.incidentAttachment, "findMany", async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? [{ fileUrl: assets.buildAssetUrl(keys[3]) }] : []);
  patch(prisma.projectOrgChartNode, "findMany", async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? [{ photoUrl: assets.buildAssetUrl(keys[4]) }] : []);
  assert.equal((await run()).statusCode, 200);
  assert.deepEqual(deletedAssets, []);
});

test("S3 failure surfaces an error before any database row is deleted", async (t) => {
  const { events, run, patch } = setup(t);
  patch(prisma.attachment, "findMany", async (args: { where: { fileUrl?: unknown } }) =>
    args.where.fileUrl ? [] : [{ fileUrl: "dev/projects/p/file.pdf" }]);
  patch(assets, "deleteManagedAsset", async () => { throw new Error("S3 unavailable"); });
  t.mock.method(console, "error", () => {});
  const res = await run();
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "S3 unavailable" });
  assert.deepEqual(events, []);
});

test("empty project still removes project-level activity logs", async (t) => {
  const { events, deletedAssets, run } = setup(t, false);
  assert.equal((await run()).statusCode, 200);
  assert.deepEqual(events, ["activityLog", "projectMember", "attachment", "project"]);
  assert.deepEqual(deletedAssets, []);
});

test("missing project returns 404 without deleting files or rows", async (t) => {
  const { events, deletedAssets, run, patch } = setup(t);
  patch(prisma.project, "findUnique", async () => null);
  t.mock.method(console, "error", () => {});
  assert.equal((await run()).statusCode, 404);
  assert.deepEqual(events, []);
  assert.deepEqual(deletedAssets, []);
});
