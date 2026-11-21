import { Request, Response, Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { buildDefinitions } from "./project-access.keys";
import { getMyProjectAccess, getRoleView, ProjectAccessError, setRoleProjectAccess, syncRoleProjectAccess } from "./project-access.service";

// Mounted at /api/project-access. Drives the "Project Access" tab of Settings > Roles.
const router = Router();

const actor = (req: Request) => (req as any).user as { id: string; roleId: string };
const roleId = (req: Request) => String(req.params.roleId);

const handle = (fn: (req: Request) => Promise<unknown> | unknown) => async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (e: any) {
    if (!(e instanceof ProjectAccessError)) console.error("[project-access]", e);
    const known = e instanceof ProjectAccessError;
    res.status(known ? e.status : 500).json({
      success: false,
      error: { code: known ? e.code : "INTERNAL_ERROR", message: known ? e.message : "Unable to complete the request" },
    });
  }
};

/** The checklist the screen draws: groups, items, labels, what implies what. */
router.get("/definitions", authenticate, handle(() => buildDefinitions()));
/** What the signed-in user's role lists on the Projects page. */
router.get("/me", authenticate, handle((req) => getMyProjectAccess(actor(req).roleId)));
/** One role's current settings, and whether it has been synced yet. */
router.get("/roles/:roleId", authenticate, handle((req) => getRoleView(roleId(req))));
/** Save the ticked settings for a role. */
router.put(
  "/roles/:roleId",
  authenticate,
  authorize("settings_roles", "UPDATE"),
  handle((req) => setRoleProjectAccess(roleId(req), req.body?.keys, actor(req))),
);
/** Sync button: put a role back on the defaults. */
router.post(
  "/roles/:roleId/sync",
  authenticate,
  authorize("settings_roles", "UPDATE"),
  handle((req) => syncRoleProjectAccess(roleId(req), actor(req))),
);

export default router;
