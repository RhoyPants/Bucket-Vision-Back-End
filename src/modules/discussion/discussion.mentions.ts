import prisma from "../../config/prisma";
import { loadAllRoleConfigs } from "../project-access/project-access.service";

/**
 * Mentions are stored in the text as `@[Display Name](user-id)` and rendered by the UI as @Display Name.
 * The `DiscussionMention` table records who was mentioned (and when) so it can feed their inbox.
 */
const MENTION_TOKEN = /@\[([^\]\r\n]{1,80})\]\(([0-9a-fA-F-]{36}|owner|member)\)/g;

/**
 * Two group mentions sit next to the people: `@owner` (the project owner and co-owners) and `@member`
 * (everyone on the project team). They are stored as tokens like a person, with the group name as the id,
 * and are turned into the real people when the post or reply is saved.
 */
export const GROUP_OWNER = "owner";
export const GROUP_MEMBER = "member";

export function extractMentionIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION_TOKEN)) ids.add(match[2].toLowerCase());
  return Array.from(ids);
}

/** `@[Maria](id)` becomes `@Maria`, for previews, titles and inbox snippets. */
export function stripMentions(text: string): string {
  return text.replace(MENTION_TOKEN, "@$1");
}

/**
 * People who may be @mentioned = people who have access to the project (see canAccessProjectDiscussions):
 * the owner, the members, and anyone whose role's Project Access settings let them see this project
 * (all projects, or their business unit's, for a status they are allowed to see). Only active users.
 * Approvers are not included unless they are also members.
 */
async function candidateUsers(projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { ownerId: true, businessUnit: true, status: true, projectMembers: { select: { userId: true } } },
  });
  if (!project) return [];
  const memberIds = [project.ownerId, ...project.projectMembers.map((m) => m.userId)];

  const configs = await loadAllRoleConfigs();
  const sees = (c: { allStatuses: boolean; statuses: string[] }) => c.allStatuses || c.statuses.includes(project.status);
  const allRoleIds = Array.from(configs).filter(([, c]) => c.scopeAll && sees(c)).map(([id]) => id);
  const buRoleIds = Array.from(configs).filter(([, c]) => c.scopeBusinessUnit && sees(c)).map(([id]) => id);

  return prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { id: { in: memberIds } },
        ...(allRoleIds.length ? [{ roleId: { in: allRoleIds } }] : []),
        ...(project.businessUnit && buRoleIds.length
          ? [{ businessUnitId: project.businessUnit, roleId: { in: buRoleIds } }]
          : []),
      ],
    },
    select: { id: true, name: true, position: true },
    orderBy: { name: "asc" },
    take: 300,
  });
}

/** People that can be @mentioned in this project, with the two groups first. */
export async function listMentionCandidates(projectId: string) {
  const users = await candidateUsers(projectId);
  return [
    { id: GROUP_OWNER, name: GROUP_OWNER, position: "Project owner and co-owners" },
    { id: GROUP_MEMBER, name: GROUP_MEMBER, position: "Everyone on the project team" },
    ...users.map((u) => ({ id: u.id, name: u.name, position: u.position ?? null })),
  ];
}

/** Who a group means in this project. */
async function groupMemberIds(projectId: string, group: string): Promise<string[]> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { ownerId: true, projectMembers: { select: { userId: true, role: true } } },
  });
  if (!project) return [];
  if (group === GROUP_OWNER) {
    return [project.ownerId, ...project.projectMembers.filter((m) => m.role === "OWNER" || m.role === "CO_OWNER").map((m) => m.userId)];
  }
  return project.projectMembers.map((m) => m.userId);
}

/** Mentioned ids that belong to people with access to the project, never the author themself. */
export async function resolveMentions(projectId: string, text: string, authorId: string): Promise<string[]> {
  const tokens = extractMentionIds(text);
  // A group becomes the people in it; everyone is then checked against who can see the project.
  const wanted = new Set<string>();
  for (const id of tokens) {
    if (id === GROUP_OWNER || id === GROUP_MEMBER) {
      for (const userId of await groupMemberIds(projectId, id)) wanted.add(userId.toLowerCase());
    } else {
      wanted.add(id);
    }
  }
  wanted.delete(authorId.toLowerCase());
  if (!wanted.size) return [];
  const allowed = new Map((await candidateUsers(projectId)).map((u) => [u.id.toLowerCase(), u.id]));
  return Array.from(wanted).map((id) => allowed.get(id)).filter((id): id is string => Boolean(id));
}

/**
 * Records mentions found in a post (replyId null) or a reply. Only adds: a person who
 * was mentioned once stays mentioned even if the text is edited later.
 */
export async function recordMentions(args: {
  projectId: string;
  discussionId: string;
  replyId: string | null;
  text: string;
  authorId: string;
}) {
  const ids = await resolveMentions(args.projectId, args.text, args.authorId);
  if (!ids.length) return [];
  const existing = await prisma.discussionMention.findMany({
    where: { discussionId: args.discussionId, replyId: args.replyId, userId: { in: ids } },
    select: { userId: true },
  });
  const have = new Set(existing.map((m) => m.userId));
  const fresh = ids.filter((id) => !have.has(id));
  if (fresh.length) {
    await prisma.discussionMention.createMany({
      data: fresh.map((userId) => ({ discussionId: args.discussionId, replyId: args.replyId, userId })),
    });
  }
  return fresh;
}
