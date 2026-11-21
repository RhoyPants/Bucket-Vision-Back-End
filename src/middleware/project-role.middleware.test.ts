import assert from "node:assert/strict";
import prisma from "../config/prisma";
import { requireProjectManager, requireProjectReadAccess } from "./project-role.middleware";

// Prisma is fully mocked: this test never touches a database.
const db = prisma as any;

let project: { ownerId: string; projectMembers: { role: string }[] } | null = null;
let seenManagerQuery: any;
let accessible = false;
let approver = false;
// A role that was never synced uses the defaults; MEMBER sees only its own projects.
db.role.findUnique = async () => ({ name: "MEMBER", projectAccess: [] });
db.project.findFirst = async (q: any) => {
  const where = q.where;
  if (where.AND) return accessible ? { id: where.AND[0].id } : null; // Project Access query
  if (where.OR) return approver ? { id: where.id } : null; // approver query
  seenManagerQuery = q; // owner / co-owner query
  return project;
};

function run(guard: any, req: any) {
  return new Promise<{ nexted: boolean; status?: number; body?: any }>((resolve) => {
    const res: any = {
      status(code: number) { this.code = code; return this; },
      json(body: any) { resolve({ nexted: false, status: this.code, body }); return this; },
    };
    guard(req, res, () => resolve({ nexted: true }));
  });
}
const asUser = (id: string, params: Record<string, string>) => ({ user: { id, roleId: "r1" }, params });

async function main() {
  // --- requireProjectManager: only the owner or a co-owner of THIS project ---
  const manager = requireProjectManager("id");

  assert.equal((await run(manager, { params: { id: "p1" } })).status, 401, "needs a signed-in user");

  project = null;
  assert.equal((await run(manager, asUser("u1", { id: "p1" }))).status, 404, "unknown project");

  project = { ownerId: "u1", projectMembers: [] };
  assert.equal((await run(manager, asUser("u1", { id: "p1" }))).nexted, true, "the owner may");
  assert.equal(seenManagerQuery.where.id, "p1");
  assert.equal(seenManagerQuery.where.deletedAt, null, "a deleted project cannot be edited");

  project = { ownerId: "someone", projectMembers: [{ role: "CO_OWNER" }] };
  assert.equal((await run(manager, asUser("u1", { id: "p1" }))).nexted, true, "a co-owner may, even if someone else owns it");
  project = { ownerId: "someone", projectMembers: [{ role: "OWNER" }] };
  assert.equal((await run(manager, asUser("u1", { id: "p1" }))).nexted, true, "an OWNER membership row counts as owner");

  for (const role of ["MEMBER", "SUB_OWNER", "LEADER"]) {
    project = { ownerId: "someone", projectMembers: [{ role }] };
    const out = await run(manager, asUser("u1", { id: "p1" }));
    assert.equal(out.status, 403, `${role} must not edit`);
    assert.equal(out.body.error.code, "PROJECT_MANAGER_ONLY");
  }
  // A BU Head / OP / Superadmin who is not in the project gets nothing extra: the check ignores system roles.
  project = { ownerId: "someone", projectMembers: [] };
  assert.equal((await run(manager, { user: { id: "bu-head", roleId: "r-bu-head" }, params: { id: "p1" } })).status, 403, "system role does not matter, only the role in the project");

  // reads the id from the parameter it is told to use
  const byProjectId = requireProjectManager("projectId");
  project = { ownerId: "u1", projectMembers: [] };
  await run(byProjectId, asUser("u1", { projectId: "p9" }));
  assert.equal(seenManagerQuery.where.id, "p9");

  // --- requireProjectReadAccess: Project Access, or an approver of the project ---
  const reader = requireProjectReadAccess("id");
  accessible = true; approver = false;
  assert.equal((await run(reader, asUser("u1", { id: "p1" }))).nexted, true, "someone with Project Access reads");
  accessible = false; approver = true;
  assert.equal((await run(reader, asUser("u1", { id: "p1" }))).nexted, true, "an approver reads a project they must review");
  accessible = false; approver = false;
  const denied = await run(reader, asUser("u1", { id: "p1" }));
  assert.equal(denied.status, 404, "anyone else gets 'not found', not a hint that it exists");
  assert.match(denied.body.message, /not found or access denied/i);
  assert.equal((await run(reader, { params: { id: "p1" } })).status, 401);

  console.log("project role guard tests passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
