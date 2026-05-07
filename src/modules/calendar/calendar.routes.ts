import { Router, Request, Response } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { calendarController } from "./calendar.controller";

const router = Router();

/**
 * All calendar routes require authentication
 */

/**
 * GET /api/calendar/:projectId/subtasks
 * Get all subtasks for calendar view with optional date filtering
 * Query params: startDate, endDate (ISO 8601), scopeId
 */
router.get(
  "/:projectId/subtasks",
  authenticate,
  authorize("PROJECTS", "READ"),
  (req: Request, res: Response) =>
    calendarController.getCalendarSubtasks(req, res)
);

/**
 * GET /api/calendar/:projectId/month/:year/:month
 * Get subtasks for a specific month (optimized for month view)
 * Query params: scopeId (optional)
 */
router.get(
  "/:projectId/month/:year/:month",
  authenticate,
  authorize("PROJECTS", "READ"),
  (req: Request, res: Response) =>
    calendarController.getMonthCalendar(req, res)
);

/**
 * GET /api/calendar/:projectId/scopes
 * Get all scopes (categories) for a project - for filtering
 */
router.get(
  "/:projectId/scopes",
  authenticate,
  authorize("PROJECTS", "READ"),
  (req: Request, res: Response) =>
    calendarController.getProjectScopes(req, res)
);

/**
 * GET /api/calendar/subtask/:subtaskId
 * Get single subtask details for progress modal
 * Note: This route must be AFTER other specific routes to avoid conflicts
 */
router.get(
  "/subtask/:subtaskId",
  authenticate,
  authorize("PROJECTS", "READ"),
  (req: Request, res: Response) =>
    calendarController.getSubtaskDetail(req, res)
);

export default router;
