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
  authorize("DAILY_REPORTS", "CREATE"),
  DailyReportController.create
);

// GET ALL (with filters)
router.get(
  "/",
  authenticate,
  authorize("DAILY_REPORTS", "READ"),
  DailyReportController.getAll
);

// GET INBOX (Reports sent to current user)
router.get(
  "/inbox",
  authenticate,
  authorize("DAILY_REPORTS", "READ"),
  DailyReportController.getInbox
);

// GET MY SUBMITTED (Reports created by current user)
router.get(
  "/my-submitted",
  authenticate,
  authorize("DAILY_REPORTS", "READ"),
  DailyReportController.getMySubmitted
);

// GET SUMMARY/DASHBOARD
router.get(
  "/summary",
  authenticate,
  authorize("DAILY_REPORTS", "READ"),
  DailyReportController.getSummary
);

// GET BY PROJECT
router.get(
  "/project/:projectId",
  authenticate,
  authorize("DAILY_REPORTS", "READ"),
  DailyReportController.getByProject
);

// GET BY ID
router.get(
  "/:id",
  authenticate,
  authorize("DAILY_REPORTS", "READ"),
  DailyReportController.getById
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("DAILY_REPORTS", "UPDATE"),
  DailyReportController.update
);

// MARK AS READ
router.put(
  "/:id/mark-read",
  authenticate,
  authorize("DAILY_REPORTS", "UPDATE"),
  DailyReportController.markAsRead
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("DAILY_REPORTS", "DELETE"),
  DailyReportController.delete
);

// ========================================
// 📎 DAILY REPORT ATTACHMENTS
// ========================================
router.post(
  "/:id/attachments",
  authenticate,
  authorize("DAILY_REPORTS", "UPDATE"),
  upload.fields([{ name: "attachments", maxCount: 10 }, { name: "files", maxCount: 10 }]),
  uploadDailyReportAttachment
);

router.delete(
  "/attachments/:attachmentId",
  authenticate,
  authorize("DAILY_REPORTS", "UPDATE"),
  deleteDailyReportAttachment
);

router.get(
  "/attachments/:attachmentId/file",
  authenticate,
  authorize("DAILY_REPORTS", "READ"),
  streamDailyReportAttachment
);

export default router;
