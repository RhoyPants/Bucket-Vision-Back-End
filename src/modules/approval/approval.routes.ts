import { Router, Request, Response } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { approvalController } from "./approval.controller";

const router = Router();

// ✅ STATIC ROUTES FIRST (must come before /:projectId)

router.post(
  "/submit",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  (req: Request, res: Response) => approvalController.submitProjectForApproval(req, res)
);

router.get(
  "/pending",
  authenticate,
  // authorize("approval_review", "READ"),
  (req: Request, res: Response) => approvalController.getPendingApprovals(req, res)
);

router.get(
  "/pending-projects",
  authenticate,
  // authorize("approval_review", "READ"),
  (req: Request, res: Response) => approvalController.getPendingProjectsForApproval(req, res)
);

// ✅ DYNAMIC ROUTES LAST (/:projectId catches anything not matched above)

router.get(
  "/:projectId",
  authenticate,
  // authorize("approval_review", "READ"),
  (req: Request, res: Response) => approvalController.getProjectApprovals(req, res)
);

router.get(
  "/:projectId/audit",
  authenticate,
  // authorize("approval_review", "READ"),
  (req: Request, res: Response) => approvalController.getApprovalAuditLog(req, res)
);

router.post(
  "/:projectId/approve",
  authenticate,
  authorize("approval_review", "APPROVE"),
  (req: Request, res: Response) => approvalController.approveProject(req, res)
);

router.post(
  "/:projectId/reject",
  authenticate,
  authorize("approval_review", "APPROVE"),
  (req: Request, res: Response) => approvalController.rejectProject(req, res)
);

export default router;