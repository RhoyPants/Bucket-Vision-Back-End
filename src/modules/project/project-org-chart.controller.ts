import { Request, Response } from "express";
import { projectOrgChartService } from "./project-org-chart.service";

const params = (req: Request) => ({ projectId: String(req.params.projectId), userId: (req as any).user.id, roleId: (req as any).user.roleId });

export class ProjectOrgChartController {
  async uploadPhoto(req: Request, res: Response) {
    try {
      const p = params(req);
      const file = (req as any).file as Express.Multer.File | undefined;
      res.status(201).json({ success: true, data: await projectOrgChartService.uploadPhoto(p.projectId, p.userId, p.roleId, file) });
    } catch (error: any) { res.status(error.message === "Project not found or access denied" ? 404 : 400).json({ success: false, message: error.message }); }
  }

  async listCopySources(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      res.json({ success: true, ...(await projectOrgChartService.listCopySources(user.id, user.roleId, req.query.query, req.query.cursor, req.query.limit)) });
    } catch (error: any) { res.status(400).json({ success: false, message: error.message }); }
  }

  async previewCopy(req: Request, res: Response) {
    try {
      const p = params(req);
      res.json({ success: true, data: await projectOrgChartService.previewCopy(p.projectId, String(req.body?.sourceProjectId || ""), p.userId, p.roleId) });
    } catch (error: any) { res.status(error.message?.includes("not found or access denied") ? 404 : 400).json({ success: false, message: error.message }); }
  }

  async cloneFromProject(req: Request, res: Response) {
    try {
      const p = params(req);
      res.status(201).json({ success: true, data: await projectOrgChartService.cloneFromProject(
        p.projectId, String(req.body?.sourceProjectId || ""), req.body?.replace === true, p.userId, p.roleId,
      ) });
    } catch (error: any) { res.status(error.message?.includes("not found or access denied") ? 404 : 400).json({ success: false, message: error.message }); }
  }

  async get(req: Request, res: Response) {
    try { const p = params(req); res.json({ success: true, data: await projectOrgChartService.get(p.projectId, p.userId, p.roleId) }); }
    catch (error: any) { res.status(error.message === "Project not found or access denied" ? 404 : 400).json({ success: false, message: error.message }); }
  }
  async save(req: Request, res: Response) {
    try { const p = params(req); res.json({ success: true, data: await projectOrgChartService.save(p.projectId, p.userId, p.roleId, req.body) }); }
    catch (error: any) { res.status(error.message === "Project not found or access denied" ? 404 : 400).json({ success: false, message: error.message }); }
  }
  async remove(req: Request, res: Response) {
    try { const p = params(req); res.json({ success: true, data: await projectOrgChartService.remove(p.projectId, p.userId, p.roleId) }); }
    catch (error: any) { res.status(error.message === "Project not found or access denied" ? 404 : 400).json({ success: false, message: error.message }); }
  }
}

export const projectOrgChartController = new ProjectOrgChartController();
