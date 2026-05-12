import { Router, Request, Response } from "express";
import { authenticate } from "../../../middleware/auth.middleware";
import { authorize } from "../../../middleware/rbac.middleware";
import { ApprovalStepUserController } from "./approval-step-user.controller";

const router = Router();
const controller = new ApprovalStepUserController();

// ✅ STATIC ROUTES FIRST

// Get users with specific role (for dropdown UI)
router.get(
  "/roles/:roleId/users",
  authenticate,
  authorize("APPROVALS", "READ"),
  (req: Request, res: Response) => controller.getUsersByRole(req, res)
);

// ✅ STEP USER ROUTES

// Assign users to step
router.post(
  "/steps/:stepId/users",
  authenticate,
  authorize("APPROVALS", "UPDATE"),
  (req: Request, res: Response) => controller.assignUsersToStep(req, res)
);

// Get assigned users for step
router.get(
  "/steps/:stepId/users",
  authenticate,
  authorize("APPROVALS", "READ"),
  (req: Request, res: Response) => controller.getAssignedUsers(req, res)
);

// Add single user to step (append)
router.post(
  "/steps/:stepId/users/add",
  authenticate,
  authorize("APPROVALS", "UPDATE"),
  (req: Request, res: Response) => controller.addUserToStep(req, res)
);

// Remove single user from step
router.delete(
  "/steps/:stepId/users/:userId",
  authenticate,
  authorize("APPROVALS", "DELETE"),
  (req: Request, res: Response) => controller.removeUserFromStep(req, res)
);

// Clear all assignments (revert to role-based)
router.delete(
  "/steps/:stepId/users",
  authenticate,
  authorize("APPROVALS", "DELETE"),
  (req: Request, res: Response) => controller.clearStepAssignments(req, res)
);

export default router;
