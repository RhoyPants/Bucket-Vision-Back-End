process.env.ASSETS_ENV = process.env.ASSETS_ENV || "dev";
import assert from "node:assert/strict";
import prisma from "../../config/prisma";
import { cleanIds, cleanText, deriveTitle, discussionService, parseStatus } from "./discussion.service";
import { canAccessProjectDiscussions } from "./discussion.access";
import { cleanAttachments, mapAttachment } from "./discussion.attachments";
import { listMentionCandidates, resolveMentions } from "./discussion.mentions";

// Prisma is fully mocked: this test never touches a database.
const db = prisma as any;
const me = { id: "u-author", roleId: "r-member" };
const other = { id: "u-other", roleId: "r-member" };

let hasAccess = true;
// A role that was never synced uses the defaults, so MEMBER sees only its own projects.
db.role.findUnique = async () => ({ name: "MEMBER", projectAccess: [] });
// Also shaped like the owner / co-owner lookup (a project owned by someone else, no team), which get() now does.
db.project.findFirst = async () => (hasAccess ? { id: "p1", ownerId: "o1", projectMembers: [] } : null);

async function rejects(fn: () => Promise<unknown>, status: number, code?: string) {
  try {
    await fn();
  } catch (e: any) {
    assert.equal(e.status, status, `expected ${status}, got ${e.status} (${e.message})`);
    if (code) assert.equal(e.code, code);
    return;
  }
  assert.fail("expected the call to reject");
}

async function main() {
  // --- pure validation ---
  assert.equal(cleanText("  hi  ", "title", 10), "hi");
  assert.throws(() => cleanText("", "title", 10));
  assert.throws(() => cleanText("x".repeat(11), "title", 10));
  assert.deepEqual(cleanIds(["a", "a", "b"]), ["a", "b"]);
  assert.deepEqual(cleanIds(undefined), []);
  assert.throws(() => cleanIds("a"));
  assert.throws(() => cleanIds(Array.from({ length: 21 }, (_, i) => `s${i}`)));
  assert.equal(deriveTitle("  First line\nsecond line"), "First line");
  assert.equal(deriveTitle("x".repeat(300)).length, 118);
  assert.ok(deriveTitle("x".repeat(300)).endsWith("…"));
  assert.equal(parseStatus("RESOLVED"), "RESOLVED");
  assert.throws(() => parseStatus("DONE"));

  // --- access: non members are rejected ---
  hasAccess = false;
  await rejects(() => discussionService.list("p1", other, {}), 403, "DISCUSSION_ACCESS_DENIED");
  await rejects(() => discussionService.create("p1", other, { title: "t", body: "b" }), 403);
  hasAccess = true;

  // --- tagging: subtasks from another project are rejected ---
  db.subtask.findMany = async () => [{ id: "s1" }]; // asked for 2, only 1 is in this project
  await rejects(
    () => discussionService.create("p1", me, { title: "t", body: "b", subtaskIds: ["s1", "foreign"] }),
    400,
    "INVALID_SUBTASK_TAG",
  );
  let subtaskQuery: any;
  db.subtask.findMany = async (q: any) => { subtaskQuery = q; return [{ id: "s1" }]; };
  let created: any;
  db.discussion.create = async ({ data }: any) => { created = data; return { id: "d1" }; };
  db.discussion.findFirst = async () => ({
    id: "d1", projectId: "p1", authorId: me.id, status: "OPEN", title: "t", body: "b", resolvedAt: null,
    author: { id: me.id, name: "Me" }, subtasks: [{ subtask: { id: "s1", title: "Sub" } }],
    likes: [], _count: { likes: 0 }, attachments: [], pinnedAt: null, replies: [], createdAt: new Date(), updatedAt: new Date(), editedAt: null,
  });
  const detail: any = await discussionService.create("p1", me, { title: " t ", body: "b", subtaskIds: ["s1"] });
  assert.equal(created.authorId, me.id);
  assert.equal(created.title, "t");
  assert.deepEqual(created.subtasks.create, [{ subtaskId: "s1" }]);
  assert.equal(subtaskQuery.where.task.scope.projectId, "p1", "tag lookup must be scoped to the project");
  assert.equal(detail.isMine, true);

  // caption-only: no title sent, so it is derived from the caption
  await discussionService.create("p1", me, { body: "Anong ulam today?\nPlease reply" });
  assert.equal(created.title, "Anong ulam today?");
  assert.equal(created.body, "Anong ulam today?\nPlease reply");

  // --- status: only the creator may resolve/close/reopen ---
  const thread = { id: "d1", authorId: me.id, status: "OPEN" };
  db.discussion.findFirst = async () => ({ ...thread, projectId: "p1", title: "t", body: "b", resolvedAt: null,
    author: { id: me.id, name: "Me" }, subtasks: [], likes: [], _count: { likes: 0 }, attachments: [], pinnedAt: null, replies: [],
    createdAt: new Date(), updatedAt: new Date(), editedAt: null });
  const upd: { q: any } = { q: null as any as any };
  const lastUpdate = (): any => upd.q;
  db.discussion.update = async (q: any) => { upd.q = q; return {}; };
  await rejects(() => discussionService.setStatus("p1", other, "d1", "RESOLVED"), 403);
  assert.equal(lastUpdate(), null, "non-author must not change status");
  await discussionService.setStatus("p1", me, "d1", "RESOLVED");
  assert.equal(lastUpdate().data.status, "RESOLVED");
  assert.ok(lastUpdate().data.resolvedAt instanceof Date);
  await discussionService.setStatus("p1", me, "d1", "OPEN");
  assert.equal(lastUpdate().data.resolvedAt, null);
  await rejects(() => discussionService.setStatus("p1", me, "d1", "BOGUS"), 400);

  // --- edit / delete are author only; delete is a soft delete ---
  await rejects(() => discussionService.update("p1", other, "d1", { title: "x" }), 403);
  await rejects(() => discussionService.remove("p1", other, "d1"), 403);
  await discussionService.remove("p1", me, "d1");
  assert.ok(lastUpdate().data.deletedAt instanceof Date, "delete must be soft");

  // --- replies ---
  const loaded = (status: string) => { thread.status = status; };
  let replyData: any;
  db.$transaction = async (ops: any[]) => Promise.all(ops);
  db.discussionReply.create = async ({ data }: any) => { replyData = data; return { id: "r-new" }; };
  db.discussionReply.findFirst = async ({ where }: any) =>
    where.id === "top" ? { id: "top", parentReplyId: null }
    : where.id === "child" ? { id: "child", parentReplyId: "top" }
    : null;

  loaded("OPEN");
  await discussionService.addReply("p1", other, "d1", { body: "hello" });
  assert.equal(replyData.parentReplyId, null);
  await discussionService.addReply("p1", other, "d1", { body: "re", parentReplyId: "top" });
  assert.equal(replyData.parentReplyId, "top");
  await discussionService.addReply("p1", other, "d1", { body: "re re", parentReplyId: "child" });
  assert.equal(replyData.parentReplyId, "top", "nesting is limited to one level");
  await rejects(() => discussionService.addReply("p1", other, "d1", { body: "x", parentReplyId: "nope" }), 404);
  await rejects(() => discussionService.addReply("p1", other, "d1", { body: "  " }), 400);
  loaded("CLOSED");
  await rejects(() => discussionService.addReply("p1", other, "d1", { body: "late" }), 400, "DISCUSSION_CLOSED");
  loaded("RESOLVED");
  await discussionService.addReply("p1", other, "d1", { body: "still fine on resolved" });

  // --- likes toggle ---
  let likes: any[] = [];
  db.discussionLike.findFirst = async ({ where }: any) => likes.find((l) => l.userId === where.userId) ?? null;
  db.discussionLike.create = async ({ data }: any) => { likes.push({ id: `l${likes.length}`, ...data }); return {}; };
  db.discussionLike.delete = async ({ where }: any) => { likes = likes.filter((l) => l.id !== where.id); return {}; };
  db.discussionLike.count = async () => likes.length;
  loaded("OPEN");
  assert.deepEqual(await discussionService.toggleLike("p1", other, "d1"), { liked: true, likeCount: 1 });
  assert.deepEqual(await discussionService.toggleLike("p1", other, "d1"), { liked: false, likeCount: 0 });

  // --- who liked ---
  const likerQuery: { q: any } = { q: undefined as any };
  const t1 = new Date("2026-11-20T01:00:00Z");
  db.discussionLike.findMany = async (q: any) => { likerQuery.q = q; return [{ createdAt: t1, user: { id: other.id, name: "Other" } }]; };
  const likers = await discussionService.listLikes("p1", me, "d1");
  assert.deepEqual(likers, [{ user: { id: other.id, name: "Other" }, likedAt: t1 }]);
  assert.deepEqual(likerQuery.q.where, { discussionId: "d1" });
  assert.equal(likerQuery.q.orderBy.createdAt, "desc", "newest like first");
  db.discussionReply.findFirst = async ({ where }: any) => (where.id === "top" ? { id: "top" } : null);
  await discussionService.listLikes("p1", me, "d1", "top");
  assert.deepEqual(likerQuery.q.where, { replyId: "top" });
  await rejects(() => discussionService.listLikes("p1", me, "d1", "nope"), 404);
  hasAccess = false;
  await rejects(() => discussionService.listLikes("p1", other, "d1"), 403);
  hasAccess = true;

  // --- access is project access only: approvers do not get in through Viscussion ---
  const keepFindFirst = db.project.findFirst;
  const accessQuery: { q: any } = { q: undefined as any };
  db.project.findFirst = async (q: any) => { accessQuery.q = q; return { id: "p1" }; };
  assert.equal(await canAccessProjectDiscussions("p1", me.id, me.roleId), true);
  const accessText = JSON.stringify(accessQuery.q);
  assert.ok(!/approv/i.test(accessText), "approvers must not widen access");
  assert.ok(accessText.includes("projectMembers"), "members are matched through project membership");
  db.project.findFirst = async () => null;
  assert.equal(await canAccessProjectDiscussions("p1", other.id, other.roleId), false);

  // --- mentions: only people with access to the project, never the author ---
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const OUTSIDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const userQuery: { q: any } = { q: undefined as any };
  db.project.findFirst = async () => ({ ownerId: "o1", businessUnit: "bu1", status: "ACTIVE", projectMembers: [{ userId: "m1" }] });
  // Roles that were never synced fall back to the defaults: admins see all, BU head sees the BU, members only their own.
  db.role.findMany = async () => [
    { id: "r-admin", name: "SUPERADMIN", projectAccess: [] },
    { id: "r-bu", name: "BU_HEAD", projectAccess: [] },
    { id: "r-mem", name: "MEMBER", projectAccess: [] },
  ];
  db.user.findMany = async (q: any) => {
    userQuery.q = q;
    return [{ id: A, name: "Ann", position: "PM" }, { id: B, name: "Bob", position: null }];
  };
  const candidates = await listMentionCandidates("p1");
  assert.deepEqual(candidates.map((c) => c.name), ["owner", "member", "Ann", "Bob"], "the two groups come first, then the people");
  assert.equal(userQuery.q.where.isActive, true, "inactive users are never suggested");
  const shape = JSON.stringify(userQuery.q.where.OR);
  assert.ok(shape.includes("r-admin") && shape.includes("r-bu") && shape.includes("\"bu1\""), "roles that see all, and BU-scoped roles in the project BU, have access");
  assert.ok(!shape.includes("r-mem"), "a role with only own-project access is not suggested");
  assert.ok(!/approv/i.test(shape), "approvers are not mentionable");
  const text = `hi @[Ann](${A}) @[Bob](${B}) @[Mallory](${OUTSIDER})`;
  assert.deepEqual(await resolveMentions("p1", text, "someone-else"), [A, B], "outsiders are dropped");
  assert.deepEqual(await resolveMentions("p1", text, A), [B], "you cannot mention yourself");
  assert.deepEqual(await resolveMentions("p1", "no mentions here", A), []);

  // --- group mentions: @owner = owner and co-owners, @member = the whole team (only people with access, never the author) ---
  db.project.findFirst = async () => ({
    ownerId: "o1", businessUnit: "bu1", status: "ACTIVE",
    projectMembers: [{ userId: "co1", role: "CO_OWNER" }, { userId: "m1", role: "MEMBER" }, { userId: "m2", role: "MEMBER" }],
  });
  db.user.findMany = async () => ["o1", "co1", "m1", "m2"].map((id) => ({ id, name: id, position: null }));
  const OWNER_TAG = "@[owner](owner)";
  const MEMBER_TAG = "@[member](member)";
  assert.deepEqual((await resolveMentions("p1", OWNER_TAG, "x")).sort(), ["co1", "o1"], "@owner reaches the owner and co-owners");
  assert.deepEqual((await resolveMentions("p1", MEMBER_TAG, "x")).sort(), ["co1", "m1", "m2"], "@member reaches the team");
  assert.deepEqual((await resolveMentions("p1", `${OWNER_TAG} ${MEMBER_TAG}`, "x")).sort(), ["co1", "m1", "m2", "o1"], "nobody is counted twice");
  assert.deepEqual((await resolveMentions("p1", OWNER_TAG, "o1")).sort(), ["co1"], "the author is left out of a group");
  db.user.findMany = async () => [{ id: "m1", name: "m1", position: null }];
  assert.deepEqual(await resolveMentions("p1", OWNER_TAG, "x"), [], "people without access are dropped from a group");
  db.project.findFirst = keepFindFirst;

  // =====================================================================================
  // Attachments and pinned threads
  // =====================================================================================
  const assets = require("../../services/s3-assets.service");
  const realAssert = assets.assertUploadedObject;
  let s3Calls = 0;
  let s3Fails = false;
  assets.assertUploadedObject = async () => {
    s3Calls += 1;
    if (s3Fails) { const e: any = new Error("NotFound"); e.name = "NotFound"; throw e; }
  };
  const ref = (name: string, over: Record<string, unknown> = {}) => ({
    fileKey: "dev/discussions/p1/1700000000000-abc-" + name,
    fileName: name,
    contentType: "image/png",
    fileSize: 1024,
    ...over,
  });

  // --- cleanAttachments: what the browser sends after uploading straight to S3 ---
  assert.deepEqual(await cleanAttachments(undefined, "p1"), []);
  assert.deepEqual(await cleanAttachments(null, "p1"), []);
  const accepted = await cleanAttachments([ref("shot.png"), ref("shot.png"), ref("plan.pdf", { contentType: "application/pdf" })], "p1");
  assert.equal(accepted.length, 2, "the same file listed twice is kept once");
  assert.equal(accepted[0].fileName, "shot.png");
  assert.equal(s3Calls, 2, "every distinct file is checked in S3");
  await rejects(() => cleanAttachments("nope", "p1"), 400, "INVALID_ATTACHMENT");
  await rejects(() => cleanAttachments(Array.from({ length: 11 }, (_, i) => ref("f" + i + ".png")), "p1"), 400, "INVALID_ATTACHMENT");
  await rejects(() => cleanAttachments([ref("big.png", { fileSize: 5 * 1024 * 1024 + 1 })], "p1"), 400, "INVALID_ATTACHMENT");
  assert.equal((await cleanAttachments([ref("exact.png", { fileSize: 5 * 1024 * 1024 })], "p1")).length, 1, "exactly 5 MB is allowed");
  await rejects(() => cleanAttachments([ref("run.exe", { contentType: "application/x-msdownload" })], "p1"), 400, "INVALID_ATTACHMENT");
  await rejects(() => cleanAttachments([ref("other.png", { fileKey: "dev/discussions/another-project/1-abc-other.png" })], "p1"), 400, "INVALID_ATTACHMENT");
  await rejects(() => cleanAttachments([ref("inc.png", { fileKey: "dev/incidents/p1/1-abc-inc.png" })], "p1"), 400, "INVALID_ATTACHMENT");
  await rejects(() => cleanAttachments([ref("prod.png", { fileKey: "prod/discussions/p1/1-abc-prod.png" })], "p1"), 400, "INVALID_ATTACHMENT");
  s3Fails = true;
  await rejects(() => cleanAttachments([ref("ghost.png")], "p1"), 400, "ATTACHMENT_NOT_UPLOADED");
  s3Fails = false;

  // --- the shape the screens get ---
  const stored = { id: "a1", fileKey: "dev/discussions/p1/1-abc-shot.png", fileName: "shot.png", contentType: "image/png", fileSize: 10, uploadedById: "u-author", uploadedBy: { id: "u-author", name: "Me" }, createdAt: new Date() };
  const mine = mapAttachment(stored, "u-author", false);
  assert.equal(mine.isImage, true);
  assert.match(mine.url, /\/dev\/discussions\/p1\/1-abc-shot\.png$/);
  assert.equal(mine.canDelete, true, "the person who attached it may remove it");
  assert.equal(mapAttachment(stored, "someone", false).canDelete, false);
  assert.equal(mapAttachment(stored, "someone", true).canDelete, true, "a project manager may remove it");
  assert.equal(mapAttachment({ ...stored, contentType: "application/pdf" }, "x", false).isImage, false);

  // --- creating a thread and a reply with files ---
  db.project.findFirst = async (q: any) => (q.where.AND ? { id: "p1" } : { ownerId: "o1", projectMembers: [] });
  let createdData: any;
  db.discussion.create = async ({ data }: any) => { createdData = data; return { id: "d9" }; };
  db.discussion.findFirst = async () => ({
    id: "d9", projectId: "p1", authorId: me.id, status: "OPEN", title: "t", body: "b", resolvedAt: null, pinnedAt: null,
    author: { id: me.id, name: "Me" }, subtasks: [], likes: [], _count: { likes: 0 }, attachments: [stored], replies: [],
    createdAt: new Date(), updatedAt: new Date(), editedAt: null,
  });
  db.subtask.findMany = async () => [];
  const withFile: any = await discussionService.create("p1", me, { body: "see attached", attachments: [ref("shot.png")] });
  assert.equal(createdData.attachments.create.length, 1);
  assert.equal(createdData.attachments.create[0].uploadedById, me.id);
  assert.equal(createdData.attachments.create[0].fileSize, 1024);
  assert.equal(withFile.attachments.length, 1);
  assert.equal(withFile.canPin, false, "the author is not a manager of the project");
  assert.equal(withFile.isPinned, false);
  await rejects(() => discussionService.create("p1", me, { body: "x", attachments: [ref("big.png", { fileSize: 6 * 1024 * 1024 })] }), 400, "INVALID_ATTACHMENT");

  db.discussionReply.create = async ({ data }: any) => { replyData = data; return { id: "r9" }; };
  db.discussion.update = async () => ({});
  db.$transaction = async (ops: any[]) => Promise.all(ops);
  await discussionService.addReply("p1", other, "d9", { body: "", attachments: [ref("only-file.png")] });
  assert.equal(replyData.body, "", "a reply can be only a file");
  assert.equal(replyData.attachments.create[0].discussionId, "d9");
  await discussionService.addReply("p1", other, "d9", { body: "words and a file", attachments: [ref("f2.png")] });
  assert.equal(replyData.body, "words and a file");
  await rejects(() => discussionService.addReply("p1", other, "d9", { body: "   " }), 400, "VALIDATION_ERROR");
  await rejects(() => discussionService.addReply("p1", other, "d9", { body: "", attachments: [] }), 400, "VALIDATION_ERROR");

  // --- removing an attachment: soft, by the uploader or a project manager ---
  const au: { q: any } = { q: undefined };
  // Removing an attachment also deletes the file from S3 (patched here so no network is used).
  const deletedFromS3: string[] = [];
  let s3DeleteFails = false;
  assets.deleteManagedAsset = async (key: string) => {
    if (s3DeleteFails) throw new Error("AccessDenied");
    deletedFromS3.push(key);
    return true;
  };
  const lastAu = (): any => au.q;
  db.discussionAttachment.findFirst = async ({ where }: any) => (where.id === "a1" ? { id: "a1", uploadedById: "u-author", fileKey: "dev/discussions/p1/1-abc-shot.png" } : null);
  db.discussionAttachment.update = async (q: any) => { au.q = q; return {}; };
  await discussionService.removeAttachment("p1", me, "d9", "a1");
  assert.ok(lastAu().data.deletedAt instanceof Date, "removing only marks the row");
  assert.equal(lastAu().where.id, "a1");
  assert.deepEqual(deletedFromS3, ["dev/discussions/p1/1-abc-shot.png"], "the file is deleted from S3 as well");
  au.q = undefined;
  deletedFromS3.length = 0;
  await rejects(() => discussionService.removeAttachment("p1", other, "d9", "a1"), 403, "FORBIDDEN");
  assert.equal(au.q, undefined, "someone else cannot remove it");
  assert.deepEqual(deletedFromS3, [], "and nothing is deleted from S3 for a refused request");
  await rejects(() => discussionService.removeAttachment("p1", me, "d9", "missing"), 404, "NOT_FOUND");
  db.project.findFirst = async (q: any) => (q.where.AND ? { id: "p1" } : { ownerId: other.id, projectMembers: [] }); // other owns the project
  await discussionService.removeAttachment("p1", other, "d9", "a1");
  assert.ok(lastAu().data.deletedAt instanceof Date, "the project owner may remove anyone's file");
  assert.equal(deletedFromS3.length, 1);
  // if S3 refuses, the attachment is still removed from the thread and the request still succeeds
  s3DeleteFails = true;
  au.q = undefined;
  const quiet = console.error; console.error = () => undefined;
  await discussionService.removeAttachment("p1", other, "d9", "a1");
  console.error = quiet;
  s3DeleteFails = false;
  assert.ok(lastAu().data.deletedAt instanceof Date, "a failed S3 delete does not undo the removal");

  // --- pinning: owner or co-owner only, a few at a time ---
  let pinState: { pinned: boolean; count: number } = { pinned: false, count: 0 };
  const pinUpdates: any[] = [];
  db.discussion.findFirst = async (q: any) => {
    if (q.where.pinnedAt) return pinState.pinned ? { id: "d9" } : null; // "is it already pinned?"
    return { id: "d9", projectId: "p1", authorId: me.id, status: "OPEN", title: "t", body: "b", resolvedAt: null, pinnedAt: null,
      author: { id: me.id, name: "Me" }, subtasks: [], likes: [], _count: { likes: 0 }, attachments: [], replies: [],
      createdAt: new Date(), updatedAt: new Date(), editedAt: null };
  };
  db.discussion.count = async () => pinState.count;
  db.discussion.update = async (q: any) => { pinUpdates.push(q); return {}; };

  const managerOf = (ownerId: string, members: { role: string }[] = []) => async (q: any) =>
    (q.where.AND ? { id: "p1" } : { ownerId, projectMembers: members });
  db.project.findFirst = managerOf("o1"); // me is only a member
  await rejects(() => discussionService.pin("p1", me, "d9"), 403, "FORBIDDEN");
  await rejects(() => discussionService.unpin("p1", me, "d9"), 403, "FORBIDDEN");
  assert.equal(pinUpdates.length, 0, "a non-manager changes nothing");

  db.project.findFirst = managerOf(me.id); // me owns the project
  const pinned: any = await discussionService.pin("p1", me, "d9");
  assert.ok(pinUpdates[0].data.pinnedAt instanceof Date);
  assert.equal(pinUpdates[0].data.pinnedById, me.id);
  assert.equal(pinned.canPin, true);

  db.project.findFirst = managerOf("o1", [{ role: "CO_OWNER" }]); // a co-owner may too
  pinUpdates.length = 0;
  await discussionService.pin("p1", me, "d9");
  assert.equal(pinUpdates.length, 1, "a co-owner may pin");

  pinState = { pinned: false, count: 3 };
  pinUpdates.length = 0;
  await rejects(() => discussionService.pin("p1", me, "d9"), 400, "PIN_LIMIT");
  assert.equal(pinUpdates.length, 0, "the fourth pin is refused");
  pinState = { pinned: true, count: 3 };
  await discussionService.pin("p1", me, "d9");
  assert.equal(pinUpdates.length, 0, "pinning an already pinned thread changes nothing and does not hit the limit");

  await discussionService.unpin("p1", me, "d9");
  assert.equal(pinUpdates[0].data.pinnedAt, null);
  assert.equal(pinUpdates[0].data.pinnedById, null);

  // --- the list puts pinned threads first, whatever the sort ---
  const listQueries: any[] = [];
  db.discussion.count = async () => 0;
  db.discussion.findMany = async (q: any) => { listQueries.push(q); return []; };
  for (const sort of ["latest", "newest", "liked"]) {
    listQueries.length = 0;
    await discussionService.list("p1", me, { sort });
    assert.deepEqual(listQueries[0].orderBy[0], { pinnedAt: { sort: "desc", nulls: "last" } }, "pinned first for sort=" + sort);
    assert.ok(listQueries[0].orderBy.length >= 2, "the chosen sort still applies after the pinned ones");
    assert.ok(JSON.stringify(listQueries[0].include._count).includes("attachments"), "the list counts attachments");
    assert.equal(listQueries[0].include.attachments.take, 6, "and brings the first few for a preview");
    assert.equal(listQueries[0].include.attachments.where.replyId, null, "only the post's own files, not the replies'");
  }

  assets.assertUploadedObject = realAssert;
  console.log("discussion tests passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
