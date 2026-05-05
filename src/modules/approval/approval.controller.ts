import { Request, Response } from "express";
import { approvalService } from "./approval.service";

export class ApprovalController {
  /**
   * POST /api/approvals/submit
   * Submit project for approval
   */
  async submitProjectForApproval(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.body;
      const userId = req.user?.id;

      if (!projectId || !userId) {
        res.status(400).json({ error: "projectId and authorization required" });
        return;
      }

      const result = await approvalService.submitProjectForApproval(projectId, userId);

      res.status(200).json({
        success: true,
        data: result,
        message: "Project submitted for approval",
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to submit project",
      });
    }
  }

  /**
   * POST /api/approvals/:projectId/approve
   * Approve project at current level
   */
  async approveProject(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const approverId = req.user?.id;

      if (!projectId || !approverId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId and authorization required" });
        return;
      }

      const result = await approvalService.approveProject(projectId, approverId);

      res.status(200).json({
        success: true,
        data: result,
        message: "Project approved successfully",
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to approve project",
      });
    }
  }

  /**
   * POST /api/approvals/:projectId/reject
   * Reject project with remarks
   */
  async rejectProject(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const { remarks } = req.body;
      const approverId = req.user?.id;

      if (!projectId || !approverId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId and authorization required" });
        return;
      }

      if (!remarks || remarks.trim() === "") {
        res.status(400).json({ error: "Rejection remarks are required" });
        return;
      }

      const result = await approvalService.rejectProject(projectId, approverId, remarks);

      res.status(200).json({
        success: true,
        data: result,
        message: "Project rejected",
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to reject project",
      });
    }
  }

  /**
   * GET /api/approvals/:projectId
   * Get all approvals for a project
   */
  async getProjectApprovals(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;

      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId required" });
        return;
      }

      const approvals = await approvalService.getProjectApprovals(projectId);

      res.status(200).json({
        success: true,
        data: approvals,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to fetch approvals",
      });
    }
  }

  /**
   * GET /api/approvals/pending
   * Get pending approvals for current user
   */
  async getPendingApprovals(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const pending = await approvalService.getPendingApprovalsForUser(userId);

      res.status(200).json({
        success: true,
        data: pending,
        count: pending.length,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to fetch pending approvals",
      });
    }
  }

  /**
   * GET /api/approvals/:projectId/audit
   * Get approval audit log for a project
   */
  async getApprovalAuditLog(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;

      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId required" });
        return;
      }

      const auditLog = await approvalService.getApprovalAuditLog(projectId);

      res.status(200).json({
        success: true,
        data: auditLog,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to fetch audit log",
      });
    }
  }

  /**
   * GET /api/approvals/pending-projects
   * 
   * Returns projects awaiting current user's approval, respecting sequential workflow
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": [
   *     {
   *       "id": "project-uuid",
   *       "name": "Project Name",
   *       "status": "FOR_REVIEW" | "FOR_APPROVAL",
   *       "owner": { "id", "name", "email" },
   *       "pendingApprovalLevel": "BU_HEAD" | "OP",
   *       "pendingApprovalOrder": 1 | 2,
   *       ...
   *     }
   *   ],
   *   "count": 3,
   *   "message": "3 projects awaiting your approval"
   * }
   */
  async getPendingProjectsForApproval(req: Request, res: Response): Promise<void> {
    try {
      // Extract user from JWT token (set by auth middleware)
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: "Unauthorized - User ID not found"
        });
        return;
      }

      // Optional pagination params
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100); // Max 100
      const skip = parseInt(req.query.skip as string) || 0;

      console.log(`🔍 Getting pending projects for user ${userId} (limit=${limit}, skip=${skip})`);

      // Call service to get pending projects
      const pending = await approvalService.getPendingProjectsForApproval(userId);

      // Apply pagination if needed
      const paginatedResults = pending.slice(skip, skip + limit);

      res.status(200).json({
        success: true,
        data: paginatedResults,
        count: pending.length,
        limit,
        skip,
        message: `${pending.length} project(s) awaiting your approval`
      });

    } catch (error: any) {
      console.error("❌ Controller error in getPendingProjectsForApproval:", error);

      res.status(400).json({
        success: false,
        error: error.message || "Failed to fetch pending projects",
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}

export const approvalController = new ApprovalController();
