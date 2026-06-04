import { Request, Response } from "express";
import { personalDashboardService } from "./personal-dashboard.service";

export class PersonalDashboardController {
  async list(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.list(userId);

      res.json({ success: true, data, count: data.length });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.getById(String(req.params.id), userId);

      res.json({ success: true, data });
    } catch (error: any) {
      const status = error.message === "Dashboard not found" ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.create(userId, req.body);

      res.status(201).json({
        success: true,
        data,
        message: "Personal dashboard created successfully",
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.update(String(req.params.id), userId, req.body);

      res.json({
        success: true,
        data,
        message: "Personal dashboard updated successfully",
      });
    } catch (error: any) {
      const status = error.message === "Dashboard not found" ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.delete(String(req.params.id), userId);

      res.json({
        success: true,
        data,
        message: "Personal dashboard deleted successfully",
      });
    } catch (error: any) {
      const status = error.message === "Dashboard not found" ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async getSourceOptions(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.getSourceOptions(String(req.params.id), userId);

      res.json({ success: true, data });
    } catch (error: any) {
      const status = error.message === "Dashboard not found" ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async previewSource(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.previewSource(
        String(req.params.id),
        userId,
        req.query as any
      );

      res.status(201).json({
        success: true,
        data,
        message: "KPI created successfully",
      });
    } catch (error: any) {
      const status = error.message === "Dashboard not found" ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async createKpi(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.createKpi(
        String(req.params.id),
        userId,
        req.body
      );

      res.json({ success: true, data });
    } catch (error: any) {
      const status = error.message === "Dashboard not found" ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async updateKpi(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.updateKpi(
        String(req.params.id),
        String(req.params.kpiId),
        userId,
        req.body
      );

      res.json({
        success: true,
        data,
        message: "KPI updated successfully",
      });
    } catch (error: any) {
      const status =
        error.message === "Dashboard not found" || error.message === "KPI not found"
          ? 404
          : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async deleteKpi(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.deleteKpi(
        String(req.params.id),
        String(req.params.kpiId),
        userId
      );

      res.json({
        success: true,
        data,
        message: "KPI deleted successfully",
      });
    } catch (error: any) {
      const status =
        error.message === "Dashboard not found" || error.message === "KPI not found"
          ? 404
          : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async updateCharts(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.updateCharts(
        String(req.params.id),
        userId,
        req.body.charts
      );

      res.json({
        success: true,
        data,
        message: "Dashboard charts updated successfully",
      });
    } catch (error: any) {
      const status = error.message === "Dashboard not found" ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async getChartData(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await personalDashboardService.getChartData(String(req.params.id), userId);

      res.json({ success: true, data });
    } catch (error: any) {
      const status = error.message === "Dashboard not found" ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }
}

export const personalDashboardController = new PersonalDashboardController();
