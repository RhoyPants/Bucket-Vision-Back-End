import { Router } from "express";
import { AdminProjectApprovalController } from "./admin.project.approval.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// GET /api/admin/projects/:projectId/approval-config
router.get(
  "/:projectId/approval-config",
  authenticate,
  authorize("ADMIN", "READ"),
  AdminProjectApprovalController.getProjectApprovalConfig
);

// PATCH /api/admin/projects/:projectId/approval-config
router.patch(
  "/:projectId/approval-config",
  authenticate,
  authorize("ADMIN", "UPDATE"),
  AdminProjectApprovalController.configureProjectApproval
);

export default router;
