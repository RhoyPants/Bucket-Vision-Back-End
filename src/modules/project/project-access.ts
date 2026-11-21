import { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { getRoleProjectAccess } from "../project-access/project-access.service";

const NO_ACCESSIBLE_BUSINESS_UNIT = "__NO_ACCESSIBLE_BUSINESS_UNIT__";

/**
 * The single answer to "which projects can this person see?", used by everything that lists or opens
 * projects. It is driven by the role's Project Access settings (Settings > Roles > Project Access):
 *  - people always see the projects they own or are a member of, in any status;
 *  - `scope.business_unit` adds every project of their business unit;
 *  - `scope.all` adds every project;
 *  - the ticked statuses limit what the two wider scopes show.
 */
export async function buildAccessibleProjectWhere(
  userId: string,
  roleId: string,
): Promise<Prisma.ProjectWhereInput> {
  const access = await getRoleProjectAccess(roleId);
  const statusFilter: Prisma.ProjectWhereInput = access.allStatuses ? {} : { status: { in: access.statuses } };

  // Everything, with no status limit: no filter at all.
  if (access.scopeAll && access.allStatuses) return {};

  const clauses: Prisma.ProjectWhereInput[] = [{ ownerId: userId }, { projectMembers: { some: { userId } } }];
  if (access.scopeAll) {
    clauses.push(statusFilter);
  } else if (access.scopeBusinessUnit) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { businessUnitId: true } });
    clauses.push({ businessUnit: user?.businessUnitId || NO_ACCESSIBLE_BUSINESS_UNIT, ...statusFilter });
  }
  return { OR: clauses };
}

/**
 * True when the person takes part in this project's approval process: a named approver, a user assigned
 * to a step of its approval flow, or someone whose role fills a role-based step. This is workflow, not
 * project visibility, so approvers who are not members can still read the project they must review.
 */
export async function isProjectApprover(projectId: string, userId: string, roleId: string): Promise<boolean> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { name: true },
  });
  const approvalAccess = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [
        { approvals: { some: { approverId: userId } } },
        {
          approvalFlow: {
            steps: {
              some: {
                OR: [
                  { assignedUsers: { some: { userId } } },
                  ...(role?.name ? [{ approverSource: "ROLE", role: role.name }] : []),
                ],
              },
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  return Boolean(approvalAccess);
}

/**
 * Can this person read the project's details? Project Access (the role's settings plus owner/member),
 * or being one of its approvers. Unlike canViewProjectForApproval it does NOT also accept a general
 * "projects READ" role permission, so having the Projects page does not open every project.
 */
export async function canReadProject(projectId: string, userId: string, roleId: string): Promise<boolean> {
  const accessWhere = await buildAccessibleProjectWhere(userId, roleId);
  const accessible = await prisma.project.findFirst({
    where: { AND: [{ id: projectId, deletedAt: null }, accessWhere] },
    select: { id: true },
  });
  if (accessible) return true;
  return isProjectApprover(projectId, userId, roleId);
}

/**
 * Read-only access used by approval views. In addition to normal project access,
 * this includes users participating in the project's approval process and roles
 * granted a project/approval viewing permission.
 */
export async function canViewProjectForApproval(
  projectId: string,
  userId: string,
  roleId: string,
): Promise<boolean> {
  const accessWhere = await buildAccessibleProjectWhere(userId, roleId);
  const normalAccess = await prisma.project.findFirst({
    where: { AND: [{ id: projectId, deletedAt: null }, accessWhere] },
    select: { id: true },
  });
  if (normalAccess) return true;

  if (await isProjectApprover(projectId, userId, roleId)) return true;

  const viewPermission = await prisma.rolePermission.findFirst({
    where: {
      roleId,
      module: {
        isActive: true,
        OR: [
          { name: { equals: "projects", mode: "insensitive" } },
          { name: { equals: "approval_review", mode: "insensitive" } },
        ],
      },
      permission: { action: { in: ["READ", "APPROVE"] } },
    },
    select: { id: true },
  });
  return Boolean(viewPermission);
}
