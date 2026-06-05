import prisma from "../../config/prisma";
import { ProjectStatus, ApprovalLevel } from "@prisma/client";

export class ApprovalService {
  private normalizeStepMode(mode: string | null | undefined): "SEQUENTIAL" | "PARALLEL" {
    return mode === "SEQUENTIAL" ? "SEQUENTIAL" : "PARALLEL";
  }

  private async resolveStepApproverIds(step: any): Promise<string[]> {
    if (step.useSpecificUsers) {
      const specificIds = (step.assignedUsers || [])
        .map((assignment: any) => assignment.userId)
        .filter(Boolean);

      if (specificIds.length === 0) {
        throw new Error(
          `Step ${step.order} is configured to use specific users but none are assigned`
        );
      }

      const users = await prisma.user.findMany({
        where: {
          id: { in: specificIds },
          isActive: true,
        },
        select: { id: true },
      });

      if (users.length === 0) {
        throw new Error(`No active assigned users found for step ${step.order}`);
      }

      return users.map((user) => user.id);
    }

    const roleApprovers = await this.getUsersByRoleInFlow(step.role);
    if (roleApprovers.length === 0) {
      throw new Error(
        `No users found with role "${step.role}" for approval flow step ${step.order}`
      );
    }

    return roleApprovers.map((u) => u.id);
  }

  private async getCurrentPendingOrder(projectId: string): Promise<number | null> {
    const firstPending = await prisma.projectApproval.findFirst({
      where: { projectId, status: "PENDING" },
      orderBy: { order: "asc" },
      select: { order: true },
    });

    return firstPending?.order ?? null;
  }

  private async applyPostApprovalTransition(projectId: string): Promise<ProjectStatus | null> {
    const remainingPending = await prisma.projectApproval.findMany({
      where: { projectId, status: "PENDING" },
      select: { order: true, level: true, approver: { select: { id: true } } },
      orderBy: { order: "asc" },
    });

    if (remainingPending.length === 0) {
      return "ACTIVE";
    }

    const nextOrder = remainingPending[0].order;
    const nextLevel = remainingPending[0].level;

    const nextStatus: ProjectStatus = nextLevel === "OP" ? "FOR_APPROVAL" : "FOR_REVIEW";

    const nextApprovers = remainingPending
      .filter((approval) => approval.order === nextOrder)
      .map((approval) => approval.approver.id);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, versionNumber: true },
    });

    if (project) {
      for (const userId of nextApprovers) {
        await this.notifyApprover(
          userId,
          projectId,
          `Project "${project.name}" (v${project.versionNumber}) is pending your approval (Step ${nextOrder}: ${nextLevel})`
        );
      }
    }

    return nextStatus;
  }

  private async buildStepExecutionState(projectId: string): Promise<
    Record<number, { mode: "SEQUENTIAL" | "PARALLEL"; approvedIds: string[]; pendingIds: string[] }>
  > {
    const approvals = await prisma.projectApproval.findMany({
      where: { projectId },
      select: {
        order: true,
        approverId: true,
        status: true,
        project: {
          select: {
            approvalFlow: {
              select: {
                steps: {
                  select: {
                    order: true,
                    stepExecutionMode: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const first = approvals[0];
    const modeByOrder = new Map<number, "SEQUENTIAL" | "PARALLEL">();
    const steps = first?.project?.approvalFlow?.steps || [];
    for (const step of steps) {
      modeByOrder.set(step.order, this.normalizeStepMode(step.stepExecutionMode));
    }

    const state: Record<
      number,
      { mode: "SEQUENTIAL" | "PARALLEL"; approvedIds: string[]; pendingIds: string[] }
    > = {};

    for (const approval of approvals) {
      if (!state[approval.order]) {
        state[approval.order] = {
          mode: modeByOrder.get(approval.order) || "PARALLEL",
          approvedIds: [],
          pendingIds: [],
        };
      }

      if (approval.status === "APPROVED") {
        state[approval.order].approvedIds.push(approval.approverId);
      }

      if (approval.status === "PENDING") {
        state[approval.order].pendingIds.push(approval.approverId);
      }
    }

    return state;
  }

  /**
   * Check if approval system is enabled
   */
  async isApprovalEnabled(): Promise<boolean> {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "approval_enabled" },
    });

    return setting ? setting.value === "true" : true; // Default to enabled
  }

  /**
   * Validate project has required scopes/tasks before submission
   */
  async validateProjectForSubmission(projectId: string): Promise<string | null> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { scopes: { include: { tasks: true } } },
    });

    if (!project) {
      return "Project not found";
    }

    if (project.scopes.length === 0) {
      return "Project must have at least one scope before submission";
    }

    const hasAtLeastOneTask = project.scopes.some((scope: any) => scope.tasks.length > 0);
    if (!hasAtLeastOneTask) {
      return "Project must have at least one task before submission";
    }

    return null; // Valid
  }

  /**
   * Determine BU Heads dynamically by querying users with BU_HEAD role
   */
  async determineBUHeads(): Promise<any[]> {
    const buHeadRole = await prisma.role.findUnique({
      where: { name: "BU_HEAD" },
    });

    if (!buHeadRole) {
      return [];
    }

    return await prisma.user.findMany({
      where: {
        roleId: buHeadRole.id,
        isActive: true,
      },
    });
  }

  /**
   * Check if user is a BU Head
   */
  async isUserBUHead(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    return user?.role?.name === "BU_HEAD";
  }

  /**
   * Check if all BU Head approvals are APPROVED
   */
  async checkAllBUHeadsApproved(projectId: string): Promise<boolean> {
    const buApprovals = await prisma.projectApproval.findMany({
      where: {
        projectId,
        level: "BU_HEAD",
      },
    });

    if (buApprovals.length === 0) {
      return true; // No BU approvals needed
    }

      return buApprovals.every((a: any) => a.status === "APPROVED");
  }

  /**
   * Check if any BU Head has rejected
   */
  async hasBUHeadRejected(projectId: string): Promise<boolean> {
    const rejection = await prisma.projectApproval.findFirst({
      where: {
        projectId,
        level: "BU_HEAD",
        status: "REJECTED",
      },
    });

    return !!rejection;
  }

  /**
   * Submit project for approval using configured approval flow
   */
  async submitProjectForApprovalUsingFlow(projectId: string, userId: string): Promise<any> {
    // Validate project
    const validationError = await this.validateProjectForSubmission(projectId);
    if (validationError) {
      throw new Error(validationError);
    }

    const project = await (prisma.project.findUnique as any)({
      where: { id: projectId },
      include: {
        owner: { include: { role: true } },
        approvalFlow: {
          include: {
            steps: {
              orderBy: { order: "asc" },
              include: { assignedUsers: true },
            },
          },
        }
      }
    });

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.status !== "DRAFT" && project.status !== "NEEDS_REVISION") {
      throw new Error(
        "Project must be in DRAFT or NEEDS_REVISION status to submit"
      );
    }

    // Check if approval is disabled for this project
    if (!(project as any).approvalEnabled) {
      // Archive old versions if this is a new version
      if (project.rootProjectId) {
        await prisma.project.updateMany({
          where: {
            rootProjectId: project.rootProjectId,
            NOT: { id: projectId },
          },
          data: {
            status: "ARCHIVED" as ProjectStatus,
            isActive: false,
            isLatestVersion: false,
            isLocked: true,
          },
        });
      }

      // Auto-approve: skip workflow, activate project directly
      const updated = await prisma.project.update({
        where: { id: projectId },
        data: {
          status: "ACTIVE",
          isActive: true,
          isLatestVersion: true,
        }
      });

      // Log audit
      await this.logApprovalAction(
        projectId,
        userId,
        "SUBMITTED",
        project.status,
        "ACTIVE",
        null,
        "Auto-approved (approval disabled for this project)"
      );

      // Notify PIC
      await this.notifyProjectOwner(
        projectId,
        "Project auto-approved (approval is disabled)",
        "APPROVED"
      );

      return updated;
    }

    // Check if approval system is enabled globally
    const approvalEnabled = await this.isApprovalEnabled();
    if (!approvalEnabled) {
      // Archive old versions if this is a new version
      if (project.rootProjectId) {
        await prisma.project.updateMany({
          where: {
            rootProjectId: project.rootProjectId,
            NOT: { id: projectId },
          },
          data: {
            status: "ARCHIVED" as ProjectStatus,
            isActive: false,
            isLatestVersion: false,
            isLocked: true,
          },
        });
      }

      // Auto-approve: skip workflow, activate project directly
      const updated = await prisma.project.update({
        where: { id: projectId },
        data: {
          status: "ACTIVE",
          isActive: true,
          isLatestVersion: true,
        }
      });

      // Log audit
      await this.logApprovalAction(
        projectId,
        userId,
        "SUBMITTED",
        project.status,
        "ACTIVE",
        null,
        "Auto-approved (system has approval disabled)"
      );

      // Notify PIC
      await this.notifyProjectOwner(
        projectId,
        "Project auto-approved (system has approval disabled)",
        "APPROVED"
      );

      return updated;
    }

    // Delete old approvals if resubmitting (from NEEDS_REVISION)
    if (project.status === "NEEDS_REVISION") {
      await prisma.projectApproval.deleteMany({
        where: { projectId }
      });
    }

    // Get approval flow (use project's assigned flow or default)
    let flow = (project as any).approvalFlow;

    if (!flow) {
      // Use default flow
      flow = await (prisma as any).approvalFlow.findFirst({
        where: { isDefault: true, isActive: true },
        include: {
          steps: {
            orderBy: { order: "asc" },
            include: { assignedUsers: true },
          },
        }
      });

      if (!flow) {
        throw new Error("No approval flow available. Please configure a default flow.");
      }

      // Assign default flow to project
      await (prisma.project.update as any)({
        where: { id: projectId },
        data: { approvalFlowId: flow.id }
      });
    }

    // Create approvals based on flow steps
    const createdApprovals: any[] = [];

    for (const step of flow.steps) {
      const approverIds = await this.resolveStepApproverIds(step);

      if (approverIds.length === 0) {
        throw new Error(`No approvers configured for step ${step.order}`);
      }

      for (const approverId of approverIds) {
        const approval = await prisma.projectApproval.create({
          data: {
            projectId,
            approverId,
            level: step.role as ApprovalLevel,  // Cast to ApprovalLevel enum
            order: step.order,
            status: "PENDING",
            isFinal: step.order === flow.steps.length
          },
          include: { approver: true }
        });

        createdApprovals.push(approval);

        // Notify approver
        await this.notifyApprover(
          approverId,
          projectId,
          `Project "${project.name}" (v${project.versionNumber}) is pending your approval (Step ${step.order}: ${step.role})`
        );
      }
    }

    // Update project status to FOR_REVIEW (first step) or FOR_APPROVAL (if skipping)
    const firstStep = flow.steps[0];
    const nextStatus = firstStep.role === "OP" ? "FOR_APPROVAL" : "FOR_REVIEW";

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        status: nextStatus as ProjectStatus
      }
    });

    // Log audit
    await this.logApprovalAction(
      projectId,
      userId,
      "SUBMITTED",
      project.status,
      nextStatus as ProjectStatus,
      null,
      `Submitted using flow: ${flow.name}`
    );

    return {
      project: updated,
      approvals: createdApprovals,
      flow: {
        id: flow.id,
        name: flow.name,
        steps: flow.steps.map((s: any) => ({
          order: s.order,
          role: s.role,
          stepExecutionMode: this.normalizeStepMode(s.stepExecutionMode),
          useSpecificUsers: !!s.useSpecificUsers,
        }))
      }
    };
  }

  /**
   * Get users with specific role for approval
   */
  async getUsersByRoleInFlow(role: string): Promise<any[]> {
    // Try direct role match first
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
  }

  /**
   * Submit project for approval (delegates to flow-based method)
   */
  async submitProjectForApproval(projectId: string, userId: string): Promise<any> {
    // Use the new flow-based system
    return await this.submitProjectForApprovalUsingFlow(projectId, userId);
  }

  /**
   * Approve project at current level
   */
  async approveProject(projectId: string, approverId: string): Promise<any> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { owner: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    const currentOrder = await this.getCurrentPendingOrder(projectId);

    // Find the approval record for this approver
    const approval = await prisma.projectApproval.findFirst({
      where: {
        projectId,
        approverId,
        status: "PENDING",
      },
    });

    if (!approval) {
      throw new Error("No pending approval found for this approver");
    }

    const step = await prisma.approvalStep.findFirst({
      where: {
        flowId: project.approvalFlowId || undefined,
        order: approval.order,
      },
      select: {
        stepExecutionMode: true,
      },
    });

    const stepMode = this.normalizeStepMode(step?.stepExecutionMode);

    if (currentOrder !== null && approval.order !== currentOrder) {
      throw new Error("This approval step is not active yet");
    }

    if (stepMode === "SEQUENTIAL") {
      const earlierPendingInStep = await prisma.projectApproval.findFirst({
        where: {
          projectId,
          order: approval.order,
          status: "PENDING",
          createdAt: { lt: approval.createdAt },
        },
      });

      if (earlierPendingInStep) {
        throw new Error("This step is sequential. Please wait for the previous approver in this step.");
      }
    }

    // Update approval
    const updatedApproval = await prisma.projectApproval.update({
      where: { id: approval.id },
      data: {
        status: "APPROVED",
        actedAt: new Date(),
      },
    });

    const postStatus = await this.applyPostApprovalTransition(projectId);
    const newProjectStatus = postStatus || project.status;

    if (newProjectStatus === "ACTIVE") {
      if (project.rootProjectId) {
        await prisma.project.updateMany({
          where: {
            rootProjectId: project.rootProjectId,
            NOT: { id: projectId },
          },
          data: {
            status: "ARCHIVED" as ProjectStatus,
            isActive: false,
            isLatestVersion: false,
            isLocked: true,
          },
        });
      }

      await prisma.project.update({
        where: { id: projectId },
        data: {
          isActive: true,
          isLatestVersion: true,
        },
      });

      await this.notifyProjectOwner(
        projectId,
        `Project "${project.name}" (v${project.versionNumber}) has been approved and activated!`,
        "APPROVED"
      );
    }

    // Update project status
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: { status: newProjectStatus as ProjectStatus },
    });

    // Log audit
    await this.logApprovalAction(
      projectId,
      approverId,
      "APPROVED",
      project.status,
      newProjectStatus as ProjectStatus,
      approval.level
    );

    return {
      project: updatedProject,
      approval: updatedApproval,
    };
  }

  /**
   * Reject project at current level
   */
  async rejectProject(
    projectId: string,
    approverId: string,
    remarks: string
  ): Promise<any> {
    if (!remarks || remarks.trim() === "") {
      throw new Error("Rejection remarks are required");
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    // Find the approval record
    const approval = await prisma.projectApproval.findFirst({
      where: {
        projectId,
        approverId,
        status: "PENDING",
      },
    });

    if (!approval) {
      throw new Error("No pending approval found for this approver");
    }

    // Update approval
    const updatedApproval = await prisma.projectApproval.update({
      where: { id: approval.id },
      data: {
        status: "REJECTED",
        remarks,
        actedAt: new Date(),
      },
    });

    // Set project to NEEDS_REVISION
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: {
        status: "NEEDS_REVISION",
      },
    });

    // Log audit
    await this.logApprovalAction(
      projectId,
      approverId,
      "REJECTED",
      project.status,
      "NEEDS_REVISION",
      approval.level,
      remarks
    );

    // Notify PIC of rejection
    await this.notifyProjectOwner(
      projectId,
      `Project "${project.name}" (v${project.versionNumber}) was rejected during ${approval.level === "BU_HEAD" ? "BU Head" : "OP"} approval. Reason: ${remarks}`,
      "REJECTED"
    );

    return {
      project: updatedProject,
      approval: updatedApproval,
    };
  }

  /**
   * Get all approvals for a project
   */
  async getProjectApprovals(projectId: string): Promise<any[]> {
    return await prisma.projectApproval.findMany({
      where: { projectId },
      include: {
        approver: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { order: "asc" },
    });
  }

  /**
   * Get pending approvals for user
   */
  async getPendingApprovalsForUser(userId: string): Promise<any[]> {
    return await prisma.projectApproval.findMany({
      where: {
        approverId: userId,
        status: "PENDING",
      },
      include: {
        project: {
          select: { id: true, name: true, pin: true, versionNumber: true, status: true },
        },
      },
    });
  }

  /**
   * Get approval audit log for a project
   */
  async getApprovalAuditLog(projectId: string): Promise<any[]> {
    return await prisma.approvalAuditLog.findMany({
      where: { projectId },
      include: {
        approver: {
          select: {
            id: true,
            name: true,
            email: true,
            role: {
              select: { name: true }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  /**
   * Log approval action to audit trail
   */
  private async logApprovalAction(
    projectId: string,
    approverId: string,
    action: string,
    previousStatus: ProjectStatus,
    newStatus: ProjectStatus,
    level: ApprovalLevel | null,
    remarks?: string
  ): Promise<void> {
    try {
      await prisma.approvalAuditLog.create({
        data: {
          projectId,
          approverId,
          action,
          level: level || "BU_HEAD",
          previousStatus,
          newStatus,
          remarks: remarks || null,
        },
      });
    } catch (error) {
      console.error("Failed to log approval action:", error);
      // Don't throw - logging shouldn't block the approval flow
    }
  }

  /**
   * Send notification to approver
   */
  private async notifyApprover(
    userId: string,
    projectId: string,
    message: string
  ): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          userId,
          type: "APPROVAL_PENDING",
          message,
          isRead: false,
        },
      });
    } catch (error) {
      console.error("Failed to create notification:", error);
    }
  }

  /**
   * Send notification to project owner
   */
  private async notifyProjectOwner(
    projectId: string,
    message: string,
    type: string
  ): Promise<void> {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) return;

      await prisma.notification.create({
        data: {
          userId: project.ownerId,
          type,
          message,
          isRead: false,
        },
      });
    } catch (error) {
      console.error("Failed to create notification:", error);
    }
  }

  /**
   * Get pending projects for current user's approval
   * Respects sequential approval flow - user only sees projects when it's their turn
   * 
   * Example Flow: BU_HEAD (order=1) → FINANCE (order=2) → OP (order=3)
   * - BU_HEAD sees it immediately (order=1, no previous approvals needed)
   * - FINANCE only sees it after BU_HEAD approves (all order<2 must be APPROVED)
   * - OP only sees it after FINANCE approves (all order<3 must be APPROVED)
   */
  async getPendingProjectsForApproval(userId: string): Promise<any[]> {
    try {
      // Step 1: Get all PENDING approvals for this user
      const pendingApprovals = await prisma.projectApproval.findMany({
        where: {
          approverId: userId,
          status: "PENDING"
        },
        include: {
          project: true
        },
        orderBy: [{ createdAt: 'desc' }]
      });

      if (pendingApprovals.length === 0) {
        return [];
      }

      // Step 2: Filter pending approvals to those currently actionable for this user.
      const eligibleApprovals: any[] = [];

      for (const currentApproval of pendingApprovals) {
        const stepState = await this.buildStepExecutionState(currentApproval.projectId);

        const previousOrders = Object.keys(stepState)
          .map((k) => Number(k))
          .filter((order) => order < currentApproval.order);

        const allPreviousOrdersDone = previousOrders.every((order) => {
          const state = stepState[order];
          return state.pendingIds.length === 0;
        });

        if (!allPreviousOrdersDone) {
          continue;
        }

        const currentStepState = stepState[currentApproval.order];
        if (!currentStepState) {
          continue;
        }

        if (currentStepState.mode === "SEQUENTIAL") {
          const createdInOrder = await prisma.projectApproval.findMany({
            where: {
              projectId: currentApproval.projectId,
              order: currentApproval.order,
            },
            select: {
              approverId: true,
              status: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          });

          const firstPending = createdInOrder.find((item) => item.status === "PENDING");
          if (!firstPending || firstPending.approverId !== userId) {
            continue;
          }
        }

        const previousApprovals = await prisma.projectApproval.findMany({
          where: {
            projectId: currentApproval.projectId,
            order: { lt: currentApproval.order }
          }
        });

        const allPreviousApproved = previousApprovals.every((approval: any) => {
          return approval.status === "APPROVED";
        });

        if (allPreviousApproved) {
          eligibleApprovals.push(currentApproval);
        }
      }

      if (eligibleApprovals.length === 0) {
        return [];
      }

      // Step 3: Extract unique project IDs
      const projectIds = Array.from(new Set(eligibleApprovals.map((a: any) => a.projectId))) as string[];

      // Step 4: Fetch FULL project data with all relationships
      const projects = await prisma.project.findMany({
        where: {
          id: { in: projectIds }
        },
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          projectMembers: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            }
          },
          scopes: {
            include: {
              tasks: true
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }]
      });

      // Step 5: Enrich projects with approval metadata
      // Add the approval level, order, and ID so frontend knows what role is approving
      const enrichedProjects = projects.map((project: any) => {
        const approval = eligibleApprovals.find((a: any) => a.projectId === project.id);
        return {
          ...project,
          // Approval metadata:
          pendingApprovalId: approval?.id,
          pendingApprovalLevel: approval?.level,
          pendingApprovalOrder: approval?.order,
          pendingApprovalIsFinal: approval?.isFinal
        };
      });

      return enrichedProjects;

    } catch (error: any) {
      console.error("❌ Error in getPendingProjectsForApproval:", error);
      throw new Error(`Failed to fetch pending projects: ${error.message}`);
    }
  }
}

export const approvalService = new ApprovalService();
