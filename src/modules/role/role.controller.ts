import prisma from "../../config/prisma";

const ACTION_FROM_FLAG: Record<string, string> = {
  canView: "READ",
  canCreate: "CREATE",
  canUpdate: "UPDATE",
  canDelete: "DELETE",
  canApprove: "APPROVE",
};

const toBoolFlag = (value: any) => value === 1 || value === "1" || value === true;

// REUSABLE LOGIC (NO req/res here)
const syncRolePermissions = async (roleId: string, permissions: any[]) => {
  // delete all existing permissions
  await prisma.rolePermission.deleteMany({
    where: { roleId },
  });

  for (const item of permissions) {
    const moduleData = await prisma.module.findUnique({
      where: { name: item.module },
    });

    if (!moduleData) continue;

    for (const action of item.actions) {
      const permissionData = await prisma.permission.findUnique({
        where: { action },
      });

      if (!permissionData) continue;

      await prisma.rolePermission.create({
        data: {
          roleId,
          moduleId: moduleData.id,
          permissionId: permissionData.id,
        },
      });
    }
  }
};

const syncRolePagePermissions = async (roleId: string, pages: any[]) => {
  await prisma.rolePermission.deleteMany({ where: { roleId } });

  const actionNames = Object.values(ACTION_FROM_FLAG);
  const permissionRows = await prisma.permission.findMany({
    where: { action: { in: actionNames } },
    select: { id: true, action: true },
  });
  const permissionIdByAction = Object.fromEntries(permissionRows.map((p) => [p.action, p.id]));

  for (const page of pages) {
    const key = String(page.key || page.module || page.name || "").trim();
    if (!key) continue;

    const moduleData = await prisma.module.findUnique({ where: { name: key } });
    if (!moduleData) continue;

    const actionsToGrant = Object.entries(ACTION_FROM_FLAG)
      .filter(([flag]) => toBoolFlag(page[flag]))
      .map(([, action]) => action);

    for (const action of actionsToGrant) {
      const permissionId = permissionIdByAction[action];
      if (!permissionId) continue;

      await prisma.rolePermission.create({
        data: {
          roleId,
          moduleId: moduleData.id,
          permissionId,
        },
      });
    }
  }
};

//  CREATE ROLE (WITH OPTIONAL PERMISSIONS)
export const createRole = async (req: any, res: any) => {
  try {
    const { name, permissions } = req.body;

    // CHECK IF ROLE EXISTS
    const existingRole = await prisma.role.findUnique({
      where: { name },
    });

    if (existingRole) {
      return res.status(400).json({
        message: "Role already exists",
      });
    }

    //  CREATE ROLE
    const role = await prisma.role.create({
      data: { name },
    });

    //  ASSIGN PERMISSIONS (OPTIONAL)
    if (permissions && permissions.length > 0) {
      await syncRolePermissions(role.id, permissions);
    }

    res.json({
      message: "Role created successfully",
      role,
    });
  } catch (err: any) {
    //  SAFETY NET (IN CASE RACE CONDITION)
    if (err.code === "P2002") {
      return res.status(400).json({
        message: "Role already exists",
      });
    }

    res.status(500).json({ message: err.message });
  }
};
// SYNC PERMISSIONS (REPLACE ALL)
export const syncPermissions = async (req: any, res: any) => {
  try {
    const { roleId } = req.params;
    const { permissions, pages } = req.body;

    if (Array.isArray(pages)) {
      await syncRolePagePermissions(roleId, pages);
      return res.json({
        success: true,
        message: "Page permissions synced successfully",
      });
    }

    await syncRolePermissions(roleId, permissions);

    res.json({
      success: true,
      message: "Permissions synced successfully",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const syncRolePagePermissionsController = async (req: any, res: any) => {
  try {
    const { roleId } = req.params;
    const { pages } = req.body;

    if (!Array.isArray(pages)) {
      return res.status(400).json({
        success: false,
        message: "pages array is required",
      });
    }

    await syncRolePagePermissions(roleId, pages);

    res.json({
      success: true,
      message: "Page permissions synced successfully",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteRole = async (req: any, res: any) => {
  try {
    const { roleId } = req.params;

    const role = await prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      return res.status(404).json({
        message: "Role not found",
      });
    }
    const usersWithRole = await prisma.user.count({
      where: { roleId },
    });

    if (usersWithRole > 0) {
      return res.status(400).json({
        message: "Cannot delete role. It is assigned to users.",
      });
    }
    await prisma.rolePermission.deleteMany({
      where: { roleId },
    });
    await prisma.role.delete({
      where: { id: roleId },
    });

    res.json({
      message: `${role.name} deleted successfully`,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getRoles = async (req: any, res: any) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { name: "desc" },
      include: {
        _count: {
          select: { users: true }, // count users per role
        },
      },
    });

    res.json(roles);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getRolePermissions = async (req: any, res: any) => {
  try {
    const { roleId } = req.params;

    //get all role permissions with relations
    const rolePermissions = await prisma.rolePermission.findMany({
      where: { roleId },
      include: {
        module: true,
        permission: true,
      },
    });

    //  group by module
    const grouped: Record<string, string[]> = {};

    for (const rp of rolePermissions) {
      const moduleName = rp.module.name;
      const action = rp.permission.action;

      if (!grouped[moduleName]) {
        grouped[moduleName] = [];
      }

      grouped[moduleName].push(action);
    }

    
    const formatted = Object.keys(grouped).map((module) => ({
      module,
      actions: grouped[module],
    }));

    const pagePermissions = rolePermissions.reduce((acc: any[], rp: any) => {
      const existing = acc.find((item) => item.key === rp.module.name);

      if (!existing) {
        const created = {
          key: rp.module.name,
          name: rp.module.name,
          path: rp.module.path,
          canView: 0,
          canCreate: 0,
          canUpdate: 0,
          canDelete: 0,
          canApprove: 0,
        };
        acc.push(created);
      }

      const target = acc.find((item) => item.key === rp.module.name);
      if (!target) return acc;

      if (rp.permission.action === "READ") target.canView = 1;
      if (rp.permission.action === "CREATE") target.canCreate = 1;
      if (rp.permission.action === "UPDATE") target.canUpdate = 1;
      if (rp.permission.action === "DELETE") target.canDelete = 1;
      if (rp.permission.action === "APPROVE") target.canApprove = 1;

      return acc;
    }, []);

    res.json({
      success: true,
      permissions: formatted,
      pages: pagePermissions,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};