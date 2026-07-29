import { Request, Response } from "express";
import { ApprovalFlowService } from "./approval.flow.service";

export class ApprovalFlowController {
  /**
   * POST /api/admin/approval-flows
   * Create new approval flow
   */
  static async createFlow(req: Request, res: Response) {
    try {
      const { name, description, isDefault, selfApprovalMode, steps } = req.body;

      // Validate input
      if (!name || !steps || steps.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_INPUT",
            message: "Name and at least one step are required"
          }
        });
      }

      // Validate steps
      const sortedSteps = [...steps].sort((a, b) => a.order - b.order);
      const validSources = ["PROJECT_BU_HEAD", "REQUESTER_BU_HEAD", "ROLE", "SPECIFIC_USERS"];
      for (let i = 0; i < sortedSteps.length; i++) {
        const source = sortedSteps[i].approverSource || "ROLE";
        if (source === "ROLE" && !sortedSteps[i].role) {
          return res.status(400).json({
            success: false,
            error: {
              code: "INVALID_STEPS",
              message: `Step ${i + 1}: role is required when approverSource is ROLE`
            }
          });
        }

        if (!validSources.includes(source)) {
          return res.status(400).json({
            success: false,
            error: {
              code: "INVALID_STEPS",
              message: `Step ${i + 1}: invalid approverSource`,
            },
          });
        }

        const mode = sortedSteps[i].stepExecutionMode;
        if (mode && mode !== "SEQUENTIAL" && mode !== "PARALLEL") {
          return res.status(400).json({
            success: false,
            error: {
              code: "INVALID_STEPS",
              message: `Step ${i + 1}: stepExecutionMode must be SEQUENTIAL or PARALLEL`,
            },
          });
        }
      }

      if (
        selfApprovalMode &&
        selfApprovalMode !== "OWN_STEP" &&
        selfApprovalMode !== "THROUGH_HIGHEST_STEP"
      ) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_SELF_APPROVAL_MODE",
            message: "selfApprovalMode must be OWN_STEP or THROUGH_HIGHEST_STEP",
          },
        });
      }

      const flow = await ApprovalFlowService.createFlow({
        name,
        description,
        isDefault: isDefault || false,
        selfApprovalMode,
        steps: sortedSteps
      });

      return res.status(201).json({
        success: true,
        message: "Approval flow created successfully",
        data: flow
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: {
          code: "CREATE_FLOW_ERROR",
          message: error.message
        }
      });
    }
  }

  /**
   * GET /api/admin/approval-flows
   * Get all approval flows
   */
  static async getAllFlows(req: Request, res: Response) {
    try {
      const onlyActive = req.query.active === "true";
      const flows = await ApprovalFlowService.getAllFlows(onlyActive);

      return res.json({
        success: true,
        data: flows,
        total: flows.length
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: {
          code: "FETCH_FLOWS_ERROR",
          message: error.message
        }
      });
    }
  }

  /**
   * GET /api/admin/approval-flows/:flowId
   * Get approval flow by ID
   */
  static async getFlowById(req: Request, res: Response) {
    try {
      const flowId = Array.isArray(req.params.flowId) ? req.params.flowId[0] : req.params.flowId;

      const flow = await ApprovalFlowService.getFlowById(flowId);

      return res.json({
        success: true,
        data: flow
      });
    } catch (error: any) {
      return res.status(404).json({
        success: false,
        error: {
          code: "FLOW_NOT_FOUND",
          message: error.message
        }
      });
    }
  }

  /**
   * PATCH /api/admin/approval-flows/:flowId
   * Update approval flow
   */
  static async updateFlow(req: Request, res: Response) {
    try {
      const flowId = Array.isArray(req.params.flowId) ? req.params.flowId[0] : req.params.flowId;
      const { name, description, isDefault, isActive, selfApprovalMode, steps } = req.body;

      if (
        selfApprovalMode &&
        selfApprovalMode !== "OWN_STEP" &&
        selfApprovalMode !== "THROUGH_HIGHEST_STEP"
      ) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_SELF_APPROVAL_MODE",
            message: "selfApprovalMode must be OWN_STEP or THROUGH_HIGHEST_STEP",
          },
        });
      }

      const flow = await ApprovalFlowService.updateFlow(flowId, {
        name,
        description,
        isDefault,
        isActive,
        selfApprovalMode,
        steps
      });

      return res.json({
        success: true,
        message: "Approval flow updated successfully",
        data: flow
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: {
          code: "UPDATE_FLOW_ERROR",
          message: error.message
        }
      });
    }
  }

  /**
   * DELETE /api/admin/approval-flows/:flowId
   * Delete approval flow
   */
  static async deleteFlow(req: Request, res: Response) {
    try {
      const flowId = Array.isArray(req.params.flowId) ? req.params.flowId[0] : req.params.flowId;

      await ApprovalFlowService.deleteFlow(flowId);

      return res.json({
        success: true,
        message: "Approval flow deleted successfully"
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: {
          code: "DELETE_FLOW_ERROR",
          message: error.message
        }
      });
    }
  }

  /**
   * POST /api/admin/approval-flows/:flowId/set-default
   * Set approval flow as default
   */
  static async setDefaultFlow(req: Request, res: Response) {
    try {
      const flowId = Array.isArray(req.params.flowId) ? req.params.flowId[0] : req.params.flowId;

      const flow = await ApprovalFlowService.setDefaultFlow(flowId);

      return res.json({
        success: true,
        message: "Approval flow set as default",
        data: flow
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: {
          code: "SET_DEFAULT_ERROR",
          message: error.message
        }
      });
    }
  }

  /**
   * GET /api/admin/approval-flows/default
   * Get default approval flow
   */
  static async getDefaultFlow(req: Request, res: Response) {
    try {
      const flow = await ApprovalFlowService.getDefaultFlow();

      return res.json({
        success: true,
        data: flow
      });
    } catch (error: any) {
      return res.status(404).json({
        success: false,
        error: {
          code: "DEFAULT_FLOW_NOT_FOUND",
          message: error.message
        }
      });
    }
  }

  /**
   * GET /api/admin/approval-flows/roles/:roleId/users
   * Get active users by role (dropdown support)
   */
  static async getUsersByRole(req: Request, res: Response) {
    try {
      const roleId = Array.isArray(req.params.roleId)
        ? req.params.roleId[0]
        : req.params.roleId;

      if (!roleId) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_INPUT",
            message: "roleId is required",
          },
        });
      }

      const users = await ApprovalFlowService.getUsersByRoleId(roleId);

      return res.status(200).json({
        success: true,
        data: users,
        message: "Users by role loaded",
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: {
          code: "GET_USERS_BY_ROLE_ERROR",
          message: error.message,
        },
      });
    }
  }
}
