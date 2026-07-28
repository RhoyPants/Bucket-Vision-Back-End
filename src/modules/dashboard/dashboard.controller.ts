import { Request, Response } from "express";
import { dashboardService } from "./dashboard.service";

export class DashboardController {
  async get(req: Request, res: Response) {
    try {
      const data = await dashboardService.get((req as any).user.id);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }
}

export const dashboardController = new DashboardController();

