import prisma from "../../config/prisma";

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
    const { permissions } = req.body;

    await syncRolePermissions(roleId, permissions);

    res.json({
      message: "Permissions synced successfully",
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
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

    res.json({
      permissions: formatted,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};