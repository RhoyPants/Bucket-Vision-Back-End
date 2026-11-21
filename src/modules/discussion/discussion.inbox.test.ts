import assert from "node:assert/strict";
import { computeUnreadFor } from "./discussion.inbox";
import { extractMentionIds, stripMentions } from "./discussion.mentions";

// Pure logic only: no database, no Prisma.
const ME = "u-me";
const OTHER = "u-other";
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 20, 0, minutes));
const facts = (over: Partial<Parameters<typeof computeUnreadFor>[1]> = {}) => ({
  authorId: OTHER,
  createdAt: at(0),
  lastReadAt: null,
  replies: [],
  mentions: [],
  ...over,
});

// --- mentions ---
const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
assert.deepEqual(extractMentionIds(`hi @[Maria Cruz](${id1}) and @[PIC (Project Manager)](${id2}) @[Maria Cruz](${id1})`), [id1, id2]);
assert.deepEqual(extractMentionIds("no mentions, just an @ sign and @[bad](not-an-id)"), []);
assert.equal(stripMentions(`hi @[Maria Cruz](${id1}), please check`), "hi @Maria Cruz, please check");

// --- a thread you have nothing to do with is not relevant ---
assert.deepEqual(computeUnreadFor(ME, facts({ replies: [{ id: "r1", authorId: OTHER, createdAt: at(5) }] })), { relevant: false, unreadCount: 0 });

// --- your own thread: replies by others are new until you open it ---
const mine = facts({ authorId: ME });
assert.equal(computeUnreadFor(ME, mine).unreadCount, 0, "your own fresh post is not new to you");
const withReplies = facts({ authorId: ME, replies: [
  { id: "r1", authorId: OTHER, createdAt: at(5) },
  { id: "r2", authorId: OTHER, createdAt: at(8) },
  { id: "r3", authorId: ME, createdAt: at(9) }, // your own reply never counts
] });
assert.equal(computeUnreadFor(ME, withReplies).unreadCount, 0, "replying yourself means you were looking");
const lateReply = { ...withReplies, replies: [...withReplies.replies, { id: "r4", authorId: OTHER, createdAt: at(12) }] };
assert.equal(computeUnreadFor(ME, lateReply).unreadCount, 1, "only replies after your last activity are new");
assert.equal(computeUnreadFor(ME, { ...lateReply, lastReadAt: at(20) }).unreadCount, 0, "opening the thread clears it");
assert.equal(computeUnreadFor(ME, { ...lateReply, lastReadAt: at(10) }).unreadCount, 1, "read before the late reply");

// --- a thread you replied in counts too ---
const joined = facts({ replies: [
  { id: "r1", authorId: ME, createdAt: at(2) },
  { id: "r2", authorId: OTHER, createdAt: at(4) },
] });
assert.deepEqual(computeUnreadFor(ME, joined), { relevant: true, unreadCount: 1 });

// --- mentions ---
const mentioned = facts({ mentions: [{ replyId: null, createdAt: at(1) }] });
assert.deepEqual(computeUnreadFor(ME, mentioned), { relevant: true, unreadCount: 1 }, "a mention in the post is new");
assert.equal(computeUnreadFor(ME, { ...mentioned, lastReadAt: at(3) }).unreadCount, 0, "opened after the mention");
// mention inside a reply you are already notified about is counted once
const mentionInReply = facts({
  authorId: ME,
  replies: [{ id: "r1", authorId: OTHER, createdAt: at(5) }],
  mentions: [{ replyId: "r1", createdAt: at(5) }],
});
assert.equal(computeUnreadFor(ME, mentionInReply).unreadCount, 1, "reply and mention in it count once");
// mentioned in a reply but not participating otherwise: only the mention counts, not every reply
const onlyMentioned = facts({
  replies: [{ id: "r1", authorId: OTHER, createdAt: at(3) }, { id: "r2", authorId: OTHER, createdAt: at(6) }],
  mentions: [{ replyId: "r2", createdAt: at(6) }],
});
assert.equal(computeUnreadFor(ME, onlyMentioned).unreadCount, 1);

console.log("discussion inbox tests passed");
