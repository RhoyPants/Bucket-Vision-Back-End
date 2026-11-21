import { NextFunction, Response } from "express";
import prisma from "../config/prisma";
import { canReadProject } from "../modules/project/project-access";

/**
 * Two guards for routes that act on one project. Both take the name of the route parameter that holds
 * the project id (`/:id` or `/:projectId`) and run after `authenticate`.
 *
 * - requireProjectManager: only the project's owner or a co-owner may change it (edit, setup, CPM,
 *   org chart, team). This is about the person's role IN THE PROJECT, not their system role, so being
 *   a BU Head, OP or Superadmin does not by itself allow it. It sits next to the page permission
 *   (`authorize("projects", "UPDATE")`), which says whether the role may edit at all.
 * - requireProjectReadAccess: only people who can see the project (Project Access) or are its approvers.
 */
type ProjectParam = "id" | "projectId";

const readProjectId = (req: any, param: ProjectParam) => String(req.params?.[param] ?? "");

export const requireProjectManager = (param: ProjectParam = "projectId") =>
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const project = await prisma.project.findFirst({
        where: { id: readProjectId(req, param), deletedAt: null },
        select: { ownerId: true, projectMembers: { where: { userId: user.id }, select: { role: true } } },
      });
      if (!project) return res.status(404).json({ message: "Project not found" });

      const isOwner = project.ownerId === user.id;
      const isCoOwner = project.projectMembers.some((m) => m.role === "CO_OWNER" || m.role === "OWNER");
      if (!isOwner && !isCoOwner) {
        return res.status(403).json({
          success: false,
          message: "Only the project owner or a co-owner can change this project",
          error: { code: "PROJECT_MANAGER_ONLY", message: "Only the project owner or a co-owner can change this project" },
        });
      }
      next();
    } catch (error) {
      console.error("[project-role] requireProjectManager", error);
      return res.status(500).json({ message: "Server error" });
    }
  };

export const requireProjectReadAccess = (param: ProjectParam = "id") =>
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      if (!(await canReadProject(readProjectId(req, param), user.id, user.roleId))) {
        return res.status(404).json({ message: "Project not found or access denied" });
      }
      next();
    } catch (error) {
      console.error("[project-role] requireProjectReadAccess", error);
      return res.status(500).json({ message: "Server error" });
    }
  };
