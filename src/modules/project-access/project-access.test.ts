import assert from "node:assert/strict";
import prisma from "../../config/prisma";
import { buildAccessibleProjectWhere } from "../project/project-access";
import {
  ALL_STATUSES,
  META_CONFIGURED,
  META_LIST_CONFIGURED,
  SCOPE_ALL,
  SCOPE_BUSINESS_UNIT,
  SCOPE_OWN,
  buildDefinitions,
  defaultKeysForRoleName,
  expandImplied,
  listStatusKey,
  resolveConfig,
  statusKey,
} from "./project-access.keys";
import {
  getMyProjectAccess,
  getRoleView,
  invalidateRoleProjectAccess,
  setRoleProjectAccess,
  syncRoleProjectAccess,
} from "./project-access.service";

// Prisma is fully mocked: this test never touches a database.
const db = prisma as any;

type FakeRole = { id: string; name: string; keys: string[] };
const roles: Record<string, FakeRole> = {};
const users: Record<string, { businessUnitId: string | null }> = { u1: { businessUnitId: "bu1" }, u2: { businessUnitId: null } };
const audit: any[] = [];
const writes: { removed: string[]; added: string[] } = { removed: [], added: [] };

const setRole = (id: string, name: string, keys: string[] = []) => { roles[id] = { id, name, keys }; invalidateRoleProjectAccess(); };
const asDb = (r: FakeRole) => ({ id: r.id, name: r.name, projectAccess: r.keys.map((key) => ({ key })) });

db.role.findUnique = async ({ where }: any) => (roles[where.id] ? asDb(roles[where.id]) : null);
db.role.findMany = async () => Object.values(roles).map(asDb);
db.user.findUnique = async ({ where }: any) => users[where.id] ?? null;
db.roleProjectAccess.deleteMany = async ({ where }: any) => {
  writes.removed.push(...where.key.in);
  roles[where.roleId].keys = roles[where.roleId].keys.filter((k) => !where.key.in.includes(k));
};
db.roleProjectAccess.createMany = async ({ data }: any) => {
  for (const d of data) { writes.added.push(d.key); roles[d.roleId].keys.push(d.key); }
};
db.activityLog.create = async ({ data }: any) => { audit.push(data); };
db.$transaction = async (fn: any) => fn(db);

async function rejects(fn: () => Promise<unknown>, status: number, code: string) {
  try { await fn(); } catch (e: any) {
    assert.equal(e.status, status, `expected ${status}, got ${e.status} (${e.message})`);
    assert.equal(e.code, code);
    return;
  }
  assert.fail("expected the call to reject");
}

async function main() {
  // --- keys and defaults ---
  assert.equal(ALL_STATUSES.length, 10, "one status key per project status");
  const groups = buildDefinitions();
  assert.deepEqual(groups.map((g) => g.id), ["scope", "status", "list"]);
  assert.ok(groups[0].items.find((i) => i.key === SCOPE_OWN)?.locked, "own projects are always on");
  assert.deepEqual(groups[1].enabledWhenAny, [SCOPE_BUSINESS_UNIT, SCOPE_ALL]);
  assert.deepEqual(expandImplied([SCOPE_ALL]).sort(), [SCOPE_ALL, SCOPE_BUSINESS_UNIT].sort(), "all projects includes the business unit");
  for (const name of ["SUPERADMIN", "OP"]) assert.ok(resolveConfig(defaultKeysForRoleName(name)).scopeAll, `${name} defaults to all projects`);
  const buDefault = resolveConfig(defaultKeysForRoleName("BU_HEAD"));
  assert.ok(buDefault.scopeBusinessUnit && !buDefault.scopeAll, "BU_HEAD defaults to the business unit");
  const memberDefault = resolveConfig(defaultKeysForRoleName("MEMBER"));
  assert.ok(!memberDefault.scopeAll && !memberDefault.scopeBusinessUnit && memberDefault.allStatuses, "anyone else only sees their own projects");

  // Projects page statuses: everything for SUPERADMIN and BU_HEAD, Active only for everyone else (what the browser used to force)
  for (const name of ["SUPERADMIN", "BU_HEAD"]) assert.ok(resolveConfig(defaultKeysForRoleName(name)).listAllStatuses, `${name} lists every status`);
  for (const name of ["OP", "PIC", "LEADER", "MEMBER"]) {
    assert.deepEqual(resolveConfig(defaultKeysForRoleName(name)).listStatuses, ["ACTIVE"], `${name} lists only Active projects`);
  }

  // --- the query builder: a role that was never synced behaves exactly as before ---
  setRole("r-admin", "SUPERADMIN");
  setRole("r-op", "OP");
  setRole("r-bu", "BU_HEAD");
  setRole("r-mem", "MEMBER");
  assert.deepEqual(await buildAccessibleProjectWhere("u1", "r-admin"), {}, "SUPERADMIN: no filter");
  assert.deepEqual(await buildAccessibleProjectWhere("u1", "r-op"), {}, "OP: no filter");
  assert.deepEqual(await buildAccessibleProjectWhere("u1", "r-bu"), {
    OR: [{ ownerId: "u1" }, { projectMembers: { some: { userId: "u1" } } }, { businessUnit: "bu1" }],
  }, "BU_HEAD: own, member, and their business unit");
  assert.deepEqual(await buildAccessibleProjectWhere("u2", "r-bu"), {
    OR: [{ ownerId: "u2" }, { projectMembers: { some: { userId: "u2" } } }, { businessUnit: "__NO_ACCESSIBLE_BUSINESS_UNIT__" }],
  }, "a BU head without a business unit sees nothing extra");
  assert.deepEqual(await buildAccessibleProjectWhere("u1", "r-mem"), {
    OR: [{ ownerId: "u1" }, { projectMembers: { some: { userId: "u1" } } }],
  }, "anyone else: own and member only");
  assert.deepEqual(await buildAccessibleProjectWhere("u1", "r-missing"), {
    OR: [{ ownerId: "u1" }, { projectMembers: { some: { userId: "u1" } } }],
  }, "an unknown role gets the most careful answer");

  // --- once a role is configured, its saved settings decide ---
  const noDraft = ALL_STATUSES.filter((s) => s !== "DRAFT").map(statusKey);
  setRole("r-op", "OP", [META_CONFIGURED, SCOPE_ALL, SCOPE_BUSINESS_UNIT, ...noDraft]);
  const opWhere: any = await buildAccessibleProjectWhere("u1", "r-op");
  assert.equal(opWhere.OR.length, 3);
  assert.ok(!JSON.stringify(opWhere).includes("\"DRAFT\""), "OP no longer sees drafts once Draft is unticked");
  assert.ok(JSON.stringify(opWhere).includes("\"ACTIVE\""), "...but still sees the other statuses");
  assert.ok(JSON.stringify(opWhere.OR[0]).includes("u1"), "...and always their own projects, in any status");
  setRole("r-op", "OP", [META_CONFIGURED]); // everything unticked
  assert.deepEqual(await buildAccessibleProjectWhere("u1", "r-op"), {
    OR: [{ ownerId: "u1" }, { projectMembers: { some: { userId: "u1" } } }],
  }, "a configured role with nothing ticked sees only its own projects (not the defaults)");
  setRole("r-op", "OP", [META_CONFIGURED, SCOPE_BUSINESS_UNIT, ...noDraft]);
  const buScoped: any = await buildAccessibleProjectWhere("u1", "r-op");
  assert.equal(buScoped.OR[2].businessUnit, "bu1");
  assert.deepEqual(buScoped.OR[2].status.in.includes("DRAFT"), false, "status limits apply to the business unit scope too");

  // --- the view for the Settings screen ---
  setRole("r-bu", "BU_HEAD");
  const unsynced = await getRoleView("r-bu");
  assert.equal(unsynced.configured, false, "not synced yet");
  assert.ok(unsynced.keys.includes(SCOPE_OWN) && unsynced.keys.includes(SCOPE_BUSINESS_UNIT), "shows the defaults meanwhile");
  await rejects(() => getRoleView("nope"), 404, "ROLE_NOT_FOUND");

  // --- saving: validation ---
  const admin = { id: "admin-user", roleId: "r-admin" };
  setRole("r-admin", "SUPERADMIN");
  setRole("r-op", "OP");
  await rejects(() => setRoleProjectAccess("r-mem", "scope.all", admin), 400, "VALIDATION_ERROR");
  await rejects(() => setRoleProjectAccess("r-mem", ["scope.galaxy"], admin), 400, "UNKNOWN_KEY");
  await rejects(() => setRoleProjectAccess("r-mem", ["status.NOT_A_STATUS"], admin), 400, "UNKNOWN_KEY");
  await rejects(() => setRoleProjectAccess("nope", [], admin), 404, "ROLE_NOT_FOUND");

  // --- saving: only differences are written, the marker is added, and it is audited ---
  setRole("r-mem", "MEMBER");
  writes.removed.length = 0; writes.added.length = 0; audit.length = 0;
  const saved = await setRoleProjectAccess("r-mem", [SCOPE_OWN, SCOPE_ALL, statusKey("ACTIVE")], admin);
  assert.equal(saved.configured, true);
  // The "can open" statuses are hidden in Settings: whatever is sent for them is ignored and all are saved ticked.
  assert.deepEqual(
    saved.keys.sort(),
    [SCOPE_OWN, SCOPE_ALL, SCOPE_BUSINESS_UNIT, ...ALL_STATUSES.map(statusKey)].sort(),
    "All projects brings the business unit with it, and every status stays allowed even though only Active was sent",
  );
  assert.ok(writes.added.includes(META_CONFIGURED), "the role is now marked configured");
  assert.ok(writes.added.includes(META_LIST_CONFIGURED), "and its Projects page statuses are now deliberate");
  assert.deepEqual(writes.removed, [], "nothing to remove from a role with no stored rows");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].entityType, "ROLE_PROJECT_ACCESS");
  assert.equal(audit[0].action, "PROJECT_ACCESS_UPDATED");
  assert.equal(audit[0].userId, admin.id);
  assert.equal(audit[0].metadata.wasConfigured, false);
  // the new setting is live at once (cache cleared), and later saves touch only what changed
  assert.deepEqual(await buildAccessibleProjectWhere("u1", "r-mem"), {}, "All projects with every status needs no filter");
  writes.removed.length = 0; writes.added.length = 0;
  await setRoleProjectAccess("r-mem", [SCOPE_ALL, listStatusKey("DRAFT")], admin);
  assert.deepEqual(writes.added, [listStatusKey("DRAFT")], "only the new Projects page status is written");
  assert.deepEqual(writes.removed, [], "the hidden statuses are untouched");
  writes.removed.length = 0; writes.added.length = 0;
  await setRoleProjectAccess("r-mem", [SCOPE_ALL], admin);
  assert.deepEqual(writes.removed, [listStatusKey("DRAFT")]);
  assert.deepEqual(writes.added, []);
  // sending hidden status keys, or leaving them out, changes nothing: they are always all ticked
  writes.removed.length = 0; writes.added.length = 0;
  await setRoleProjectAccess("r-mem", [SCOPE_ALL, statusKey("DRAFT")], admin);
  assert.deepEqual([writes.added, writes.removed], [[], []], "hidden keys are not something an admin can change");
  assert.equal(resolveConfig((await getRoleView("r-mem")).keys).allStatuses, true);
  assert.equal(buildDefinitions().find((g) => g.id === "status")?.hidden, true, "the group is hidden from the screen");
  assert.ok(!buildDefinitions().filter((g) => !g.hidden).some((g) => g.id === "status"));

  // --- saving: nobody can be locked out ---
  setRole("r-admin", "SUPERADMIN", [META_CONFIGURED, SCOPE_ALL, SCOPE_BUSINESS_UNIT, ...ALL_STATUSES.map(statusKey)]);
  setRole("r-op", "OP", [META_CONFIGURED, ...ALL_STATUSES.map(statusKey)]); // OP no longer sees all
  setRole("r-mem", "MEMBER");
  await rejects(() => setRoleProjectAccess("r-admin", [statusKey("ACTIVE")], admin), 400, "SELF_LOCKOUT");
  const otherAdmin = { id: "someone", roleId: "r-mem" };
  await rejects(() => setRoleProjectAccess("r-admin", [statusKey("ACTIVE")], otherAdmin), 400, "LAST_ALL_PROJECTS");
  // with a second role that keeps all projects, removing it from this one is fine
  setRole("r-op", "OP", [META_CONFIGURED, SCOPE_ALL, SCOPE_BUSINESS_UNIT, ...ALL_STATUSES.map(statusKey)]);
  await setRoleProjectAccess("r-admin", [statusKey("ACTIVE")], otherAdmin);

  // --- Sync button: back to the defaults, audited, and it does not touch other roles ---
  setRole("r-bu", "BU_HEAD", [META_CONFIGURED, SCOPE_ALL, SCOPE_BUSINESS_UNIT]);
  setRole("r-op", "OP", [META_CONFIGURED, SCOPE_ALL, SCOPE_BUSINESS_UNIT, ...ALL_STATUSES.map(statusKey)]);
  audit.length = 0;
  const synced = await syncRoleProjectAccess("r-bu", admin);
  assert.equal(synced.configured, true);
  assert.ok(synced.keys.includes(SCOPE_BUSINESS_UNIT) && !synced.keys.includes(SCOPE_ALL), "BU_HEAD is back to its business unit");
  assert.ok(ALL_STATUSES.every((s) => synced.keys.includes(statusKey(s))), "every status is allowed again");
  assert.equal(audit[0].action, "PROJECT_ACCESS_SYNCED");
  assert.ok(roles["r-op"].keys.includes(SCOPE_ALL), "other roles are untouched");
  await rejects(() => syncRoleProjectAccess("nope", admin), 404, "ROLE_NOT_FOUND");

  // --- Projects page statuses: roles saved before they existed keep the defaults; once saved, what is ticked wins ---
  const allStatusKeys = ALL_STATUSES.map(statusKey);
  setRole("r-legacy", "OP", [META_CONFIGURED, SCOPE_ALL, SCOPE_BUSINESS_UNIT, ...allStatusKeys]);
  assert.deepEqual((await getMyProjectAccess("r-legacy")).listStatuses, ["ACTIVE"], "a role saved earlier still lists only Active, nothing disappears");
  assert.equal((await getMyProjectAccess("r-legacy")).listAllStatuses, false);
  await setRoleProjectAccess("r-legacy", [SCOPE_ALL, listStatusKey("DRAFT"), listStatusKey("ACTIVE")], admin);
  assert.deepEqual((await getMyProjectAccess("r-legacy")).listStatuses, ["DRAFT", "ACTIVE"], "what was ticked is kept");
  await setRoleProjectAccess("r-legacy", [SCOPE_ALL], admin);
  assert.deepEqual((await getMyProjectAccess("r-legacy")).listStatuses, [], "ticking none really lists none, it does not fall back");
  await setRoleProjectAccess("r-legacy", [SCOPE_ALL, ...ALL_STATUSES.map(listStatusKey)], admin);
  assert.equal((await getMyProjectAccess("r-legacy")).listAllStatuses, true, "every status ticked needs no filter");
  await rejects(() => setRoleProjectAccess("r-legacy", ["list.status.NOT_A_STATUS"], admin), 400, "UNKNOWN_KEY");
  setRole("r-never", "MEMBER");
  assert.deepEqual((await getMyProjectAccess("r-never")).listStatuses, ["ACTIVE"], "a role that was never synced lists only Active");
  assert.ok(!(await getRoleView("r-never")).configured);

  console.log("project access tests passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
