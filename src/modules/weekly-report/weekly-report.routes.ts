import { Router } from "express";
import { WeeklyReportController } from "./weekly-report.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// CREATE
router.post(
  "/",
  authenticate,
  authorize("WEEKLY_REPORTS", "CREATE"),
  WeeklyReportController.create
);

// GET INBOX (Reports sent to current user)
router.get(
  "/inbox",
  authenticate,
  authorize("WEEKLY_REPORTS", "READ"),
  WeeklyReportController.getInbox
);

// GET MY SUBMITTED (Reports created by current user)
router.get(
  "/my-submitted",
  authenticate,
  authorize("WEEKLY_REPORTS", "READ"),
  WeeklyReportController.getMySubmitted
);

// GET SUMMARY/DASHBOARD
router.get(
  "/summary",
  authenticate,
  authorize("WEEKLY_REPORTS", "READ"),
  WeeklyReportController.getSummary
);

// GET BY DATE RANGE
router.get(
  "/range",
  authenticate,
  authorize("WEEKLY_REPORTS", "READ"),
  WeeklyReportController.getByDateRange
);

// GET MY REPORTS (backward compatibility - same as my-submitted)
router.get(
  "/my",
  authenticate,
  authorize("WEEKLY_REPORTS", "READ"),
  WeeklyReportController.getMyReports
);

// GET ALL (with filters)
router.get(
  "/",
  authenticate,
  authorize("WEEKLY_REPORTS", "READ"),
  WeeklyReportController.getAll
);

// GET BY ID
router.get(
  "/:id",
  authenticate,
  authorize("WEEKLY_REPORTS", "READ"),
  WeeklyReportController.getById
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("WEEKLY_REPORTS", "UPDATE"),
  WeeklyReportController.update
);

// MARK AS READ
router.put(
  "/:id/mark-read",
  authenticate,
  authorize("WEEKLY_REPORTS", "UPDATE"),
  WeeklyReportController.markAsRead
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("WEEKLY_REPORTS", "DELETE"),
  WeeklyReportController.delete
);

export default router;
