import { Request, Response } from "express";
import { ApprovalFlowService } from "./approval.flow.service";

export class ApprovalFlowController {
  /**
   * POST /api/admin/approval-flows
   * Create new approval flow
   */
  static async createFlow(req: Request, res: Response) {
    try {
      const { name, description, isDefault, steps } = req.body;

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
      for (let i = 0; i < sortedSteps.length; i++) {
        if (!sortedSteps[i].role) {
          return res.status(400).json({
            success: false,
            error: {
              code: "INVALID_STEPS",
              message: `Step ${i + 1}: role is required`
            }
          });
        }
      }

      const flow = await ApprovalFlowService.createFlow({
        name,
        description,
        isDefault: isDefault || false,
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
      const { name, description, isDefault, isActive, steps } = req.body;

      const flow = await ApprovalFlowService.updateFlow(flowId, {
        name,
        description,
        isDefault,
        isActive,
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
}
