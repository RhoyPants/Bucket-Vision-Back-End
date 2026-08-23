import { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";

export async function buildAccessibleProjectWhere(
  userId: string,
  roleId: string,
): Promise<Prisma.ProjectWhereInput> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { name: true },
  });
  if (["SUPERADMIN", "OP"].includes(role?.name || "")) return {};
  if (role?.name === "BU_HEAD") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { businessUnitId: true },
    });
    return { businessUnit: user?.businessUnitId || "__NO_ACCESSIBLE_BUSINESS_UNIT__" };
  }
  return {
    OR: [{ ownerId: userId }, { projectMembers: { some: { userId } } }],
  };
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
  if (approvalAccess) return true;

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
