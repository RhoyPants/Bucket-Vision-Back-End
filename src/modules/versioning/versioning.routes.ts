import { Router, Request, Response } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { versioningController } from "./versioning.controller";

const router = Router();

/**
 * All versioning routes require authentication
 */

/**
 * POST /api/versioning/:projectId/create
 * Create a new version with amendments
 * Clones all progress, reports, team, attachments
 * Updates timeline/budget
 */
router.post(
  "/:projectId/create",
  authenticate,
  authorize("versioning", "UPDATE"),
  (req: Request, res: Response) =>
    versioningController.createNewVersion(req, res)
);

router.get(
  "/:projectId/progress-sync",
  authenticate,
  versioningController.getProgressSyncStatus,
);

router.post(
  "/:projectId/progress-sync",
  authenticate,
  authorize("versioning", "UPDATE"),
  versioningController.syncProgressFromParent,
);

/**
 * GET /api/versioning/:projectId/detail
 * Get full detail of a specific version (scopes, tasks, subtasks, team, timelines, reports)
 */
router.get(
  "/:projectId/detail",
  authenticate,
  // authorize("versioning", "READ"),
  (req: Request, res: Response) =>
    versioningController.getVersionDetail(req, res)
);

/**
 * GET /api/versioning/pin/:pin
 * Get all versions of a project by PIN
 */
router.get(
  "/pin/:pin",
  authenticate,
  // authorize("versioning", "READ"),
  (req: Request, res: Response) =>
    versioningController.getProjectVersions(req, res)
);

/**
 * GET /api/versioning/:projectId/history
 * Get complete version history for a project
 */
router.get(
  "/:projectId/history",
  authenticate,
  // authorize("versioning", "READ"),
  (req: Request, res: Response) =>
    versioningController.getVersionHistory(req, res)
);

/**
 * GET /api/versioning/compare/:v1/:v2
 * Compare two versions to see what changed
 */
router.get(
  "/compare/:v1/:v2",
  authenticate,
  // authorize("versioning", "READ"),
  (req: Request, res: Response) =>
    versioningController.compareVersions(req, res)
);

/**
 * GET /api/versioning/active/pin/:pin
 * Get the currently active version of a project by PIN
 */
router.get(
  "/active/pin/:pin",
  authenticate,
  // authorize("versioning", "READ"),
  (req: Request, res: Response) =>
    versioningController.getActiveVersionByPin(req, res)
);

/**
 * DELETE /api/versioning/:projectId/delete-draft
 * Delete a draft version before approval submission
 */
router.delete(
  "/:projectId/delete-draft",
  authenticate,
  authorize("versioning", "DELETE"),
  (req: Request, res: Response) =>
    versioningController.deleteDraftVersion(req, res)
);

export default router;
