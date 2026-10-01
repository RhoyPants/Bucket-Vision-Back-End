import { Request, Response } from "express";
import prisma from "../../config/prisma";
import { buildAccessibleProjectWhere } from "../project/project-access";
import { CreatePhaseDTO, UpdatePhaseDTO } from "./phase.dto";

export class PhaseController {
  private static async accessibleProject(req: Request, projectId: string) {
    const accessWhere = await buildAccessibleProjectWhere(
      (req as any).user.id,
      (req as any).user.roleId,
    );
    return prisma.project.findFirst({
      where: { AND: [{ id: projectId }, accessWhere] },
      select: { id: true, isPhasing: true },
    });
  }

  static async getByProject(req: Request<{ projectId: string }>, res: Response) {
    try {
      const project = await PhaseController.accessibleProject(req, req.params.projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (!project.isPhasing) return res.json([]);
      const phases = await prisma.phase.findMany({
        where: { projectId: project.id, deletedAt: null },
        include: {
          scopes: {
            where: { deletedAt: null },
            orderBy: [{ order: "asc" }, { id: "asc" }],
            include: {
              tasks: {
                where: { deletedAt: null },
                orderBy: [{ order: "asc" }, { id: "asc" }],
                include: {
                  subtasks: {
                    where: { deletedAt: null },
                    orderBy: [{ order: "asc" }, { id: "asc" }],
                  },
                },
              },
            },
          },
        },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      });
      return res.json(phases);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  static async create(req: Request<{}, {}, CreatePhaseDTO>, res: Response) {
    try {
      const projectId = String(req.body.projectId || "");
      const name = String(req.body.name || "").trim();
      if (!projectId || !name) return res.status(400).json({ message: "projectId and name are required" });
      const project = await PhaseController.accessibleProject(req, projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (!project.isPhasing) return res.status(409).json({ message: "Phasing is not enabled for this project" });
      let order = req.body.order;
      if (order === undefined) {
        const last = await prisma.phase.findFirst({
          where: { projectId, deletedAt: null },
          orderBy: { order: "desc" },
          select: { order: true },
        });
        order = (last?.order ?? -1) + 1;
      }
      const phase = await prisma.phase.create({
        data: { projectId, name, description: req.body.description, order },
      });
      return res.status(201).json(phase);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  static async update(req: Request<{ id: string }, {}, UpdatePhaseDTO>, res: Response) {
    try {
      const existing = await prisma.phase.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!existing) return res.status(404).json({ message: "Phase not found" });
      if (!await PhaseController.accessibleProject(req, existing.projectId)) {
        return res.status(404).json({ message: "Project not found" });
      }
      const name = req.body.name === undefined ? undefined : String(req.body.name).trim();
      if (name === "") return res.status(400).json({ message: "Phase name cannot be empty" });
      const phase = await prisma.phase.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.order !== undefined ? { order: req.body.order } : {}),
        },
      });
      return res.json(phase);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  static async delete(req: Request<{ id: string }>, res: Response) {
    try {
      const phase = await prisma.phase.findFirst({
        where: { id: req.params.id, deletedAt: null },
        select: { id: true, projectId: true, _count: { select: { scopes: true } } },
      });
      if (!phase) return res.status(404).json({ message: "Phase not found" });
      if (!await PhaseController.accessibleProject(req, phase.projectId)) {
        return res.status(404).json({ message: "Project not found" });
      }
      if (phase._count.scopes > 0) {
        return res.status(409).json({ message: "A phase containing scopes cannot be deleted" });
      }
      await prisma.phase.delete({ where: { id: phase.id } });
      return res.json({ success: true, message: "Phase deleted successfully" });
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }
}
