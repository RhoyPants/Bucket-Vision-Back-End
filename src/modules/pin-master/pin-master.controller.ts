import { Request, Response } from "express";
import { pinMasterService } from "./pin-master.service";

export class PinMasterController {
  async dropdown(req: Request, res: Response) {
    try {
      const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
      const data = await pinMasterService.getDropdown(search);
      res.json({ success: true, data, count: data.length });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to load PINs" });
    }
  }

  async getByPin(req: Request, res: Response) {
    try {
      const data = await pinMasterService.getByPin(String(req.params.pin));
      if (!data) {
        res.status(404).json({ success: false, error: "PIN not found" });
        return;
      }
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to load PIN" });
    }
  }

  async sync(_req: Request, res: Response) {
    try {
      const result = await pinMasterService.syncFromSharePoint();
      res.json({ success: true, data: result, message: "PIN master synchronized from SharePoint" });
    } catch (error: any) {
      res.status(502).json({ success: false, error: error.message || "PIN synchronization failed" });
    }
  }
}

export const pinMasterController = new PinMasterController();
