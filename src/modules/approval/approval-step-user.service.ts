import prisma from "../../config/prisma";

interface AssignUsersInput {
  stepId: string;
  userIds: string[];  // List of user IDs to assign
}

export class ApprovalStepUserService {
  /**
   * Assign specific users to an approval step
   */
  static async assignUsersToStep(stepId: string, userIds: string[]) {
    try {
      // Verify step exists
      const step = await (prisma as any).approvalStep.findUnique({
        where: { id: stepId }
      });

      if (!step) {
        throw new Error(`Approval step not found`);
      }

      // Verify all users exist
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } }
      });

      if (users.length !== userIds.length) {
        throw new Error(`One or more users not found`);
      }

      // Delete existing assignments
      await (prisma as any).approvalStepUser.deleteMany({
        where: { stepId }
      });

      // Create new assignments
      const assignments = await Promise.all(
        userIds.map((userId) =>
          (prisma as any).approvalStepUser.create({
            data: {
              stepId,
              userId
            },
            include: { user: { select: { id: true, name: true, email: true } } }
          })
        )
      );

      // Update step to use specific users
      await (prisma as any).approvalStep.update({
        where: { id: stepId },
        data: { useSpecificUsers: true }
      });

      return {
        stepId,
        assignedUsers: assignments.map((a: any) => a.user),
        count: assignments.length
      };
    } catch (error: any) {
      throw new Error(`Failed to assign users: ${error.message}`);
    }
  }

  /**
   * Get users assigned to an approval step
   */
  static async getAssignedUsers(stepId: string) {
    try {
      const assignments = await (prisma as any).approvalStepUser.findMany({
        where: { stepId },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: { select: { name: true } } }
          }
        }
      });

      return assignments.map((a: any) => ({
        assignmentId: a.id,
        userId: a.user.id,
        name: a.user.name,
        email: a.user.email,
        role: a.user.role?.name
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch assigned users: ${error.message}`);
    }
  }

  /**
   * Remove user from approval step
   */
  static async removeUserFromStep(stepId: string, userId: string) {
    try {
      const assignment = await (prisma as any).approvalStepUser.findUnique({
        where: {
          stepId_userId: {
            stepId,
            userId
          }
        }
      });

      if (!assignment) {
        throw new Error(`User not assigned to this step`);
      }

      await (prisma as any).approvalStepUser.delete({
        where: {
          stepId_userId: {
            stepId,
            userId
          }
        }
      });

      // Check if any users remain
      const remainingCount = await (prisma as any).approvalStepUser.count({
        where: { stepId }
      });

      // If no users remain, toggle back to role-based
      if (remainingCount === 0) {
        await (prisma as any).approvalStep.update({
          where: { id: stepId },
          data: { useSpecificUsers: false }
        });
      }

      return { success: true, message: "User removed from approval step" };
    } catch (error: any) {
      throw new Error(`Failed to remove user: ${error.message}`);
    }
  }

  /**
   * Clear all user assignments from a step (revert to role-based)
   */
  static async clearAssignments(stepId: string) {
    try {
      await (prisma as any).approvalStepUser.deleteMany({
        where: { stepId }
      });

      await (prisma as any).approvalStep.update({
        where: { id: stepId },
        data: { useSpecificUsers: false }
      });

      return { success: true, message: "Assignments cleared" };
    } catch (error: any) {
      throw new Error(`Failed to clear assignments: ${error.message}`);
    }
  }

  /**
   * Get users by role (for frontend dropdown)
   * Returns all active users with selected role
   */
  static async getUsersByRole(roleId: string) {
    try {
      const users = await prisma.user.findMany({
        where: {
          roleId,
          isActive: true
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: { select: { name: true } }
        },
        orderBy: { name: "asc" }
      });

      return users;
    } catch (error: any) {
      throw new Error(`Failed to fetch users by role: ${error.message}`);
    }
  }

  /**
   * Add single user to step (append, don't replace)
   */
  static async addUserToStep(stepId: string, userId: string) {
    try {
      const step = await (prisma as any).approvalStep.findUnique({
        where: { id: stepId }
      });

      if (!step) {
        throw new Error(`Approval step not found`);
      }

      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error(`User not found`);
      }

      // Check if already assigned
      const existing = await (prisma as any).approvalStepUser.findUnique({
        where: {
          stepId_userId: {
            stepId,
            userId
          }
        }
      });

      if (existing) {
        throw new Error(`User already assigned to this step`);
      }

      const assignment = await (prisma as any).approvalStepUser.create({
        data: {
          stepId,
          userId
        },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: { select: { name: true } } }
          }
        }
      });

      // Ensure flag is set
      if (!step.useSpecificUsers) {
        await (prisma as any).approvalStep.update({
          where: { id: stepId },
          data: { useSpecificUsers: true }
        });
      }

      return {
        assignmentId: assignment.id,
        user: assignment.user
      };
    } catch (error: any) {
      throw new Error(`Failed to add user: ${error.message}`);
    }
  }
}
