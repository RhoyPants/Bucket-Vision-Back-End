import prisma from "../../../config/prisma";

interface ApprovalStepInput {
  order: number;
  role?: string;
  approverSource?: "PROJECT_BU_HEAD" | "REQUESTER_BU_HEAD" | "ROLE" | "SPECIFIC_USERS";
  stepExecutionMode?: string;
  requiresAll?: number;
  canReject?: boolean;
  useSpecificUsers?: boolean;
  assignedUsers?: any[];
}

interface CreateApprovalFlowInput {
  name: string;
  description?: string;
  isDefault?: boolean;
  selfApprovalMode?: "OWN_STEP" | "THROUGH_HIGHEST_STEP";
  steps: ApprovalStepInput[];
}

interface UpdateApprovalFlowInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  selfApprovalMode?: "OWN_STEP" | "THROUGH_HIGHEST_STEP";
  steps?: ApprovalStepInput[];
}

export class ApprovalFlowService {
  private static normalizeAssignedUserIds(step: ApprovalStepInput): string[] {
    const raw = Array.isArray(step.assignedUsers) ? step.assignedUsers : [];

    const ids = raw
      .map((entry: any) => {
        if (typeof entry === "string") return entry;
        if (entry?.userId) return entry.userId;
        if (entry?.id) return entry.id;
        return null;
      })
      .filter(Boolean) as string[];

    return Array.from(new Set(ids));
  }

  private static buildStepCreateInput(step: ApprovalStepInput) {
    const assignedUserIds = this.normalizeAssignedUserIds(step);
    const useSpecificUsers = step.useSpecificUsers === true || assignedUserIds.length > 0;
    const approverSource =
      step.approverSource || (useSpecificUsers ? "SPECIFIC_USERS" : "ROLE");
    const validSources = [
      "PROJECT_BU_HEAD",
      "REQUESTER_BU_HEAD",
      "ROLE",
      "SPECIFIC_USERS",
    ];

    if (!validSources.includes(approverSource)) {
      throw new Error(`Invalid approverSource "${approverSource}" on step ${step.order}`);
    }

    if (approverSource === "SPECIFIC_USERS" && assignedUserIds.length === 0) {
      throw new Error(`Step ${step.order} requires at least one assigned user`);
    }

    if (approverSource === "ROLE" && !step.role) {
      throw new Error(`Step ${step.order} requires a role when approverSource is ROLE`);
    }

    return {
      order: step.order,
      role: step.role,
      stepExecutionMode: step.stepExecutionMode || "PARALLEL",
      requiresAll: step.requiresAll ?? 1,
      canReject: step.canReject ?? true,
      useSpecificUsers: approverSource === "SPECIFIC_USERS",
      approverSource,
      assignedUsers:
        assignedUserIds.length > 0
          ? {
              create: assignedUserIds.map((userId) => ({ userId })),
            }
          : undefined,
    };
  }

  private static stepInclude = {
    orderBy: { order: "asc" },
    include: {
      assignedUsers: {
        include: {
          user: {
            select: { id: true, name: true, email: true, role: { select: { id: true, name: true } } },
          },
        },
      },
    },
  } as const;

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
          selfApprovalMode: data.selfApprovalMode || "THROUGH_HIGHEST_STEP",
          steps: {
            create: data.steps.map((step) => this.buildStepCreateInput(step))
          }
        },
        include: { steps: this.stepInclude }
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
        include: {
          steps: this.stepInclude,
        },
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
        include: {
          steps: this.stepInclude,
        }
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
          selfApprovalMode: data.selfApprovalMode,
          steps: data.steps
            ? {
                create: data.steps.map((step) => this.buildStepCreateInput(step))
              }
            : undefined
        },
        include: {
          steps: this.stepInclude,
        }
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
        include: {
          steps: this.stepInclude,
        }
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

  static async getUsersByRoleId(roleId: string) {
    try {
      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          roleId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
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
        include: {
          steps: this.stepInclude,
        }
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
          approvalFlow: {
            include: {
              steps: this.stepInclude,
            },
          }
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
          approvalFlow: {
            include: {
              steps: this.stepInclude,
            },
          }
        }
      });

      return updated;
    } catch (error: any) {
      throw new Error(`Failed to toggle project approval: ${error.message}`);
    }
  }
}
