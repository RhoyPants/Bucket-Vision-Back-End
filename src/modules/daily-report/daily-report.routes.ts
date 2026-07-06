import { Router } from "express";
import { DailyReportController, uploadDailyReportAttachment, deleteDailyReportAttachment, streamDailyReportAttachment } from "./daily-report.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import upload from "../../middleware/upload.middleware";

const router = Router();

// CREATE
router.post(
  "/",
  authenticate,
  authorize("daily_reports", "CREATE"),
  DailyReportController.create
);

// GET ALL (with filters)
router.get(
  "/",
  authenticate,
  // authorize("daily_reports", "READ"),
  DailyReportController.getAll
);

// GET INBOX (Reports sent to current user)
router.get(
  "/inbox",
  authenticate,
  // authorize("daily_reports", "READ"),
  DailyReportController.getInbox
);

// GET MY SUBMITTED (Reports created by current user)
router.get(
  "/my-submitted",
  authenticate,
  // authorize("daily_reports", "READ"),
  DailyReportController.getMySubmitted
);

// GET SUMMARY/DASHBOARD
router.get(
  "/summary",
  authenticate,
  // authorize("daily_reports", "READ"),
  DailyReportController.getSummary
);

// GET BY PROJECT
router.get(
  "/project/:projectId",
  authenticate,
  // authorize("daily_reports", "READ"),
  DailyReportController.getByProject
);

// GET BY ID
router.get(
  "/:id",
  authenticate,
  // authorize("daily_reports", "READ"),
  DailyReportController.getById
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("daily_reports", "UPDATE"),
  DailyReportController.update
);

// MARK AS READ
router.put(
  "/:id/mark-read",
  authenticate,
  authorize("daily_reports", "UPDATE"),
  DailyReportController.markAsRead
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("daily_reports", "DELETE"),
  DailyReportController.delete
);

// ========================================
// 📎 DAILY REPORT ATTACHMENTS
// ========================================
router.post(
  "/:id/attachments",
  authenticate,
  authorize("daily_reports", "UPDATE"),
  upload.fields([{ name: "attachments", maxCount: 10 }, { name: "files", maxCount: 10 }]),
  uploadDailyReportAttachment
);

router.delete(
  "/attachments/:attachmentId",
  authenticate,
  authorize("daily_reports", "UPDATE"),
  deleteDailyReportAttachment
);

router.get(
  "/attachments/:attachmentId/file",
  authenticate,
  // authorize("daily_reports", "READ"),
  streamDailyReportAttachment
);

export default router;
