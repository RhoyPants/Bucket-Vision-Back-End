import { Request, Response, NextFunction } from "express";
import prisma from "../config/prisma";

const normalizeResourceKey = (resourceKey: string) =>
  String(resourceKey || "").trim().toLowerCase();

const normalizeAction = (action: string) => {
  const upper = String(action || "").trim().toUpperCase();
  if (upper === "VIEW") return "READ";
  return upper;
};

async function resolveProjectId(req: any): Promise<string | null> {
  if (req.params?.projectId) return String(req.params.projectId);
  if (req.body?.projectId) return String(req.body.projectId);
  const resourceId = req.params?.id ? String(req.params.id) : null;
  if (!resourceId) return null;
  const baseUrl = String(req.baseUrl || "").toLowerCase();
  if (baseUrl.endsWith("/projects")) return resourceId;
  if (baseUrl.endsWith("/scopes")) return (await prisma.scope.findUnique({ where: { id: resourceId }, select: { projectId: true } }))?.projectId || null;
  if (baseUrl.endsWith("/tasks")) return (await prisma.task.findUnique({ where: { id: resourceId }, select: { scope: { select: { projectId: true } } } }))?.scope.projectId || null;
  if (baseUrl.endsWith("/subtasks")) return (await prisma.subtask.findUnique({ where: { id: resourceId }, select: { task: { select: { scope: { select: { projectId: true } } } } } }))?.task.scope.projectId || null;
  if (baseUrl.endsWith("/phases")) return (await prisma.phase.findUnique({ where: { id: resourceId }, select: { projectId: true } }))?.projectId || null;
  return null;
}

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
        if (["projects", "team_management"].includes(resourceKey)) {
          const projectId = await resolveProjectId(req);
          if (projectId) {
            const membership = await prisma.projectMember.findUnique({
              where: { projectId_userId: { projectId, userId: user.id } },
              select: { role: true },
            });
            if (membership?.role === "CO_OWNER") return next();
          }
        }
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
