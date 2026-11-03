import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { lockProjectForStructureUpdate, prepareProjectStructureMode } from "./project-structure.service";

function signal<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function run() {
  const configured = process.env.STRUCTURE_MODE_TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!configured) throw new Error("A local DATABASE_URL or dedicated STRUCTURE_MODE_TEST_DATABASE_URL is required");
  const url = new URL(configured);
  if (!process.env.STRUCTURE_MODE_TEST_DATABASE_URL && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Use a local database or explicitly configure STRUCTURE_MODE_TEST_DATABASE_URL for isolated-schema tests");
  }
  // Only a unique, newly created schema is written. No public/production tables
  // or existing records are modified, and cleanup targets this exact schema.
  const schema = `structure_mode_test_${randomUUID().replace(/-/g, "")}`;
  assert.match(schema, /^structure_mode_test_[a-f0-9]{32}$/);
  const admin = new PrismaClient({ datasourceUrl: configured });
  url.searchParams.set("schema", schema);
  url.searchParams.set("connection_limit", "5");
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  const table = (name: string) => `"${schema}"."${name}"`;
  const transaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    return fn(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
  const pid = async (tx: Prisma.TransactionClient) => (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
  const waitForBlocked = async (backend: number) => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const [row] = await admin.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${backend}::integer)) > 0 AS blocked`;
      if (row.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.fail("Expected a real PostgreSQL row-lock wait");
  };
  const changeMode = (mode: boolean) => transaction(async (tx) => {
    const project = await lockProjectForStructureUpdate(tx, "p");
    await prepareProjectStructureMode(tx, project, mode);
    return tx.project.update({ where: { id: "p" }, data: { isPhasing: mode }, select: { isPhasing: true } });
  });
  const reset = async () => {
    await admin.$executeRawUnsafe(`TRUNCATE ${["Subtask", "Task", "Scope", "Phase", "Project"].map(table).join(", ")}`);
    await admin.$executeRawUnsafe(`INSERT INTO ${table("Project")} (id) VALUES ('p')`);
    await admin.$executeRawUnsafe(`INSERT INTO ${table("Phase")} (id,"projectId",name) VALUES ('phase','p','Phase')`);
    await admin.$executeRawUnsafe(`INSERT INTO ${table("Scope")} (id,"projectId","phaseId") VALUES ('scope','p','phase')`);
    await admin.$executeRawUnsafe(`INSERT INTO ${table("Task")} (id,"scopeId") VALUES ('task','scope')`);
  };
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    for (const ddl of [
      `CREATE TABLE ${table("Project")} (id text PRIMARY KEY, status text NOT NULL DEFAULT 'DRAFT', "isPhasing" boolean NOT NULL DEFAULT false, "isBudgeted" boolean NOT NULL DEFAULT true, "updatedAt" timestamp NOT NULL DEFAULT now())`,
      `CREATE TABLE ${table("Phase")} (id text PRIMARY KEY, "projectId" text NOT NULL REFERENCES ${table("Project")}(id), name text NOT NULL, description text, "order" integer NOT NULL DEFAULT 0, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now(), "deletedAt" timestamp)`,
      `CREATE TABLE ${table("Scope")} (id text PRIMARY KEY, "projectId" text NOT NULL REFERENCES ${table("Project")}(id), "phaseId" text REFERENCES ${table("Phase")}(id), "updatedAt" timestamp NOT NULL DEFAULT now())`,
      `CREATE TABLE ${table("Task")} (id text PRIMARY KEY, "scopeId" text NOT NULL REFERENCES ${table("Scope")}(id))`,
      `CREATE TABLE ${table("Subtask")} (id text PRIMARY KEY, "taskId" text NOT NULL REFERENCES ${table("Task")}(id))`,
    ]) await admin.$executeRawUnsafe(ddl);

    await reset();
    for (const mode of [true, false, true, false]) assert.equal((await changeMode(mode)).isPhasing, mode);
    const [links] = await admin.$queryRawUnsafe<Array<{ phaseId: string }>>(`SELECT "phaseId" FROM ${table("Scope")} WHERE id='scope'`);
    assert.equal(links.phaseId, "phase");
    await admin.$executeRawUnsafe(`UPDATE ${table("Scope")} SET "phaseId"=NULL`);
    await admin.$executeRawUnsafe(`DELETE FROM ${table("Phase")}`);
    await changeMode(true);
    const [grouped] = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM ${table("Scope")} WHERE "phaseId" IS NOT NULL`);
    assert.equal(Number(grouped.count), 1);
    console.log("PostgreSQL mode persistence and grouping passed");

    // Creation wins: conversion waits for the INSERT's FK lock, then its fresh
    // count sees the committed subtask and rejects the mode change.
    await reset();
    const inserted = signal(); const releaseInsert = signal(); const converterPid = signal<number>();
    const creator = transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "Subtask" (id,"taskId") VALUES ('child','task')`;
      inserted.resolve(); await releaseInsert.promise;
    });
    await inserted.promise;
    const converter = transaction(async (tx) => {
      converterPid.resolve(await pid(tx));
      const project = await lockProjectForStructureUpdate(tx, "p");
      await prepareProjectStructureMode(tx, project, true);
      await tx.project.update({ where: { id: "p" }, data: { isPhasing: true }, select: { isPhasing: true } });
    });
    const converterResult = converter.then(() => null, (error) => error);
    try { await waitForBlocked(await converterPid.promise); } finally { releaseInsert.resolve(); }
    await creator;
    const conflict = await converterResult;
    assert.equal(conflict?.statusCode, 409);
    assert.match(conflict.message, /subtasks exist anywhere/);
    console.log("Concurrent subtask creation before conversion blocks switching");

    // Conversion wins: an INSERT cannot commit in the count/update gap.
    await reset();
    const prepared = signal(); const releaseMode = signal(); const childPid = signal<number>();
    const modeWriter = transaction(async (tx) => {
      const project = await lockProjectForStructureUpdate(tx, "p");
      await prepareProjectStructureMode(tx, project, true);
      prepared.resolve(); await releaseMode.promise;
      await tx.project.update({ where: { id: "p" }, data: { isPhasing: true }, select: { isPhasing: true } });
    });
    await prepared.promise;
    const waitingCreator = transaction(async (tx) => {
      childPid.resolve(await pid(tx));
      await tx.$executeRaw`INSERT INTO "Subtask" (id,"taskId") VALUES ('child','task')`;
    });
    try { await waitForBlocked(await childPid.promise); } finally { releaseMode.resolve(); }
    await Promise.all([modeWriter, waitingCreator]);
    await assert.rejects(() => changeMode(false), (error: any) => error.statusCode === 409);
    console.log("Conversion serializes concurrent subtask insertion; subsequent switch is rejected");

    // Submission wins: row lock makes mode validation see the submitted status.
    await reset();
    const submitted = signal(); const releaseSubmit = signal(); const modePid = signal<number>();
    const submitter = transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "Project" SET status='FOR_REVIEW' WHERE id='p'`;
      submitted.resolve(); await releaseSubmit.promise;
    });
    await submitted.promise;
    const afterSubmission = transaction(async (tx) => {
      modePid.resolve(await pid(tx));
      const project = await lockProjectForStructureUpdate(tx, "p");
      await prepareProjectStructureMode(tx, project, true);
    });
    const submittedResult = afterSubmission.then(() => null, (error) => error);
    try { await waitForBlocked(await modePid.promise); } finally { releaseSubmit.resolve(); }
    await submitter;
    const submissionConflict = await submittedResult;
    assert.equal(submissionConflict?.statusCode, 409);
    assert.match(submissionConflict.message, /DRAFT/);
    console.log("Concurrent submission cannot bypass Draft validation");
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
