/**
 * Read-only check: for every active user and every project in the database, compare which projects
 * they could see under the OLD hard-coded rules with what the configurable Project Access rules give.
 *
 *   npm run parity:project-access
 *
 * Nothing is written. Roles that were never synced use the defaults, which must reproduce the old
 * behaviour, so the only expected differences are extra projects (never fewer) for BU_HEAD users who
 * own or belong to a project outside their business unit: the dashboard already allowed that, the
 * project lists did not.
 */
import { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { buildAccessibleProjectWhere } from "../project/project-access";

/** The rules exactly as they were hard-coded before. */
function legacyWhere(role: string, userId: string, businessUnitId: string | null): Prisma.ProjectWhereInput {
  if (role === "SUPERADMIN" || role === "OP") return {};
  if (role === "BU_HEAD") return { businessUnit: businessUnitId || "__NO_ACCESSIBLE_BUSINESS_UNIT__" };
  return { OR: [{ ownerId: userId }, { projectMembers: { some: { userId } } }] };
}

async function main() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, roleId: true, businessUnitId: true, role: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const projectCount = await prisma.project.count();
  let mismatches = 0;
  let extras = 0;

  console.log(`${users.length} active users, ${projectCount} projects\n`);
  for (const user of users) {
    const [oldRows, newRows] = await Promise.all([
      prisma.project.findMany({ where: legacyWhere(user.role.name, user.id, user.businessUnitId), select: { id: true } }),
      prisma.project.findMany({ where: await buildAccessibleProjectWhere(user.id, user.roleId), select: { id: true } }),
    ]);
    const before = new Set(oldRows.map((p) => p.id));
    const after = new Set(newRows.map((p) => p.id));
    const lost = [...before].filter((id) => !after.has(id));
    const gained = [...after].filter((id) => !before.has(id));
    const verdict = lost.length ? "LOST ACCESS" : gained.length ? "gains" : "same";
    if (lost.length) mismatches += 1;
    extras += gained.length;
    console.log(
      `${verdict.padEnd(11)} ${user.role.name.padEnd(11)} ${String(user.name).padEnd(28)} before=${before.size} after=${after.size}` +
        (lost.length ? `  lost=${lost.length}` : "") + (gained.length ? `  gained=${gained.length}` : ""),
    );
  }
  console.log(`\n${mismatches === 0 ? "PASS" : "FAIL"}: ${mismatches} user(s) lost access; ${extras} extra project(s) gained in total.`);
  await prisma.$disconnect();
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
