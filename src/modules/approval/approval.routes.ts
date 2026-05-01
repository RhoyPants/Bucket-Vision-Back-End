import { Router, Request, Response } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { approvalController } from "./approval.controller";

const router = Router();

/**
 * All approval routes require authentication
 */

/**
 * POST /api/approvals/submit
 * Submit project for approval workflow
 */
router.post(
  "/submit",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  (req: Request, res: Response) => approvalController.submitProjectForApproval(req, res)
);

/**
 * POST /api/approvals/:projectId/approve
 * Approve project at current level
 */
router.post(
  "/:projectId/approve",
  authenticate,
  authorize("APPROVALS", "APPROVE"),
  (req: Request, res: Response) => approvalController.approveProject(req, res)
);

/**
 * POST /api/approvals/:projectId/reject
 * Reject project with remarks
 */
router.post(
  "/:projectId/reject",
  authenticate,
  authorize("APPROVALS", "APPROVE"),
  (req: Request, res: Response) => approvalController.rejectProject(req, res)
);

/**
 * GET /api/approvals/:projectId
 * Get all approvals for a project
 */
router.get(
  "/:projectId",
  authenticate,
  authorize("APPROVALS", "READ"),
  (req: Request, res: Response) => approvalController.getProjectApprovals(req, res)
);

/**
 * GET /api/approvals/pending
 * Get pending approvals for current user
 */
router.get(
  "/",
  authenticate,
  authorize("APPROVALS", "READ"),
  (req: Request, res: Response) => approvalController.getPendingApprovals(req, res)
);

/**
 * GET /api/approvals/:projectId/audit
 * Get approval audit log for a project
 */
router.get(
  "/:projectId/audit",
  authenticate,
  authorize("APPROVALS", "READ"),
  (req: Request, res: Response) => approvalController.getApprovalAuditLog(req, res)
);

export default router;
