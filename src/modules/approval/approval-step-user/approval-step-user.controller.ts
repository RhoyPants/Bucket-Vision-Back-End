import { Request, Response } from "express";
import { ApprovalStepUserService } from "../approval-step-user.service";

export class ApprovalStepUserController {
  /**
   * POST /api/admin/approval/steps/:stepId/users
   * Assign specific users to approval step
   */
  async assignUsersToStep(req: Request, res: Response): Promise<void> {
    try {
      const stepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;
      const { userIds } = req.body;

      if (!stepId || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: "Step ID and non-empty user IDs array are required" });
        return;
      }

      const result = await ApprovalStepUserService.assignUsersToStep(stepId, userIds);

      res.status(201).json({
        success: true,
        data: result,
        message: "Users assigned to approval step successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to assign users to step"
      });
    }
  }

  /**
   * GET /api/admin/approval/steps/:stepId/users
   * Get users assigned to approval step
   */
  async getAssignedUsers(req: Request, res: Response): Promise<void> {
    try {
      const stepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;

      if (!stepId) {
        res.status(400).json({ error: "Step ID is required" });
        return;
      }

      const users = await ApprovalStepUserService.getAssignedUsers(stepId);

      res.status(200).json({
        success: true,
        data: users,
        message: "Assigned users retrieved successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to retrieve assigned users"
      });
    }
  }

  /**
   * DELETE /api/admin/approval/steps/:stepId/users/:userId
   * Remove user from approval step
   */
  async removeUserFromStep(req: Request, res: Response): Promise<void> {
    try {
      const stepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;
      const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

      if (!stepId || !userId) {
        res.status(400).json({ error: "Step ID and User ID are required" });
        return;
      }

      await ApprovalStepUserService.removeUserFromStep(stepId, userId);

      res.status(200).json({
        success: true,
        message: "User removed from approval step successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to remove user from step"
      });
    }
  }

  /**
   * DELETE /api/admin/approval/steps/:stepId/users
   * Clear all user assignments for approval step (revert to role-based)
   */
  async clearStepAssignments(req: Request, res: Response): Promise<void> {
    try {
      const stepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;

      if (!stepId) {
        res.status(400).json({ error: "Step ID is required" });
        return;
      }

      await ApprovalStepUserService.clearAssignments(stepId);

      res.status(200).json({
        success: true,
        message: "All user assignments cleared, reverted to role-based approval"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to clear user assignments"
      });
    }
  }

  /**
   * GET /api/admin/approval/roles/:roleId/users
   * Get users with specific role (for dropdown UI)
   */
  async getUsersByRole(req: Request, res: Response): Promise<void> {
    try {
      const roleId = Array.isArray(req.params.roleId) ? req.params.roleId[0] : req.params.roleId;

      if (!roleId) {
        res.status(400).json({ error: "Role ID is required" });
        return;
      }

      const users = await ApprovalStepUserService.getUsersByRole(roleId);

      res.status(200).json({
        success: true,
        data: users,
        message: "Users with role retrieved successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to retrieve users by role"
      });
    }
  }

  /**
   * POST /api/admin/approval/steps/:stepId/users/add
   * Add single user to approval step (append, don't replace)
   */
  async addUserToStep(req: Request, res: Response): Promise<void> {
    try {
      const stepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;
      const { userId } = req.body;

      if (!stepId || !userId) {
        res.status(400).json({ error: "Step ID and User ID are required" });
        return;
      }

      const assignment = await ApprovalStepUserService.addUserToStep(stepId, userId);

      res.status(201).json({
        success: true,
        data: assignment,
        message: "User added to approval step successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to add user to step"
      });
    }
  }
}

