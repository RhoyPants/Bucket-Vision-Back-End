import { Request, Response, NextFunction } from "express";
import prisma from "../config/prisma";

const normalizeResourceKey = (resourceKey: string) =>
  String(resourceKey || "").trim().toLowerCase();

const normalizeAction = (action: string) => {
  const upper = String(action || "").trim().toUpperCase();
  if (upper === "VIEW") return "READ";
  return upper;
};

export const authorize = (moduleName: string, action: string) => {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const resourceKey = normalizeResourceKey(moduleName);
      const actionKey = normalizeAction(action);

      // find permission
      const permission = await prisma.rolePermission.findFirst({
        where: {
          roleId: user.roleId,
          module: {
            isActive: true,
            name: {
              equals: resourceKey,
              mode: "insensitive",
            },
          },
          permission: { action: actionKey },
        },
        include: {
          module: true,
          permission: true,
        },
      });

      if (!permission) {
        return res.status(403).json({
          message: "Access denied",
        });
      }

      next();
    } catch (err) {
      return res.status(500).json({ message: "Server error" });
    }
  };
};