import { Request, Response, NextFunction } from "express";
import prisma from "../config/prisma";

export const authorize = (moduleName: string, action: string) => {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // find permission
      const permission = await prisma.rolePermission.findFirst({
        where: {
          roleId: user.roleId,
          module: { name: moduleName, isActive: true },
          permission: { action: action },
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