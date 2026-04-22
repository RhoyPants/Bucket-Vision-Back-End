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
  authorize("SUBTASKS", "READ"),
  ProgressController.getBySubtask
);

// ========================================
// ➕ ADD / UPDATE DAILY PROGRESS
// (calendar input)
// ========================================
router.post(
  "/",
  authenticate,
  authorize("SUBTASKS", "UPDATE"),
  upload.single("photo"),
  ProgressController.addProgress
);

// ========================================
// ✏️ UPDATE EXISTING PROGRESS ENTRY
// ========================================
router.put(
  "/:id",
  authenticate,
  authorize("SUBTASKS", "UPDATE"),
  ProgressController.updateProgress
);

// ========================================
// ❌ DELETE PROGRESS ENTRY
// ========================================
router.delete(
  "/:id",
  authenticate,
  authorize("SUBTASKS", "DELETE"),
  ProgressController.deleteProgress
);

// ========================================
// 📈 S-CURVE (PROJECT LEVEL)
// ========================================
router.get(
  "/scurve/:projectId",
  authenticate,
  authorize("PROJECTS", "READ"),
  ProgressController.getSCurve
);

export default router;