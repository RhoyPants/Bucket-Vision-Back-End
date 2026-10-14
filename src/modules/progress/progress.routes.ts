import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

import * as ProgressController from "./progress.controller";

const router = Router();

// ========================================
// 📋 GET UNIFIED PROGRESS HISTORY (LOGS + UPDATES)
// ========================================
router.get(
  "/subtask/:subtaskId/history",
  authenticate,
  ProgressController.getSubtaskProgressHistory
);

// ========================================
// 📅 GET PROGRESS LOGS (per subtask)
// ========================================
router.get(
  "/subtask/:subtaskId",
  authenticate,
  // authorize("progress", "READ"),
  ProgressController.getBySubtask
);

// ========================================
// ➕ ADD / UPDATE DAILY PROGRESS
// (calendar input)
// ========================================
router.get(
  "/can-add",
  authenticate,
  // authorize("progress", "UPDATE"),
  ProgressController.canAddProgress
);

router.post(
  "/",
  authenticate,
  authorize("progress", "UPDATE"),
  ProgressController.addProgress
);

// ========================================
// ✏️ UPDATE EXISTING PROGRESS ENTRY
// ========================================
router.put(
  "/:id",
  authenticate,
  authorize("progress", "UPDATE"),
  ProgressController.updateProgress
);

// Progress decrease approval workflow and complete update audit history.
router.get(
  "/update-requests/mine",
  authenticate,
  ProgressController.getMyProgressUpdateRequests
);

router.get(
  "/update-requests/inbox",
  authenticate,
  ProgressController.getProgressUpdateInbox
);

router.get(
  "/subtask/:subtaskId/update-requests",
  authenticate,
  ProgressController.getSubtaskProgressUpdateRequests
);

router.post(
  "/update-requests/:id/approve",
  authenticate,
  ProgressController.approveProgressUpdate
);

router.post(
  "/update-requests/:id/reject",
  authenticate,
  ProgressController.rejectProgressUpdate
);

router.post(
  "/update-requests/:id/cancel",
  authenticate,
  ProgressController.cancelProgressUpdate
);

// ========================================
// ❌ DELETE PROGRESS ENTRY
// ========================================
router.delete(
  "/:id",
  authenticate,
  authorize("progress", "DELETE"),
  ProgressController.deleteProgress
);

// ========================================
// 📈 S-CURVE (PROJECT LEVEL)
// ========================================
router.get(
  "/scurve/:projectId",
  authenticate,
  // authorize("progress", "READ"),
  ProgressController.getSCurve
);

// ========================================
// ❌ DELETE A SINGLE ATTACHMENT
// ========================================
router.delete(
  "/attachments/:attachmentId",
  authenticate,
  authorize("progress", "UPDATE"),
  ProgressController.deleteProgressAttachment
);

router.get(
  "/attachments/:attachmentId/file",
  authenticate,
  // authorize("progress", "READ"),
  ProgressController.streamProgressAttachment
);

export default router;
