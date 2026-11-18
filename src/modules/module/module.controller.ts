import prisma from "../../config/prisma";

export const createModule = async (req: any, res: any) => {
  try {
    const { key, name, path, isActive } = req.body;
    const resolvedKey = String(key || name || "").trim();
    const resolvedPath = String(path || "").trim();

    if (!resolvedKey || !resolvedPath) {
      return res.status(400).json({
        success: false,
        message: "key/name and path are required",
      });
    }

    const module = await prisma.module.create({
      data: {
        // Current schema uses module.name as the stable key.
        name: resolvedKey,
        path: resolvedPath,
        isActive: isActive === undefined ? true : Boolean(isActive),
      },
    });

    res.json({
      success: true,
      data: {
        id: module.id,
        key: module.name,
        name: module.name,
        path: module.path,
        isActive: module.isActive,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Create-only sync: inserts modules that do not exist yet (matched by key).
// Existing modules, their paths, active flags and role permissions are untouched.
export const syncModules = async (req: any, res: any) => {
  try {
    const items = Array.isArray(req.body?.modules) ? req.body.modules : null;
    if (!items) {
      return res.status(400).json({ success: false, message: "modules array is required" });
    }

    const incoming = new Map<string, string>();
    for (const item of items) {
      const key = String(item?.key || item?.name || "").trim();
      const path = String(item?.path || "").trim();
      if (key && path && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key) && !incoming.has(key)) {
        incoming.set(key, path);
      }
    }

    const existing = await prisma.module.findMany({ select: { name: true } });
    const existingNames = new Set(existing.map((m) => m.name));
    const missing = [...incoming].filter(([key]) => !existingNames.has(key));

    if (missing.length > 0) {
      await prisma.module.createMany({
        data: missing.map(([name, path]) => ({ name, path, isActive: true })),
        skipDuplicates: true,
      });
    }

    res.json({
      success: true,
      created: missing.map(([key, path]) => ({ key, path })),
      createdCount: missing.length,
      alreadyExisting: incoming.size - missing.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateModule =async (req: any, res: any) => {
  try {
    const { moduleId } = req.params;
    const { key, name, path, isActive } = req.body;

    const updateData: any = {};

    if (key !== undefined || name !== undefined) {
      updateData.name = String(key || name || "").trim();
    }
    if (path !== undefined) {
      updateData.path = String(path || "").trim();
    }
    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    const module = await prisma.module.update({
      where: { id: String(moduleId) },
      data: updateData,
    });

    res.json({
      success: true,
      message: "Module updated successfully",
      data: {
        id: module.id,
        key: module.name,
        name: module.name,
        path: module.path,
        isActive: module.isActive,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getModules = async (req: any, res: any) => {
  try {
    const modules = await prisma.module.findMany({
      orderBy: { name: "asc" },
    });

    res.json({
      success: true,
      data: modules.map((module) => ({
        id: module.id,
        key: module.name,
        name: module.name,
        path: module.path,
        isActive: module.isActive,
      })),
      count: modules.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
