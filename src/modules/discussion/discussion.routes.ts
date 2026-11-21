import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { discussionController as c } from "./discussion.controller";

// Mounted at /api/projects/:projectId/discussions. Access is per project and is
// enforced inside the service (project members, owner, approvers, admins).
const router = Router({ mergeParams: true });
router.use(authenticate);

router.get("/", c.list);
router.post("/", c.create);
router.get("/counts", c.counts); // "/counts" and "/subtask-options" must stay above "/:discussionId"
router.get("/subtask-options", c.subtaskOptions);
router.get("/mention-candidates", c.mentionCandidates);
router.get("/:discussionId", c.get);
router.patch("/:discussionId", c.update);
router.patch("/:discussionId/status", c.setStatus);
router.delete("/:discussionId", c.remove);
router.post("/:discussionId/like", c.like);
router.post("/:discussionId/read", c.markRead);
router.post("/:discussionId/pin", c.pin);
router.delete("/:discussionId/pin", c.unpin);
router.delete("/:discussionId/attachments/:attachmentId", c.removeAttachment);
router.get("/:discussionId/likes", c.likes);
router.get("/:discussionId/replies/:replyId/likes", c.replyLikes);
router.post("/:discussionId/replies", c.addReply);
router.patch("/:discussionId/replies/:replyId", c.updateReply);
router.delete("/:discussionId/replies/:replyId", c.removeReply);
router.post("/:discussionId/replies/:replyId/like", c.likeReply);

export default router;
