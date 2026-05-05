import prisma from "../../config/prisma";

interface ApprovalStepInput {
  order: number;
  role: string;
  requiresAll?: number;
  canReject?: boolean;
}

interface CreateApprovalFlowInput {
  name: string;
  description?: string;
  isDefault?: boolean;
  steps: ApprovalStepInput[];
}

interface UpdateApprovalFlowInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  steps?: ApprovalStepInput[];
}

export class ApprovalFlowService {
  /**
   * Create a new approval flow with steps
   */
  static async createFlow(data: CreateApprovalFlowInput) {
    try {
      // Check if name already exists
      const existing = await (prisma as any).approvalFlow.findUnique({
        where: { name: data.name }
      });

      if (existing) {
        throw new Error(`Approval flow "${data.name}" already exists`);
      }

      // If marking as default, unset others
      if (data.isDefault) {
        await (prisma as any).approvalFlow.updateMany({
          where: { isDefault: true },
          data: { isDefault: false }
        });
      }

      // Create flow with steps
      const flow = await (prisma as any).approvalFlow.create({
        data: {
          name: data.name,
          description: data.description,
          isDefault: data.isDefault || false,
          steps: {
            create: data.steps.map((step) => ({
              order: step.order,
              role: step.role,
              requiresAll: step.requiresAll ?? 1,
              canReject: step.canReject ?? true
            }))
          }
        },
        include: { steps: { orderBy: { order: "asc" } } }
      });

      return flow;
    } catch (error: any) {
      throw new Error(`Failed to create approval flow: ${error.message}`);
    }
  }

  /**
   * Get all approval flows
   */
  static async getAllFlows(onlyActive = false) {
    try {
      const flows = await (prisma as any).approvalFlow.findMany({
        where: onlyActive ? { isActive: true } : undefined,
        include: { steps: { orderBy: { order: "asc" } } },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }]
      });

      return flows;
    } catch (error: any) {
      throw new Error(`Failed to fetch approval flows: ${error.message}`);
    }
  }

  /**
   * Get flow by ID
   */
  static async getFlowById(flowId: string) {
    try {
      const flow = await (prisma as any).approvalFlow.findUnique({
        where: { id: flowId },
        include: { steps: { orderBy: { order: "asc" } } }
      });

      if (!flow) {
        throw new Error(`Approval flow not found`);
      }

      return flow;
    } catch (error: any) {
      throw new Error(`Failed to fetch approval flow: ${error.message}`);
    }
  }

  /**
   * Update approval flow
   */
  static async updateFlow(flowId: string, data: UpdateApprovalFlowInput) {
    try {
      const flow = await (prisma as any).approvalFlow.findUnique({
        where: { id: flowId }
      });

      if (!flow) {
        throw new Error(`Approval flow not found`);
      }

      // Check if renaming to existing name
      if (data.name && data.name !== flow.name) {
        const existing = await (prisma as any).approvalFlow.findUnique({
          where: { name: data.name }
        });

        if (existing) {
          throw new Error(`Approval flow "${data.name}" already exists`);
        }
      }

      // If marking as default, unset others
      if (data.isDefault === true) {
        await (prisma as any).approvalFlow.updateMany({
          where: { isDefault: true, id: { not: flowId } },
          data: { isDefault: false }
        });
      }

      // Delete old steps if updating
      if (data.steps && data.steps.length > 0) {
        await (prisma as any).approvalStep.deleteMany({
          where: { flowId }
        });
      }

      // Update flow
      const updated = await (prisma as any).approvalFlow.update({
        where: { id: flowId },
        data: {
          name: data.name,
          description: data.description,
          isDefault: data.isDefault,
          isActive: data.isActive,
          steps: data.steps
            ? {
                create: data.steps.map((step) => ({
                  order: step.order,
                  role: step.role,
                  requiresAll: step.requiresAll ?? 1,
                  canReject: step.canReject ?? true
                }))
              }
            : undefined
        },
        include: { steps: { orderBy: { order: "asc" } } }
      });

      return updated;
    } catch (error: any) {
      throw new Error(`Failed to update approval flow: ${error.message}`);
    }
  }

  /**
   * Delete approval flow
   */
  static async deleteFlow(flowId: string) {
    try {
      const flow = await (prisma as any).approvalFlow.findUnique({
        where: { id: flowId },
        include: { _count: { select: { projects: true } } }
      });

      if (!flow) {
        throw new Error(`Approval flow not found`);
      }

      // Prevent deleting default flow if projects use it
      if (flow.isDefault && (flow._count.projects as any) > 0) {
        throw new Error(
          `Cannot delete default approval flow. Assign projects to another flow first.`
        );
      }

      // Delete flow (cascade will delete steps and unlink projects)
      await (prisma as any).approvalFlow.delete({
        where: { id: flowId }
      });

      return { success: true };
    } catch (error: any) {
      throw new Error(`Failed to delete approval flow: ${error.message}`);
    }
  }

  /**
   * Get default flow
   */
  static async getDefaultFlow() {
    try {
      const flow = await (prisma as any).approvalFlow.findFirst({
        where: { isDefault: true, isActive: true },
        include: { steps: { orderBy: { order: "asc" } } }
      });

      if (!flow) {
        throw new Error(`No default approval flow configured`);
      }

      return flow;
    } catch (error: any) {
      throw new Error(`Failed to fetch default approval flow: ${error.message}`);
    }
  }

  /**
   * Get users with specific role for approval flow
   */
  static async getUsersByRoleInFlow(role: string) {
    try {
      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          role: {
            name: role
          }
        },
        include: { role: true }
      });

      return users;
    } catch (error: any) {
      throw new Error(`Failed to fetch users by role: ${error.message}`);
    }
  }

  /**
   * Set default flow
   */
  static async setDefaultFlow(flowId: string) {
    try {
      const flow = await (prisma as any).approvalFlow.findUnique({
        where: { id: flowId }
      });

      if (!flow) {
        throw new Error(`Approval flow not found`);
      }

      // Unset all other defaults
      await (prisma as any).approvalFlow.updateMany({
        where: { isDefault: true, id: { not: flowId } },
        data: { isDefault: false }
      });

      // Set this one as default
      const updated = await (prisma as any).approvalFlow.update({
        where: { id: flowId },
        data: { isDefault: true },
        include: { steps: { orderBy: { order: "asc" } } }
      });

      return updated;
    } catch (error: any) {
      throw new Error(`Failed to set default flow: ${error.message}`);
    }
  }

  /**
   * Assign flow to project
   */
  static async assignFlowToProject(projectId: string, flowId: string) {
    try {
      const flow = await (prisma as any).approvalFlow.findUnique({
        where: { id: flowId }
      });

      if (!flow) {
        throw new Error(`Approval flow not found`);
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId }
      });

      if (!project) {
        throw new Error(`Project not found`);
      }

      const updated = await (prisma.project.update as any)({
        where: { id: projectId },
        data: {
          approvalFlowId: flowId,
          approvalEnabled: true
        },
        include: {
          approvalFlow: { include: { steps: { orderBy: { order: "asc" } } } }
        }
      });

      return updated;
    } catch (error: any) {
      throw new Error(`Failed to assign approval flow to project: ${error.message}`);
    }
  }

  /**
   * Toggle approval for project
   */
  static async toggleProjectApproval(projectId: string, enabled: boolean) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId }
      });

      if (!project) {
        throw new Error(`Project not found`);
      }

      const updated = await (prisma.project.update as any)({
        where: { id: projectId },
        data: { approvalEnabled: enabled },
        include: {
          approvalFlow: { include: { steps: { orderBy: { order: "asc" } } } }
        }
      });

      return updated;
    } catch (error: any) {
      throw new Error(`Failed to toggle project approval: ${error.message}`);
    }
  }
}
