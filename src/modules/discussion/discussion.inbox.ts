import prisma from "../../config/prisma";
import { canAccessProjectDiscussions } from "./discussion.access";
import { stripMentions } from "./discussion.mentions";

export type InboxUser = { id: string; roleId: string };

type ThreadFacts = {
  authorId: string;
  createdAt: Date;
  /** When this user last opened the thread, if ever. */
  lastReadAt: Date | null;
  replies: { id: string; authorId: string; createdAt: Date }[];
  mentions: { replyId: string | null; createdAt: Date }[];
};

const SNIPPET_LENGTH = 120;
const MAX_THREADS = 300;
const authorSelect = { id: true, name: true } as const;

const time = (d: Date | null | undefined) => (d ? d.getTime() : 0);

/**
 * What is new for a user in one thread.
 *
 * A thread matters to you if you started it, replied in it, or were @mentioned in it.
 * New = replies by other people since you last looked (your own post or reply, or the
 * moment you opened it, counts as looking), plus mentions of you since then. A mention
 * inside a reply that is already counted as new is not counted twice.
 */
export function computeUnreadFor(userId: string, t: ThreadFacts): { relevant: boolean; unreadCount: number } {
  const mine = t.replies.filter((r) => r.authorId === userId);
  const participating = t.authorId === userId || mine.length > 0;
  const relevant = participating || t.mentions.length > 0;
  if (!relevant) return { relevant: false, unreadCount: 0 };

  const myLastReply = Math.max(0, ...mine.map((r) => time(r.createdAt)));
  const readMark = Math.max(time(t.lastReadAt), myLastReply);
  const replyBaseline = Math.max(readMark, t.authorId === userId ? time(t.createdAt) : 0);

  const newReplyIds = new Set<string>();
  if (participating) {
    for (const r of t.replies) {
      if (r.authorId !== userId && time(r.createdAt) > replyBaseline) newReplyIds.add(r.id);
    }
  }
  const extraMentions = t.mentions.filter(
    (m) => time(m.createdAt) > readMark && (m.replyId === null || !newReplyIds.has(m.replyId)),
  );
  return { relevant: true, unreadCount: newReplyIds.size + extraMentions.length };
}

/** Unread counts for a page of threads (used by the list inside a project). */
export async function unreadCountsFor(user: InboxUser, discussionIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!discussionIds.length) return result;
  const rows = await prisma.discussion.findMany({
    where: { id: { in: discussionIds } },
    select: {
      id: true,
      authorId: true,
      createdAt: true,
      replies: { where: { deletedAt: null }, select: { id: true, authorId: true, createdAt: true } },
      mentions: { where: { userId: user.id, OR: [{ replyId: null }, { reply: { deletedAt: null } }] }, select: { replyId: true, createdAt: true } },
      reads: { where: { userId: user.id }, select: { lastReadAt: true } },
    },
  });
  for (const d of rows) {
    result.set(d.id, computeUnreadFor(user.id, { ...d, lastReadAt: d.reads[0]?.lastReadAt ?? null }).unreadCount);
  }
  return result;
}

/** Marks a thread as read now (opening it counts as reading it). */
export async function markRead(userId: string, discussionId: string) {
  const now = new Date();
  await prisma.discussionRead.upsert({
    where: { userId_discussionId: { userId, discussionId } },
    create: { userId, discussionId, lastReadAt: now },
    update: { lastReadAt: now },
  });
}

export type InboxThread = {
  id: string;
  projectId: string;
  projectName: string;
  unreadCount: number;
  lastActivityAt: Date;
  /** Latest thing from someone else (a reply or the post itself), as a short line. */
  snippet: { authorName: string; text: string; kind: "reply" | "mention" | "post"; byMe: boolean };
};

const short = (text: string) => {
  const clean = stripMentions(text).replace(/\s+/g, " ").trim();
  if (!clean) return "Sent an attachment";
  return clean.length > SNIPPET_LENGTH ? `${clean.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…` : clean;
};

/** Every thread that matters to the user, across all projects they can still access. */
export async function loadInboxThreads(user: InboxUser, opts: { projectId?: string } = {}): Promise<InboxThread[]> {
  const rows = await prisma.discussion.findMany({
    where: {
      deletedAt: null,
      project: { deletedAt: null },
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      OR: [
        { authorId: user.id },
        { replies: { some: { authorId: user.id, deletedAt: null } } },
        { mentions: { some: { userId: user.id, OR: [{ replyId: null }, { reply: { deletedAt: null } }] } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_THREADS,
    select: {
      id: true,
      projectId: true,
      body: true,
      createdAt: true,
      authorId: true,
      author: { select: authorSelect },
      project: { select: { name: true } },
      replies: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, authorId: true, body: true, createdAt: true, author: { select: authorSelect } },
      },
      mentions: { where: { userId: user.id, OR: [{ replyId: null }, { reply: { deletedAt: null } }] }, select: { replyId: true, createdAt: true } },
      reads: { where: { userId: user.id }, select: { lastReadAt: true } },
    },
  });

  // Access can be lost after the fact (removed from the project), so check each project once.
  const access = new Map<string, boolean>();
  for (const projectId of new Set(rows.map((r) => r.projectId))) {
    access.set(projectId, await canAccessProjectDiscussions(projectId, user.id, user.roleId));
  }

  const threads: InboxThread[] = [];
  for (const d of rows) {
    if (!access.get(d.projectId)) continue;
    const { unreadCount } = computeUnreadFor(user.id, { ...d, lastReadAt: d.reads[0]?.lastReadAt ?? null });
    const lastReply = d.replies[d.replies.length - 1];
    const lastOther = [...d.replies].reverse().find((r) => r.authorId !== user.id);
    const mentionedInLast = Boolean(lastOther && d.mentions.some((m) => m.replyId === lastOther.id));
    threads.push({
      id: d.id,
      projectId: d.projectId,
      projectName: d.project.name,
      unreadCount,
      lastActivityAt: lastReply?.createdAt ?? d.createdAt,
      snippet: lastOther
        ? { authorName: lastOther.author.name, text: short(lastOther.body), kind: mentionedInLast ? "mention" : "reply", byMe: false }
        : { authorName: d.author.name, text: short(d.body), kind: "post", byMe: d.authorId === user.id },
    });
  }
  return threads;
}

export type InboxProject = {
  projectId: string;
  projectName: string;
  unreadCount: number;
  unreadThreads: number;
  lastActivityAt: Date;
  lastSnippet: InboxThread["snippet"];
};

/** Per-project roll-up for the header icon: totals, and the project list with what is new. */
export async function loadInboxSummary(user: InboxUser) {
  const threads = await loadInboxThreads(user);
  const byProject = new Map<string, InboxProject>();
  for (const t of threads) {
    const current = byProject.get(t.projectId);
    if (!current) {
      byProject.set(t.projectId, {
        projectId: t.projectId,
        projectName: t.projectName,
        unreadCount: t.unreadCount,
        unreadThreads: t.unreadCount > 0 ? 1 : 0,
        lastActivityAt: t.lastActivityAt,
        lastSnippet: t.snippet,
      });
      continue;
    }
    current.unreadCount += t.unreadCount;
    if (t.unreadCount > 0) current.unreadThreads += 1;
    if (t.lastActivityAt > current.lastActivityAt) {
      current.lastActivityAt = t.lastActivityAt;
      current.lastSnippet = t.snippet;
    }
  }
  const projects = Array.from(byProject.values()).sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  return { totalUnread: projects.reduce((n, p) => n + p.unreadCount, 0), projects };
}
