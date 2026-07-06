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

export const updateModule = async (req: any, res: any) => {
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
