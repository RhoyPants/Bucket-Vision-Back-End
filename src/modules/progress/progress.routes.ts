import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

import * as ProgressController from "./progress.controller";
import upload from "../../middleware/upload.middleware";

const router = Router();

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
  upload.fields([
    { name: "attachments", maxCount: 10 },
    { name: "photo", maxCount: 1 },
  ]),
  ProgressController.addProgress
);

// ========================================
// ✏️ UPDATE EXISTING PROGRESS ENTRY
// ========================================
router.put(
  "/:id",
  authenticate,
  authorize("progress", "UPDATE"),
  upload.fields([
    { name: "attachments", maxCount: 10 },
    { name: "photo", maxCount: 1 },
  ]),
  ProgressController.updateProgress
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
