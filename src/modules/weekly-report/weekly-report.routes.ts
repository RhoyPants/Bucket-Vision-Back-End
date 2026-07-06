import { Router } from "express";
import { WeeklyReportController, uploadWeeklyReportAttachment, deleteWeeklyReportAttachment, streamWeeklyReportAttachment } from "./weekly-report.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import upload from "../../middleware/upload.middleware";

const router = Router();

// CREATE
router.post(
  "/",
  authenticate,
  authorize("weekly_reports", "CREATE"),
  WeeklyReportController.create
);

// GET INBOX (Reports sent to current user)
router.get(
  "/inbox",
  authenticate,
  // authorize("weekly_reports", "READ"),
  WeeklyReportController.getInbox
);

// GET MY SUBMITTED (Reports created by current user)
router.get(
  "/my-submitted",
  authenticate,
  // authorize("weekly_reports", "READ"),
  WeeklyReportController.getMySubmitted
);

// GET SUMMARY/DASHBOARD
router.get(
  "/summary",
  authenticate,
  // authorize("weekly_reports", "READ"),
  WeeklyReportController.getSummary
);

// GET BY DATE RANGE
router.get(
  "/range",
  authenticate,
  // authorize("weekly_reports", "READ"),
  WeeklyReportController.getByDateRange
);

// GET MY REPORTS (backward compatibility - same as my-submitted)
router.get(
  "/my",
  authenticate,
  // authorize("weekly_reports", "READ"),
  WeeklyReportController.getMyReports
);

// GET ALL (with filters)
router.get(
  "/",
  authenticate,
  // authorize("weekly_reports", "READ"),
  WeeklyReportController.getAll
);

// GET BY ID
router.get(
  "/:id",
  authenticate,
  // authorize("weekly_reports", "READ"),
  WeeklyReportController.getById
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("weekly_reports", "UPDATE"),
  WeeklyReportController.update
);

// MARK AS READ
router.put(
  "/:id/mark-read",
  authenticate,
  authorize("weekly_reports", "UPDATE"),
  WeeklyReportController.markAsRead
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("weekly_reports", "DELETE"),
  WeeklyReportController.delete
);

// ========================================
// 📎 WEEKLY REPORT ATTACHMENTS
// ========================================
router.post(
  "/:id/attachments",
  authenticate,
  authorize("weekly_reports", "UPDATE"),
  upload.fields([{ name: "attachments", maxCount: 10 }, { name: "files", maxCount: 10 }]),
  uploadWeeklyReportAttachment
);

router.delete(
  "/attachments/:attachmentId",
  authenticate,
  authorize("weekly_reports", "UPDATE"),
  deleteWeeklyReportAttachment
);

router.get(
  "/attachments/:attachmentId/file",
  authenticate,
  // authorize("weekly_reports", "READ"),
  streamWeeklyReportAttachment
);

export default router;
