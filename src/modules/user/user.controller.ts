import { Request, Response } from "express";
import prisma from "../../config/prisma";
import bcrypt from "bcrypt";

const deleteProjectCascade = async (tx: any, projectId: string) => {
  // Break project self-references first so parent/root constraints do not block deletes.
  await tx.project.updateMany({
    where: {
      OR: [{ parentProjectId: projectId }, { rootProjectId: projectId }],
    },
    data: {
      parentProjectId: null,
      rootProjectId: null,
    },
  });

  await tx.projectMember.deleteMany({ where: { projectId } });
  await tx.projectTimeline.deleteMany({ where: { projectId } });
  await tx.dailyReport.deleteMany({ where: { projectId } });
  await tx.weeklyReport.deleteMany({ where: { projectId } });
  await tx.attachment.deleteMany({ where: { projectId } });

  const scopeIds = (
    await tx.scope.findMany({
      where: { projectId },
      select: { id: true },
    })
  ).map((scope: any) => scope.id);

  if (scopeIds.length > 0) {
    const taskIds = (
      await tx.task.findMany({
        where: { scopeId: { in: scopeIds } },
        select: { id: true },
      })
    ).map((task: any) => task.id);

    if (taskIds.length > 0) {
      const subtaskIds = (
        await tx.subtask.findMany({
          where: { taskId: { in: taskIds } },
          select: { id: true },
        })
      ).map((subtask: any) => subtask.id);

      if (subtaskIds.length > 0) {
        await tx.activityLog.deleteMany({ where: { subtaskId: { in: subtaskIds } } });
        await tx.comment.deleteMany({ where: { subtaskId: { in: subtaskIds } } });
        await tx.checklist.deleteMany({ where: { subtaskId: { in: subtaskIds } } });
        await tx.subtaskAssignee.deleteMany({ where: { subtaskId: { in: subtaskIds } } });
        await tx.progressLog.deleteMany({ where: { subtaskId: { in: subtaskIds } } });
      }

      await tx.taskAssignee.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.subtask.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.task.deleteMany({ where: { scopeId: { in: scopeIds } } });
    }

    await tx.scope.deleteMany({ where: { projectId } });
  }

  await tx.project.delete({ where: { id: projectId } });
};

export const getUsers = async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    include: {
      role: true,
      businessUnit: {
        select: {
          id: true,
          code: true,
          name: true,
          entity: true,
          buHead: true,
        },
      },
    },
  });

  res.json(users);
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || "");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          select: {
            id: true,
            name: true,
            isActive: true,
          },
        },
        businessUnit: {
          select: {
            id: true,
            code: true,
            name: true,
            entity: true,
            buHead: true,
            assistantHead: true,
            isActive: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        message: "User not found",
        error: "USER_NOT_FOUND",
      });
    }

    return res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        company: user.company,
        role: user.role,
        businessUnit: user.businessUnit,
        buHead: user.businessUnit?.buHead || null,
        position: user.position,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      message: "User fetched successfully",
      error: null,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      message: "Failed to fetch user",
      error: err.message,
    });
  }
};

export const createUser = async (req: any, res: any) => {
  try {
    const {
      name,
      firstName,
      lastName,
      company,
      email,
      password,
      roleId,
      businessUnitId,
      position,
    } = req.body;

    const resolvedName =
      name || `${firstName || ""} ${lastName || ""}`.trim() || email;

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: resolvedName,
        firstName: firstName || null,
        lastName: lastName || null,
        company: company || null,
        email,
        password: hashedPassword,
        roleId,
        businessUnitId: businessUnitId || null,
        position: position || null,
      },
      include: {
        role: true,
        businessUnit: {
          select: {
            id: true,
            code: true,
            name: true,
            entity: true,
            buHead: true,
          },
        },
      },
    });

    res.json(user);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
};

export const updateUser = async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const {
      name,
      firstName,
      lastName,
      company,
      email,
      roleId,
      businessUnitId,
      position,
      password,
    } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    if (email && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email },
      });

      if (emailExists) {
        return res.status(400).json({
          message: "Email already in use",
        });
      }
    }

    let hashedPassword = existingUser.password;

    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name:
          name ??
          (`${firstName ?? existingUser.firstName ?? ""} ${lastName ?? existingUser.lastName ?? ""}`.trim() ||
            existingUser.name),
        firstName: firstName ?? existingUser.firstName,
        lastName: lastName ?? existingUser.lastName,
        company: company ?? existingUser.company,
        email: email ?? existingUser.email,
        roleId: roleId ?? existingUser.roleId,
        businessUnitId: businessUnitId ?? existingUser.businessUnitId,
        position: position ?? existingUser.position,
        password: hashedPassword,
      },
      include: {
        role: true,
        businessUnit: {
          select: {
            id: true,
            code: true,
            name: true,
            entity: true,
            buHead: true,
          },
        },
      },
    });

    res.json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(400).json({
        message: "Email already exists",
      });
    }

    res.status(500).json({ message: err.message });
  }
};
export const deleteUser = async (req: any, res: any) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.user.id === userId) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    const ownedProjects = await prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      // Requirement: if user owns project(s), delete those projects using cascade cleanup.
      for (const project of ownedProjects) {
        await deleteProjectCascade(tx, project.id);
      }

      // Requirement: if user is member/assignee, remove user from those project links.
      await tx.projectMember.deleteMany({ where: { userId } });
      await tx.taskAssignee.deleteMany({ where: { userId } });
      await tx.subtaskAssignee.deleteMany({ where: { userId } });

      // Cleanup remaining user references that can still block user deletion.
      await tx.dailyReportReceiver.deleteMany({ where: { userId } });
      await tx.weeklyReportReceiver.deleteMany({ where: { userId } });
      await tx.projectApproval.deleteMany({ where: { approverId: userId } });
      await tx.approvalAuditLog.deleteMany({ where: { approverId: userId } });
      await tx.approvalStepUser.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.userHierarchy.deleteMany({
        where: { OR: [{ managerId: userId }, { memberId: userId }] },
      });

      await tx.ssoRegistration.updateMany({
        where: { reviewedById: userId },
        data: { reviewedById: null },
      });

      await tx.ssoRegistrationAudit.updateMany({
        where: { changedById: userId },
        data: { changedById: null },
      });

      await tx.progressLog.updateMany({
        where: { userId },
        data: { userId: null },
      });

      await tx.dailyReport.deleteMany({ where: { userId } });
      await tx.weeklyReport.deleteMany({ where: { userId } });
      await tx.comment.deleteMany({ where: { userId } });
      await tx.activityLog.deleteMany({ where: { userId } });
      await tx.attachment.deleteMany({ where: { uploadedBy: userId } });

      const remainingSubtaskCreatedCount = await tx.subtask.count({ where: { createdBy: userId } });
      if (remainingSubtaskCreatedCount > 0) {
        throw new Error(
          `Cannot delete user \"${user.name}\" because ${remainingSubtaskCreatedCount} subtask(s) were created by this user in projects they do not own.`
        );
      }

      await tx.user.delete({ where: { id: userId } });
    });

    res.json({
      success: true,
      message:
        ownedProjects.length > 0
          ? `User "${user.name}" deleted successfully. ${ownedProjects.length} owned project(s) were also deleted.`
          : `User "${user.name}" deleted successfully`,
      data: null,
      error: null,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const updateUserStatus = async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean",
        data: null,
        error: "INVALID_STATUS_VALUE",
      });
    }

    if (req.user.id === userId && isActive === false) {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account",
        data: null,
        error: "SELF_DEACTIVATION_NOT_ALLOWED",
      });
    }

    const existingUser = await prisma.user.findUnique({ where: { id: userId } });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: null,
        error: "USER_NOT_FOUND",
      });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isActive },
      include: {
        role: true,
        businessUnit: {
          select: {
            id: true,
            code: true,
            name: true,
            entity: true,
            buHead: true,
          },
        },
      },
    });

    res.json({
      success: true,
      message: `User ${isActive ? "activated" : "deactivated"} successfully`,
      data: updated,
      error: null,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update user status",
      data: null,
      error: err.message,
    });
  }
};

export const getMyMembers = async (req: any, res: any) => {
  try {
    const currentUserId = req.user.id;

    // =========================
    // 🔥 GET DIRECT MEMBERS
    // =========================
    const relations = await prisma.userHierarchy.findMany({
      where: {
        managerId: currentUserId,
      },
      select: {
        memberId: true,
      },
    });

    const memberIds = [...new Set(relations.map((r) => r.memberId))];

    const members = await prisma.user.findMany({
      where: {
        id: { in: memberIds },
      },
      include: {
        role: true,
      },
    });

    // =========================
    // 🔥 GET CURRENT USER (YOU)
    // =========================
    const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      include: { role: true },
    });

    // =========================
    // 🔥 MERGE (YOU FIRST)
    // =========================
    const finalData = [
      currentUser,
      ...members,
    ].filter(Boolean); // remove null if ever

    res.json({
      success: true,
      data: finalData,
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
    });
  }
};

export const getMyManagers = async (req: any, res: any) => {
  try {
    const currentUserId = req.user.userId;

    // Get all managers of current user
    const relations = await prisma.userHierarchy.findMany({
      where: {
        memberId: currentUserId,
      },
      select: {
        managerId: true,
      },
    });

    const managerIds = relations.map((r) => r.managerId);

    // Fetch full user details
    const managers = await prisma.user.findMany({
      where: {
        id: { in: managerIds },
      },
      include: {
        role: true,
      },
    });

    res.json({
      success: true,
      data: managers,
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
    });
  }
};

export const assignManager = async (req: any, res: any) => {
  try {
    const { managerId, userId: memberId } = req.body;

    // Validate both users exist
    const manager = await prisma.user.findUnique({
      where: { id: managerId },
    });

    const member = await prisma.user.findUnique({
      where: { id: memberId },
    });

    if (!manager || !member) {
      return res.status(404).json({
        message: "Manager or member not found",
      });
    }

    // Check if relation already exists
    const existing = await prisma.userHierarchy.findUnique({
      where: {
        managerId_memberId: {
          managerId,
          memberId,
        },
      },
    });

    if (existing) {
      return res.status(400).json({
        message: "This manager is already assigned to this member",
      });
    }

    // Create the hierarchy relationship
    const hierarchy = await prisma.userHierarchy.create({
      data: {
        managerId,
        memberId,
      },
      include: {
        manager: { include: { role: true } },
        member: { include: { role: true } },
      },
    });

    res.json({
      success: true,
      message: `${manager.name} is now managing ${member.name}`,
      data: hierarchy,
    });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(400).json({
        message: "This relation already exists",
      });
    }
    res.status(500).json({
      message: err.message,
    });
  }
};

export const removeManager = async (req: any, res: any) => {
  try {
    const { managerId, userId: memberId } = req.body;

    const hierarchy = await prisma.userHierarchy.findUnique({
      where: {
        managerId_memberId: {
          managerId,
          memberId,
        },
      },
    });

    if (!hierarchy) {
      return res.status(404).json({
        message: "This manager-member relationship not found",
      });
    }

    await prisma.userHierarchy.delete({
      where: {
        managerId_memberId: {
          managerId,
          memberId,
        },
      },
    });

    res.json({
      success: true,
      message: "Manager-member relationship removed",
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
    });
  }
};

export const getOrgChart = async (req: any, res: any) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Get managers via UserHierarchy
    const managerRelations = await prisma.userHierarchy.findMany({
      where: { memberId: userId },
      include: {
        manager: { include: { role: true } },
      },
    });

    // Get members via UserHierarchy
    const memberRelations = await prisma.userHierarchy.findMany({
      where: { managerId: userId },
      include: {
        member: { include: { role: true } },
      },
    });

    // 🔥 FORMAT CLEAN RESPONSE
    const formatted = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role?.name || null,
      managers: managerRelations.map((rel) => ({
        id: rel.manager.id,
        name: rel.manager.name,
        email: rel.manager.email,
        role: rel.manager.role?.name || null,
      })),
      members: memberRelations.map((rel) => ({
        id: rel.member.id,
        name: rel.member.name,
        email: rel.member.email,
        role: rel.member.role?.name || null,
      })),
    };

    res.json({
      success: true,
      data: formatted,
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
    });
  }
};

export const getUserMembersById = async (req: any, res: any) => {
  try {
    const { userId } = req.params;

    // Get all member IDs from UserHierarchy
    const memberRelations = await prisma.userHierarchy.findMany({
      where: { managerId: userId },
      select: { memberId: true },
    });

    const memberIds = memberRelations.map((rel) => rel.memberId);

    // Fetch actual User objects with role
    const members = await prisma.user.findMany({
      where: { id: { in: memberIds } },
      include: { role: true },
    });

    res.json({
      success: true,
      data: members,
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
    });
  }
};

export const getUserManagersById = async (req: any, res: any) => {
  try {
    const { userId } = req.params;

    // Get all manager IDs from UserHierarchy
    const managerRelations = await prisma.userHierarchy.findMany({
      where: { memberId: userId },
      select: { managerId: true },
    });

    const managerIds = managerRelations.map((rel) => rel.managerId);

    // Fetch actual User objects with role
    const managers = await prisma.user.findMany({
      where: { id: { in: managerIds } },
      include: { role: true },
    });

    res.json({
      success: true,
      data: managers,
    });
  } catch (err: any) {
    res.status(500).json({
      message: err.message,
    });
  }
};
