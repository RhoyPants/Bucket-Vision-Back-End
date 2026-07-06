import { Router } from "express";
import { ApprovalFlowController } from "./approval.flow.controller";
import { authenticate } from "../../../middleware/auth.middleware";
import { authorize } from "../../../middleware/rbac.middleware";

const router = Router();

// ====================================
// 🔒 APPROVAL FLOW MANAGEMENT (Admin Only)
// ====================================

// GET /api/admin/approval-flows/default
// Get default approval flow (no ID conflict)
router.get(
  "/default",
  authenticate,
  // authorize("settings_approval_flows", "READ"),
  ApprovalFlowController.getDefaultFlow
);

router.get(
  "/roles/:roleId/users",
  authenticate,
  // authorize("settings_approval_flows", "READ"),
  ApprovalFlowController.getUsersByRole
);

// POST /api/admin/approval-flows
// Create new approval flow
router.post(
  "/",
  authenticate,
  authorize("settings_approval_flows", "CREATE"),
  ApprovalFlowController.createFlow
);

// GET /api/admin/approval-flows
// Get all approval flows
router.get(
  "/",
  authenticate,
  // authorize("settings_approval_flows", "READ"),
  ApprovalFlowController.getAllFlows
);

// GET /api/admin/approval-flows/:flowId
// Get approval flow by ID
router.get(
  "/:flowId",
  authenticate,
  // authorize("settings_approval_flows", "READ"),
  ApprovalFlowController.getFlowById
);

// PATCH /api/admin/approval-flows/:flowId
// Update approval flow
router.patch(
  "/:flowId",
  authenticate,
  authorize("settings_approval_flows", "UPDATE"),
  ApprovalFlowController.updateFlow
);

// DELETE /api/admin/approval-flows/:flowId
// Delete approval flow
router.delete(
  "/:flowId",
  authenticate,
  authorize("settings_approval_flows", "DELETE"),
  ApprovalFlowController.deleteFlow
);

// POST /api/admin/approval-flows/:flowId/set-default
// Set as default flow
router.post(
  "/:flowId/set-default",
  authenticate,
  authorize("settings_approval_flows", "UPDATE"),
  ApprovalFlowController.setDefaultFlow
);

export default router;
