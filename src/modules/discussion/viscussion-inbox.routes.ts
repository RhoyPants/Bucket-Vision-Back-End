import { Request, Response, Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { loadInboxSummary, loadInboxThreads } from "./discussion.inbox";

// Mounted at /api/viscussion. The header "message" icon: what is new for the signed-in
// user across every project they can access (not tied to a single project).
const router = Router();
router.use(authenticate);

const user = (req: Request) => (req as any).user as { id: string; roleId: string };
const fail = (res: Response, e: any) => {
  console.error("[viscussion-inbox]", e);
  return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Unable to complete the request" } });
};

/** Totals plus one row per project: what is new and the latest activity. */
router.get("/summary", async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await loadInboxSummary(user(req)) });
  } catch (e) {
    fail(res, e);
  }
});

/**
 * Threads that matter to the user, newest activity first. Query: `projectId`, `unread=1`,
 * `notifications=1` (leave out your own posts that nothing has happened on), and `limit` + `offset`
 * to read it a page at a time (the answer then also says how many there are in total).
 */
router.get("/threads", async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : undefined;
    let threads = await loadInboxThreads(user(req), { projectId });
    if (req.query.unread === "1" || req.query.unread === "true") threads = threads.filter((t) => t.unreadCount > 0);
    if (req.query.notifications === "1") threads = threads.filter((t) => !t.snippet.byMe || t.unreadCount > 0);
    threads.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    const total = threads.length;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? ""), 10) || 0, 0), 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? ""), 10) || 0, 0);
    if (limit) threads = threads.slice(offset, offset + limit);
    res.json({ success: true, data: threads, meta: { total, offset, limit } });
  } catch (e) {
    fail(res, e);
  }
});

export default router;
