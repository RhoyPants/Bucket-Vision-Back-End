import prisma from "../../config/prisma";
import { buildAccessibleProjectWhere } from "../project/project-access";

export class DiscussionApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Viscussion access is exactly project access, the same rule the project dashboard uses:
 * SUPERADMIN and OP see every project, a BU_HEAD sees the projects of their business unit,
 * everyone else needs to be the owner or a member. Anyone who can open the dashboard can take
 * part, and nobody else (approvers included) gets in through Viscussion alone.
 */
export async function canAccessProjectDiscussions(
  projectId: string,
  userId: string,
  roleId: string,
): Promise<boolean> {
  const accessWhere = await buildAccessibleProjectWhere(userId, roleId);
  const project = await prisma.project.findFirst({
    where: { AND: [{ id: projectId, deletedAt: null }, accessWhere] },
    select: { id: true },
  });
  return Boolean(project);
}

export async function assertProjectDiscussionAccess(projectId: string, user: { id: string; roleId: string }) {
  if (!(await canAccessProjectDiscussions(projectId, user.id, user.roleId))) {
    throw new DiscussionApiError(403, "DISCUSSION_ACCESS_DENIED", "Project not found or access denied");
  }
}

/**
 * Owner or co-owner of the project: the people who manage it (the same rule that decides who may edit
 * the project). They may pin threads and remove other people's attachments.
 */
export async function isProjectManager(projectId: string, userId: string): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { ownerId: true, projectMembers: { where: { userId }, select: { role: true } } },
  });
  if (!project) return false;
  return project.ownerId === userId || project.projectMembers.some((m) => m.role === "CO_OWNER" || m.role === "OWNER");
}
