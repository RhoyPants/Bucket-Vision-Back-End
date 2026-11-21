import { DiscussionStatus, Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { assertProjectDiscussionAccess, DiscussionApiError, isProjectManager } from "./discussion.access";
import { attachmentSelect, cleanAttachments, mapAttachment } from "./discussion.attachments";
import { deleteManagedAsset } from "../../services/s3-assets.service";
import { markRead, unreadCountsFor } from "./discussion.inbox";
import { listMentionCandidates, recordMentions, stripMentions } from "./discussion.mentions";

export type DiscussionUser = { id: string; roleId: string };

const TITLE_MAX = 200;
const BODY_MAX = 10000;
const MAX_TAGS = 20;
const PREVIEW_LENGTH = 800; // long enough for "See more" in the list to show most captions in full
const MAX_PINNED = 3;
const STATUSES: DiscussionStatus[] = ["OPEN", "RESOLVED", "CLOSED"];

const bad = (message: string, code = "VALIDATION_ERROR") => new DiscussionApiError(400, code, message);
const notFound = (what = "Discussion") => new DiscussionApiError(404, "NOT_FOUND", `${what} not found`);
const forbidden = (message: string) => new DiscussionApiError(403, "FORBIDDEN", message);

export function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw bad(`${field} is required`);
  const text = value.trim();
  if (text.length > max) throw bad(`${field} must be at most ${max} characters`);
  return text;
}

/**
 * The UI is caption-only, but the `title` column stays (search, old rows, list previews).
 * When no title is sent it is derived from the start of the caption.
 */
export function deriveTitle(caption: string): string {
  const firstLine = caption.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? caption.trim();
  return firstLine.length > 120 ? `${firstLine.slice(0, 117).trimEnd()}…` : firstLine;
}

export function cleanIds(value: unknown, field = "subtaskIds"): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v)) {
    throw bad(`${field} must be an array of ids`);
  }
  const ids = Array.from(new Set(value as string[]));
  if (ids.length > MAX_TAGS) throw bad(`You can tag at most ${MAX_TAGS} subtasks`);
  return ids;
}

export function parseStatus(value: unknown): DiscussionStatus {
  if (typeof value !== "string" || !STATUSES.includes(value as DiscussionStatus)) {
    throw bad(`status must be one of ${STATUSES.join(", ")}`);
  }
  return value as DiscussionStatus;
}

/** Every tagged subtask must belong to the SAME project and not be deleted. */
export async function assertSubtasksInProject(projectId: string, subtaskIds: string[]) {
  if (!subtaskIds.length) return;
  const found = await prisma.subtask.findMany({
    where: {
      id: { in: subtaskIds },
      deletedAt: null,
      task: { deletedAt: null, scope: { projectId, deletedAt: null } },
    },
    select: { id: true },
  });
  if (found.length !== subtaskIds.length) {
    throw bad("One or more tagged subtasks do not belong to this project", "INVALID_SUBTASK_TAG");
  }
}

const authorSelect = { id: true, name: true } as const;

function likeInfo(entity: { _count?: { likes: number }; likes?: { id: string }[] }) {
  return { likeCount: entity._count?.likes ?? 0, likedByMe: (entity.likes?.length ?? 0) > 0 };
}

/** List previews show mentions as plain "@Name" and never cut a mention token in half. */
function previewOf(body: string) {
  const plain = stripMentions(body);
  return plain.length > PREVIEW_LENGTH ? `${plain.slice(0, PREVIEW_LENGTH)}…` : plain;
}

function mapListItem(d: any, userId: string) {
  return {
    id: d.id,
    projectId: d.projectId,
    title: d.title,
    preview: previewOf(d.body),
    status: d.status,
    author: d.author,
    isMine: d.authorId === userId,
    subtasks: d.subtasks.map((s: any) => ({ id: s.subtask.id, title: s.subtask.title })),
    ...likeInfo(d),
    replyCount: d._count.replies,
    attachmentCount: d._count.attachments ?? 0,
    // A few of them, so the list can show a preview like a feed does.
    attachments: (d.attachments ?? []).map((a: any) => mapAttachment(a, userId, false)),
    isPinned: Boolean(d.pinnedAt),
    pinnedAt: d.pinnedAt ?? null,
    lastReply: d.replies?.[0] ? { author: d.replies[0].author, createdAt: d.replies[0].createdAt } : null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    editedAt: d.editedAt,
  };
}

async function loadDiscussion(projectId: string, discussionId: string) {
  const d = await prisma.discussion.findFirst({
    where: { id: discussionId, projectId, deletedAt: null },
    select: { id: true, authorId: true, status: true },
  });
  if (!d) throw notFound();
  return d;
}

export const discussionService = {
  async list(projectId: string, user: DiscussionUser, query: Record<string, any>) {
    await assertProjectDiscussionAccess(projectId, user);
    const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));

    const where: Prisma.DiscussionWhereInput = { projectId, deletedAt: null };
    if (query.status) where.status = parseStatus(String(query.status).toUpperCase());
    if (query.subtaskId) where.subtasks = { some: { subtaskId: String(query.subtaskId) } };
    if (query.authorId) where.authorId = String(query.authorId);
    if (query.mine === "true" || query.mine === "1") where.authorId = user.id;
    const q = typeof query.q === "string" ? query.q.trim() : "";
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
      ];
    }

    // Default: open threads first, then resolved/closed, each by latest activity.
    const sort = String(query.sort ?? "latest");
    const sortOrder: Prisma.DiscussionOrderByWithRelationInput[] =
      sort === "newest" ? [{ createdAt: "desc" }]
      : sort === "liked" ? [{ likes: { _count: "desc" } }, { updatedAt: "desc" }]
      : [{ status: "asc" }, { updatedAt: "desc" }];
    // Pinned threads stay at the top whatever the sort.
    const orderBy: Prisma.DiscussionOrderByWithRelationInput[] = [{ pinnedAt: { sort: "desc", nulls: "last" } }, ...sortOrder];

    const [total, rows] = await Promise.all([
      prisma.discussion.count({ where }),
      prisma.discussion.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: { select: authorSelect },
          subtasks: { include: { subtask: { select: { id: true, title: true } } } },
          likes: { where: { userId: user.id }, select: { id: true } },
          attachments: { where: { deletedAt: null, replyId: null }, orderBy: { createdAt: "asc" }, take: 6, select: attachmentSelect },
          replies: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, author: { select: authorSelect } } },
          _count: { select: { replies: { where: { deletedAt: null } }, likes: true, attachments: { where: { deletedAt: null, replyId: null } } } },
        },
      }),
    ]);
    const unread = await unreadCountsFor(user, rows.map((d) => d.id));
    return {
      data: rows.map((d) => {
        const unreadCount = unread.get(d.id) ?? 0;
        return { ...mapListItem(d, user.id), unreadCount, unread: unreadCount > 0 };
      }),
      meta: { page, limit, total },
    };
  },

  /** Count of open+resolved threads per subtask, for the "Discuss (n)" buttons. */
  async countsBySubtask(projectId: string, user: DiscussionUser, rawIds: unknown) {
    await assertProjectDiscussionAccess(projectId, user);
    const ids = cleanIds(typeof rawIds === "string" ? rawIds.split(",").filter(Boolean) : rawIds, "subtaskIds");
    if (!ids.length) return {};
    const rows = await prisma.discussionSubtask.groupBy({
      by: ["subtaskId"],
      where: { subtaskId: { in: ids }, discussion: { projectId, deletedAt: null } },
      _count: { _all: true },
    });
    const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const r of rows) counts[r.subtaskId] = r._count._all;
    return counts;
  },

  /** Taggable subtasks of this project, for the tag picker. */
  async subtaskOptions(projectId: string, user: DiscussionUser) {
    await assertProjectDiscussionAccess(projectId, user);
    const rows = await prisma.subtask.findMany({
      where: { deletedAt: null, task: { deletedAt: null, scope: { projectId, deletedAt: null } } },
      select: { id: true, title: true, task: { select: { title: true, scope: { select: { name: true } } } } },
      orderBy: { title: "asc" },
      take: 1000,
    });
    return rows.map((s) => ({ id: s.id, title: s.title, taskTitle: s.task.title, scopeName: s.task.scope.name }));
  },

  async create(projectId: string, user: DiscussionUser, body: Record<string, any>) {
    await assertProjectDiscussionAccess(projectId, user);
    const text = cleanText(body?.body, "body", BODY_MAX);
    const title = body?.title ? cleanText(body.title, "title", TITLE_MAX) : deriveTitle(stripMentions(text));
    const subtaskIds = cleanIds(body?.subtaskIds);
    await assertSubtasksInProject(projectId, subtaskIds);
    const attachments = await cleanAttachments(body?.attachments, projectId);
    const created = await prisma.discussion.create({
      data: {
        projectId,
        authorId: user.id,
        title,
        body: text,
        subtasks: { create: subtaskIds.map((subtaskId) => ({ subtaskId })) },
        attachments: { create: attachments.map((a) => ({ ...a, uploadedById: user.id })) },
      },
      select: { id: true },
    });
    await recordMentions({ projectId, discussionId: created.id, replyId: null, text, authorId: user.id });
    return this.get(projectId, user, created.id);
  },

  async get(projectId: string, user: DiscussionUser, discussionId: string) {
    await assertProjectDiscussionAccess(projectId, user);
    const d = await prisma.discussion.findFirst({
      where: { id: discussionId, projectId, deletedAt: null },
      include: {
        author: { select: authorSelect },
        subtasks: { include: { subtask: { select: { id: true, title: true } } } },
        likes: { where: { userId: user.id }, select: { id: true } },
        _count: { select: { likes: true } },
        attachments: { where: { deletedAt: null, replyId: null }, orderBy: { createdAt: "asc" }, select: attachmentSelect },
        replies: {
          orderBy: { createdAt: "asc" },
          include: {
            author: { select: authorSelect },
            likes: { where: { userId: user.id }, select: { id: true } },
            _count: { select: { likes: true } },
            attachments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: attachmentSelect },
          },
        },
      },
    });
    if (!d) throw notFound();
    const manager = await isProjectManager(projectId, user.id);

    const parentsWithChildren = new Set(d.replies.filter((r) => r.parentReplyId && !r.deletedAt).map((r) => r.parentReplyId));
    const replies = d.replies
      // A deleted reply is kept as a placeholder only if live replies hang under it.
      .filter((r) => !r.deletedAt || parentsWithChildren.has(r.id))
      .map((r) => ({
        id: r.id,
        parentReplyId: r.parentReplyId,
        body: r.deletedAt ? null : r.body,
        deleted: Boolean(r.deletedAt),
        isAnswer: r.isAnswer,
        author: r.deletedAt ? null : r.author,
        isMine: r.authorId === user.id,
        ...likeInfo(r),
        attachments: r.deletedAt ? [] : r.attachments.map((a) => mapAttachment(a, user.id, manager)),
        createdAt: r.createdAt,
        editedAt: r.editedAt,
      }));

    return {
      id: d.id,
      projectId: d.projectId,
      title: d.title,
      body: d.body,
      status: d.status,
      resolvedAt: d.resolvedAt,
      author: d.author,
      isMine: d.authorId === user.id,
      subtasks: d.subtasks.map((s) => ({ id: s.subtask.id, title: s.subtask.title })),
      ...likeInfo(d),
      attachments: d.attachments.map((a) => mapAttachment(a, user.id, manager)),
      isPinned: Boolean(d.pinnedAt),
      pinnedAt: d.pinnedAt,
      // Owner and co-owner of the project may pin threads.
      canPin: manager,
      replies,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      editedAt: d.editedAt,
    };
  },

  /** Author-only: edit title/body and (re)tag subtasks. */
  async update(projectId: string, user: DiscussionUser, discussionId: string, body: Record<string, any>) {
    await assertProjectDiscussionAccess(projectId, user);
    const d = await loadDiscussion(projectId, discussionId);
    if (d.authorId !== user.id) throw forbidden("Only the author can edit this discussion");
    if (d.status === "CLOSED") throw bad("A closed discussion cannot be edited", "DISCUSSION_CLOSED");

    const data: Prisma.DiscussionUpdateInput = { editedAt: new Date() };
    if (body?.body !== undefined) {
      data.body = cleanText(body.body, "body", BODY_MAX);
      data.title = deriveTitle(stripMentions(data.body)); // keep the hidden title in step with the caption
    }
    if (body?.title !== undefined) data.title = cleanText(body.title, "title", TITLE_MAX);
    let subtaskIds: string[] | undefined;
    if (body?.subtaskIds !== undefined) {
      subtaskIds = cleanIds(body.subtaskIds);
      await assertSubtasksInProject(projectId, subtaskIds);
    }
    if (body?.title === undefined && body?.body === undefined && subtaskIds === undefined) {
      throw bad("Nothing to update");
    }
    await prisma.$transaction(async (tx) => {
      await tx.discussion.update({ where: { id: discussionId }, data });
      if (subtaskIds) {
        // Only the tag links are replaced; no discussion/reply content is touched.
        await tx.discussionSubtask.deleteMany({ where: { discussionId } });
        if (subtaskIds.length) {
          await tx.discussionSubtask.createMany({ data: subtaskIds.map((subtaskId) => ({ discussionId, subtaskId })) });
        }
      }
    });
    if (typeof data.body === "string") {
      await recordMentions({ projectId, discussionId, replyId: null, text: data.body, authorId: user.id });
    }
    return this.get(projectId, user, discussionId);
  },

  /** Only the thread creator may change status (Open / Resolved / Closed). */
  async setStatus(projectId: string, user: DiscussionUser, discussionId: string, status: unknown) {
    await assertProjectDiscussionAccess(projectId, user);
    const next = parseStatus(status);
    const d = await loadDiscussion(projectId, discussionId);
    if (d.authorId !== user.id) throw forbidden("Only the author can change the status of this discussion");
    await prisma.discussion.update({
      where: { id: discussionId },
      data: { status: next, resolvedAt: next === "RESOLVED" ? new Date() : null },
    });
    return this.get(projectId, user, discussionId);
  },

  /** Soft delete, author only. */
  async remove(projectId: string, user: DiscussionUser, discussionId: string) {
    await assertProjectDiscussionAccess(projectId, user);
    const d = await loadDiscussion(projectId, discussionId);
    if (d.authorId !== user.id) throw forbidden("Only the author can delete this discussion");
    await prisma.discussion.update({ where: { id: discussionId }, data: { deletedAt: new Date() } });
    return { id: discussionId };
  },

  async addReply(projectId: string, user: DiscussionUser, discussionId: string, body: Record<string, any>) {
    await assertProjectDiscussionAccess(projectId, user);
    const d = await loadDiscussion(projectId, discussionId);
    if (d.status === "CLOSED") throw bad("This discussion is closed", "DISCUSSION_CLOSED");
    const attachments = await cleanAttachments(body?.attachments, projectId);
    // A reply needs words or at least one file.
    const text = attachments.length && !(typeof body?.body === "string" && body.body.trim())
      ? ""
      : cleanText(body?.body, "body", BODY_MAX);
    let parentReplyId: string | null = null;
    if (body?.parentReplyId) {
      const parent = await prisma.discussionReply.findFirst({
        where: { id: String(body.parentReplyId), discussionId, deletedAt: null },
        select: { id: true, parentReplyId: true },
      });
      if (!parent) throw notFound("Parent reply");
      // One level of nesting only: reply-to-a-reply attaches to the top-level reply.
      parentReplyId = parent.parentReplyId ?? parent.id;
    }
    const [reply] = await prisma.$transaction([
      prisma.discussionReply.create({
        data: {
          discussionId,
          authorId: user.id,
          parentReplyId,
          body: text,
          attachments: { create: attachments.map((a) => ({ ...a, discussionId, uploadedById: user.id })) },
        },
        select: { id: true },
      }),
      prisma.discussion.update({ where: { id: discussionId }, data: { updatedAt: new Date() } }),
    ]);
    await recordMentions({ projectId, discussionId, replyId: reply.id, text, authorId: user.id });
    return { id: reply.id };
  },

  async updateReply(projectId: string, user: DiscussionUser, discussionId: string, replyId: string, body: Record<string, any>) {
    await assertProjectDiscussionAccess(projectId, user);
    const d = await loadDiscussion(projectId, discussionId);
    if (d.status === "CLOSED") throw bad("This discussion is closed", "DISCUSSION_CLOSED");
    const reply = await prisma.discussionReply.findFirst({ where: { id: replyId, discussionId, deletedAt: null }, select: { authorId: true } });
    if (!reply) throw notFound("Reply");
    if (reply.authorId !== user.id) throw forbidden("Only the author can edit this reply");
    const text = cleanText(body?.body, "body", BODY_MAX);
    await prisma.discussionReply.update({ where: { id: replyId }, data: { body: text, editedAt: new Date() } });
    await recordMentions({ projectId, discussionId, replyId, text, authorId: user.id });
    return { id: replyId };
  },

  /** Opening a thread marks it read for this user (clears its "new" markers). */
  async markRead(projectId: string, user: DiscussionUser, discussionId: string) {
    await assertProjectDiscussionAccess(projectId, user);
    await loadDiscussion(projectId, discussionId);
    await markRead(user.id, discussionId);
    return { id: discussionId };
  },

  /** People who can be @mentioned in this project. */
  async mentionCandidates(projectId: string, user: DiscussionUser) {
    await assertProjectDiscussionAccess(projectId, user);
    return listMentionCandidates(projectId);
  },

  /** Pin a thread to the top of the list. Owner or co-owner of the project only, and only a few at a time. */
  async pin(projectId: string, user: DiscussionUser, discussionId: string) {
    await assertProjectDiscussionAccess(projectId, user);
    await loadDiscussion(projectId, discussionId);
    if (!(await isProjectManager(projectId, user.id))) {
      throw forbidden("Only the project owner or a co-owner can pin threads");
    }
    const already = await prisma.discussion.findFirst({ where: { id: discussionId, pinnedAt: { not: null } }, select: { id: true } });
    if (!already) {
      const pinned = await prisma.discussion.count({ where: { projectId, deletedAt: null, pinnedAt: { not: null } } });
      if (pinned >= MAX_PINNED) throw bad("You can pin up to " + MAX_PINNED + " threads. Unpin one first.", "PIN_LIMIT");
      await prisma.discussion.update({ where: { id: discussionId }, data: { pinnedAt: new Date(), pinnedById: user.id } });
    }
    return this.get(projectId, user, discussionId);
  },

  async unpin(projectId: string, user: DiscussionUser, discussionId: string) {
    await assertProjectDiscussionAccess(projectId, user);
    await loadDiscussion(projectId, discussionId);
    if (!(await isProjectManager(projectId, user.id))) {
      throw forbidden("Only the project owner or a co-owner can unpin threads");
    }
    await prisma.discussion.update({ where: { id: discussionId }, data: { pinnedAt: null, pinnedById: null } });
    return this.get(projectId, user, discussionId);
  },

  /** Removes an attachment: the row is marked removed and the file is deleted from S3. The person who added it, or a project manager, may. */
  async removeAttachment(projectId: string, user: DiscussionUser, discussionId: string, attachmentId: string) {
    await assertProjectDiscussionAccess(projectId, user);
    await loadDiscussion(projectId, discussionId);
    const attachment = await prisma.discussionAttachment.findFirst({
      where: { id: attachmentId, discussionId, deletedAt: null },
      select: { id: true, uploadedById: true, fileKey: true },
    });
    if (!attachment) throw notFound("Attachment");
    if (attachment.uploadedById !== user.id && !(await isProjectManager(projectId, user.id))) {
      throw forbidden("Only the person who attached this file, or the project owner or a co-owner, can remove it");
    }
    // The row is only marked, so there is a record of what was removed and when.
    await prisma.discussionAttachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date() } });
    // The file itself is deleted from S3 too: once removed it must not stay reachable by its link, and it
    // should not keep taking up space. If S3 refuses, the attachment is still gone from the thread; the
    // failure is logged so the file can be cleaned up by hand.
    try {
      await deleteManagedAsset(attachment.fileKey);
    } catch (error) {
      console.error("[discussions] attachment removed but its S3 object could not be deleted", attachment.fileKey, error instanceof Error ? error.message : error);
    }
    return { id: attachmentId };
  },

  async removeReply(projectId: string, user: DiscussionUser, discussionId: string, replyId: string) {
    await assertProjectDiscussionAccess(projectId, user);
    await loadDiscussion(projectId, discussionId);
    const reply = await prisma.discussionReply.findFirst({ where: { id: replyId, discussionId, deletedAt: null }, select: { authorId: true } });
    if (!reply) throw notFound("Reply");
    if (reply.authorId !== user.id) throw forbidden("Only the author can delete this reply");
    await prisma.discussionReply.update({ where: { id: replyId }, data: { deletedAt: new Date() } });
    return { id: replyId };
  },

  /** Toggle like on a discussion (replyId omitted) or on one of its replies. */
  async toggleLike(projectId: string, user: DiscussionUser, discussionId: string, replyId?: string) {
    await assertProjectDiscussionAccess(projectId, user);
    await loadDiscussion(projectId, discussionId);
    if (replyId) {
      const reply = await prisma.discussionReply.findFirst({ where: { id: replyId, discussionId, deletedAt: null }, select: { id: true } });
      if (!reply) throw notFound("Reply");
    }
    const target = replyId ? { replyId } : { discussionId };
    const existing = await prisma.discussionLike.findFirst({ where: { userId: user.id, ...target }, select: { id: true } });
    if (existing) await prisma.discussionLike.delete({ where: { id: existing.id } });
    else await prisma.discussionLike.create({ data: { userId: user.id, ...target } });
    const likeCount = await prisma.discussionLike.count({ where: target });
    return { liked: !existing, likeCount };
  },

  /** Who liked a discussion (replyId omitted) or one of its replies, newest first. */
  async listLikes(projectId: string, user: DiscussionUser, discussionId: string, replyId?: string) {
    await assertProjectDiscussionAccess(projectId, user);
    await loadDiscussion(projectId, discussionId);
    if (replyId) {
      const reply = await prisma.discussionReply.findFirst({ where: { id: replyId, discussionId, deletedAt: null }, select: { id: true } });
      if (!reply) throw notFound("Reply");
    }
    const likes = await prisma.discussionLike.findMany({
      where: replyId ? { replyId } : { discussionId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { createdAt: true, user: { select: authorSelect } },
    });
    return likes.map((l) => ({ user: l.user, likedAt: l.createdAt }));
  },
};
