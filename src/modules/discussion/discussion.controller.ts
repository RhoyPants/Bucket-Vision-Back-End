import { Request, Response } from "express";
import { discussionService } from "./discussion.service";

const user = (req: Request) => (req as any).user as { id: string; roleId: string };
const pid = (req: Request) => String(req.params.projectId);
const did = (req: Request) => String(req.params.discussionId);
const rid = (req: Request) => String(req.params.replyId);
const aid = (req: Request) => String(req.params.attachmentId);

const fail = (res: Response, e: any) => {
  if (!e?.status) console.error("[discussions]", e);
  return res.status(e?.status || 500).json({
    success: false,
    error: {
      code: e?.code || "INTERNAL_ERROR",
      message: e?.status ? e.message : "Unable to complete the request",
    },
  });
};

const handle =
  (fn: (req: Request) => Promise<any>, status = 200) =>
  async (req: Request, res: Response) => {
    try {
      const result = await fn(req);
      // list() returns { data, meta }; everything else is wrapped.
      if (result && result.data && result.meta) return res.status(status).json({ success: true, ...result });
      return res.status(status).json({ success: true, data: result });
    } catch (e) {
      return fail(res, e);
    }
  };

export const discussionController = {
  list: handle((req) => discussionService.list(pid(req), user(req), req.query)),
  counts: handle((req) => discussionService.countsBySubtask(pid(req), user(req), req.query.subtaskIds)),
  subtaskOptions: handle((req) => discussionService.subtaskOptions(pid(req), user(req))),
  create: handle((req) => discussionService.create(pid(req), user(req), req.body), 201),
  get: handle((req) => discussionService.get(pid(req), user(req), did(req))),
  update: handle((req) => discussionService.update(pid(req), user(req), did(req), req.body)),
  setStatus: handle((req) => discussionService.setStatus(pid(req), user(req), did(req), req.body?.status)),
  remove: handle((req) => discussionService.remove(pid(req), user(req), did(req))),
  addReply: handle((req) => discussionService.addReply(pid(req), user(req), did(req), req.body), 201),
  updateReply: handle((req) => discussionService.updateReply(pid(req), user(req), did(req), rid(req), req.body)),
  removeReply: handle((req) => discussionService.removeReply(pid(req), user(req), did(req), rid(req))),
  like: handle((req) => discussionService.toggleLike(pid(req), user(req), did(req))),
  markRead: handle((req) => discussionService.markRead(pid(req), user(req), did(req))),
  mentionCandidates: handle((req) => discussionService.mentionCandidates(pid(req), user(req))),
  pin: handle((req) => discussionService.pin(pid(req), user(req), did(req))),
  unpin: handle((req) => discussionService.unpin(pid(req), user(req), did(req))),
  removeAttachment: handle((req) => discussionService.removeAttachment(pid(req), user(req), did(req), aid(req))),
  likes: handle((req) => discussionService.listLikes(pid(req), user(req), did(req))),
  replyLikes: handle((req) => discussionService.listLikes(pid(req), user(req), did(req), rid(req))),
  likeReply: handle((req) => discussionService.toggleLike(pid(req), user(req), did(req), rid(req))),
};
