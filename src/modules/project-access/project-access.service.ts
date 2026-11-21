import prisma from "../../config/prisma";
import {
  LIST_STATUS_PREFIX,
  META_CONFIGURED,
  META_LIST_CONFIGURED,
  SCOPE_ALL,
  SCOPE_OWN,
  defaultKeysForRoleName,
  defaultListKeysForRoleName,
  expandImplied,
  hiddenKeys,
  resolveConfig,
  storableKeys,
  type RoleProjectAccessConfig,
} from "./project-access.keys";

export class ProjectAccessError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type RoleAccess = {
  roleName: string;
  /** True once the role was saved or synced on purpose; otherwise the defaults apply. */
  configured: boolean;
  keys: string[];
  config: RoleProjectAccessConfig;
};

/** A role's effective keys: what was saved, or the defaults while it has not been synced. */
function build(roleName: string, stored: string[]): RoleAccess {
  const configured = stored.includes(META_CONFIGURED);
  let keys = configured ? stored.filter((key) => !key.startsWith("meta.")) : defaultKeysForRoleName(roleName);
  // Roles saved before the Projects page statuses existed have none stored: they use the defaults for
  // that group until they are saved again, so nothing disappears from the Projects page.
  if (configured && !stored.includes(META_LIST_CONFIGURED)) {
    keys = [...keys.filter((key) => !key.startsWith(LIST_STATUS_PREFIX)), ...defaultListKeysForRoleName(roleName)];
  }
  return { roleName, configured, keys, config: resolveConfig(keys) };
}

// Access is asked for on almost every request, so keep each role's answer for a few seconds.
// Saving or syncing a role clears its entry at once; other servers catch up within the TTL.
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: RoleAccess }>();

export function invalidateRoleProjectAccess(roleId?: string) {
  if (roleId) cache.delete(roleId);
  else cache.clear();
}

export async function getRoleAccess(roleId: string): Promise<RoleAccess> {
  const hit = cache.get(roleId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { name: true, projectAccess: { select: { key: true } } },
  });
  // An unknown role gets the most careful answer: only the person's own projects.
  const value = role ? build(role.name, role.projectAccess.map((r) => r.key)) : build("", []);
  cache.set(roleId, { at: Date.now(), value });
  return value;
}

export async function getRoleProjectAccess(roleId: string): Promise<RoleProjectAccessConfig> {
  return (await getRoleAccess(roleId)).config;
}

/** Every role's rules, for places that need to know who could see a project (e.g. @mentions). */
export async function loadAllRoleConfigs(): Promise<Map<string, RoleProjectAccessConfig>> {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, projectAccess: { select: { key: true } } },
  });
  return new Map(roles.map((r) => [r.id, build(r.name, r.projectAccess.map((p) => p.key)).config]));
}

/** The Projects page statuses for the signed-in user's role (what the page lists). */
export async function getMyProjectAccess(roleId: string) {
  const { config } = await getRoleAccess(roleId);
  return { listStatuses: config.listStatuses, listAllStatuses: config.listAllStatuses };
}

/** What the Settings screen shows for a role. `scope.own` is always on and listed for display. */
export async function getRoleView(roleId: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true } });
  if (!role) throw new ProjectAccessError(404, "ROLE_NOT_FOUND", "Role not found");
  const access = await getRoleAccess(roleId);
  return { roleId: role.id, roleName: role.name, configured: access.configured, keys: [SCOPE_OWN, ...access.keys] };
}

type Actor = { id: string; roleId: string };

async function applyKeys(roleId: string, requested: string[], actor: Actor, action: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, name: true, projectAccess: { select: { key: true } } },
  });
  if (!role) throw new ProjectAccessError(404, "ROLE_NOT_FOUND", "Role not found");

  const allowed = storableKeys();
  const wanted = requested.filter((key) => key !== SCOPE_OWN);
  const unknown = wanted.filter((key) => !allowed.has(key));
  if (unknown.length) throw new ProjectAccessError(400, "UNKNOWN_KEY", `Unknown project access setting: ${unknown.join(", ")}`);
  // Hidden groups are not part of what an admin chooses: whatever was sent for them is ignored and
  // all of their keys are saved ticked, so every role keeps the default of "everything allowed".
  const hidden = new Set(hiddenKeys());
  const keys = expandImplied([...wanted.filter((key) => !hidden.has(key)), ...hidden]);

  // Never leave the system without anyone who can see every project, and never let people
  // lock themselves out by removing it from their own role.
  if (!keys.includes(SCOPE_ALL)) {
    const before = build(role.name, role.projectAccess.map((r) => r.key));
    if (actor.roleId === roleId && before.config.scopeAll) {
      throw new ProjectAccessError(400, "SELF_LOCKOUT", "You can't remove \"All projects\" from your own role.");
    }
    const others = Array.from((await loadAllRoleConfigs()).entries()).filter(([id, c]) => id !== roleId && c.scopeAll);
    if (others.length === 0) {
      throw new ProjectAccessError(400, "LAST_ALL_PROJECTS", "At least one role must keep \"All projects\".");
    }
  }

  const stored = role.projectAccess.map((r) => r.key);
  const desired = new Set([...keys, META_CONFIGURED, META_LIST_CONFIGURED]);
  const toAdd = Array.from(desired).filter((key) => !stored.includes(key));
  const toRemove = stored.filter((key) => !desired.has(key));
  const before = build(role.name, stored);

  await prisma.$transaction(async (tx) => {
    // Only the differences are written, so unchanged settings are never touched.
    if (toRemove.length) await tx.roleProjectAccess.deleteMany({ where: { roleId, key: { in: toRemove } } });
    if (toAdd.length) await tx.roleProjectAccess.createMany({ data: toAdd.map((key) => ({ roleId, key })), skipDuplicates: true });
    await tx.activityLog.create({
      data: {
        action,
        entityType: "ROLE_PROJECT_ACCESS",
        entityId: roleId,
        userId: actor.id,
        metadata: { role: role.name, before: before.keys, after: keys, wasConfigured: before.configured },
      },
    });
  });
  invalidateRoleProjectAccess(roleId);
  return getRoleView(roleId);
}

/** Saves the ticked settings for a role. */
export function setRoleProjectAccess(roleId: string, keys: unknown, actor: Actor) {
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
    throw new ProjectAccessError(400, "VALIDATION_ERROR", "keys must be an array of strings");
  }
  return applyKeys(roleId, keys as string[], actor, "PROJECT_ACCESS_UPDATED");
}

/** Sync button: puts a role back on the defaults (how access worked before it was configurable). */
export async function syncRoleProjectAccess(roleId: string, actor: Actor) {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { name: true } });
  if (!role) throw new ProjectAccessError(404, "ROLE_NOT_FOUND", "Role not found");
  return applyKeys(roleId, defaultKeysForRoleName(role.name), actor, "PROJECT_ACCESS_SYNCED");
}
