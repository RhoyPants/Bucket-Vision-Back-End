import { Request, Response } from "express";
import { ApprovalFlowService } from "../approval-flows/approval.flow.service";
import prisma from "../../../config/prisma";

export class AdminProjectApprovalController {
  /**
   * PATCH /api/admin/projects/:projectId/approval-config
   * Configure project approval workflow (assign flow or disable)
   */
  static async configureProjectApproval(req: Request, res: Response) {
    try {
      const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
      const { approvalFlowId, approvalEnabled } = req.body;

      // Get project
      const project = await prisma.project.findUnique({
        where: { id: projectId }
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          error: {
            code: "PROJECT_NOT_FOUND",
            message: "Project not found"
          }
        });
      }

      // If assigning flow, verify it exists
      if (approvalFlowId) {
        const flow = await prisma.approvalFlow.findUnique({
          where: { id: approvalFlowId },
          include: { steps: { orderBy: { order: "asc" } } }
        });

        if (!flow) {
          return res.status(400).json({
            success: false,
            error: {
              code: "FLOW_NOT_FOUND",
              message: "Approval flow not found"
            }
          });
        }

        if (!flow.isActive) {
          return res.status(400).json({
            success: false,
            error: {
              code: "FLOW_INACTIVE",
              message: "Cannot assign inactive approval flow"
            }
          });
        }
      }

      // Determine the resolved approvalFlowId being set
      const resolvedFlowId =
        approvalFlowId !== undefined
          ? approvalFlowId || null
          : project.approvalFlowId;

      // Detect flow-removal: explicitly passing null/undefined to clear the flow
      const isRemovingFlow =
        approvalFlowId !== undefined && !approvalFlowId;

      // Auto-activate when:
      //  (a) flow is being removed, OR
      //  (b) approvalEnabled is explicitly set to false
      // In both cases, regardless of current project status
      const shouldAutoActivate =
        isRemovingFlow || approvalEnabled === false;

      // Update project
      const updateData: any = {
        approvalFlowId: resolvedFlowId,
        approvalEnabled:
          approvalEnabled !== undefined
            ? approvalEnabled
            : isRemovingFlow
            ? false
            : project.approvalEnabled,
      };

      let autoActivated = false;

      if (shouldAutoActivate) {
        updateData.status = "ACTIVE";
        updateData.isActive = true;
        updateData.isLatestVersion = true;
        autoActivated = true;

        // Cancel all pending approval records for this project
        await prisma.projectApproval.updateMany({
          where: { projectId, status: "PENDING" },
          data: {
            status: "APPROVED",
            remarks: isRemovingFlow
              ? "Auto-approved: approval flow removed by admin"
              : "Auto-approved: approval disabled by admin",
          },
        });

        // Archive all previous versions under the same root project,
        // including the root record itself when rootProjectId is null.
        const rootId = project.rootProjectId ?? project.id;
        await prisma.project.updateMany({
          where: {
            AND: [
              {
                OR: [
                  { id: rootId },
                  { rootProjectId: rootId },
                ],
              },
              { NOT: { id: projectId } },
            ],
          },
          data: {
            status: "ARCHIVED",
            isActive: false,
            isLatestVersion: false,
            isLocked: true,
          },
        });
      }

      const updated = await prisma.project.update({
        where: { id: projectId },
        data: updateData,
        include: {
          approvalFlow: {
            include: { steps: { orderBy: { order: "asc" } } }
          }
        }
      });

      return res.json({
        success: true,
        message: autoActivated
          ? isRemovingFlow
            ? "Approval flow removed - project has been automatically activated"
            : "Approval disabled - project has been automatically activated"
          : "Project approval configuration updated successfully",
        data: {
          projectId: updated.id,
          projectName: updated.name,
          projectStatus: updated.status,
          approvalEnabled: updated.approvalEnabled,
          autoActivated,
          approvalFlow: updated.approvalFlow
            ? {
                id: updated.approvalFlow.id,
                name: updated.approvalFlow.name,
                steps: updated.approvalFlow.steps.map((s: any) => ({
                  order: s.order,
                  role: s.role,
                  stepExecutionMode: s.stepExecutionMode,
                  requiresAll: s.requiresAll,
                  canReject: s.canReject
                }))
              }
            : null
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: {
          code: "CONFIG_ERROR",
          message: error.message || "Failed to configure project approval"
        }
      });
    }
  }

  /**
   * GET /api/admin/projects/:projectId/approval-config
   * Get project approval configuration
   */
  static async getProjectApprovalConfig(req: Request, res: Response) {
    try {
      const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          approvalFlow: {
            include: { steps: { orderBy: { order: "asc" } } }
          }
        }
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          error: {
            code: "PROJECT_NOT_FOUND",
            message: "Project not found"
          }
        });
      }

      return res.json({
        success: true,
        data: {
          projectId: project.id,
          projectName: project.name,
          approvalEnabled: project.approvalEnabled,
          currentApprovalFlow: project.approvalFlow
            ? {
                id: project.approvalFlow.id,
                name: project.approvalFlow.name,
                isDefault: project.approvalFlow.isDefault,
                steps: project.approvalFlow.steps.map((s: any) => ({
                  order: s.order,
                  role: s.role,
                  stepExecutionMode: s.stepExecutionMode,
                  requiresAll: s.requiresAll,
                  canReject: s.canReject
                }))
              }
            : null
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: {
          code: "FETCH_ERROR",
          message: error.message || "Failed to fetch project approval config"
        }
      });
    }
  }
}
