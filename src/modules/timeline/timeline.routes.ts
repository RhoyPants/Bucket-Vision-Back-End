import { Router } from "express";
import { TimelineController } from "./timeline.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// ========================================
// TIMELINE OPERATIONS
// ========================================

// GET TIMELINE (For S-Curve Chart) - Main endpoint
router.get(
  "/:projectId",
  authenticate,
  authorize("PROJECTS", "READ"),
  TimelineController.getTimeline
);

// GET TODAY'S SNAPSHOT (Real-time status)
router.get(
  "/:projectId/today",
  authenticate,
  authorize("TIMELINES", "READ"),
  TimelineController.getTodaySnapshot
);

// GET LATEST SNAPSHOT (Current status)
router.get(
  "/:projectId/latest",
  authenticate,
  authorize("TIMELINES", "READ"),
  TimelineController.getLatestSnapshot
);

// GET VARIANCE REPORT
router.get(
  "/:projectId/variance",
  authenticate,
  authorize("TIMELINES", "READ"),
  TimelineController.getVarianceReport
);

// GET FORECAST
router.get(
  "/:projectId/forecast",
  authenticate,
  authorize("TIMELINES", "READ"),
  TimelineController.getForecast
);

// GENERATE TIMELINE (Manual trigger)
router.post(
  "/:projectId/generate",
  authenticate,
  authorize("TIMELINES", "UPDATE"),
  TimelineController.generateTimeline
);

// REFRESH TIMELINE (For cron jobs)
router.post(
  "/:projectId/refresh",
  authenticate,
  authorize("TIMELINES", "UPDATE"),
  TimelineController.refreshTimeline
);

export default router;
