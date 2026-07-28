import { Request, Response } from "express";
import { projectDashboardService } from "./project-dashboard.service";

const notFoundStatus = (error: any) => {
  if (
    ["Project not found or access denied", "KPI not found", "Note not found", "Checklist item not found"]
      .includes(error.message)
  ) {
    return 404;
  }
  if (error.message?.startsWith("Only the project owner")) return 403;
  return 400;
};

export class ProjectDashboardController {
  async get(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.get(String(req.params.projectId), (req as any).user?.id);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async getSourceOptions(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.getSourceOptions(String(req.params.projectId), (req as any).user?.id);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async previewSource(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.previewSource(
        String(req.params.projectId),
        (req as any).user?.id,
        req.query as any
      );
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async createKpi(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.createKpi(String(req.params.projectId), (req as any).user?.id, req.body);
      res.status(201).json({ success: true, data, message: "KPI created successfully" });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async updateKpi(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.updateKpi(
        String(req.params.projectId), String(req.params.kpiId), (req as any).user?.id, req.body
      );
      res.json({ success: true, data, message: "KPI updated successfully" });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async deleteKpi(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.deleteKpi(
        String(req.params.projectId), String(req.params.kpiId), (req as any).user?.id
      );
      res.json({ success: true, data, message: "KPI deleted successfully" });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async getChartData(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.getChartData(String(req.params.projectId), (req as any).user?.id);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async getReportTable(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.getReportTable(String(req.params.projectId), (req as any).user?.id);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async getSubtaskKpi(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.getSubtaskKpi(
        String(req.params.projectId),
        (req as any).user?.id
      );
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async getSubtaskKpiConfig(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.getSubtaskKpiConfig(
        String(req.params.projectId),
        (req as any).user?.id
      );
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async updateSubtaskKpiConfig(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.updateSubtaskKpiConfig(
        String(req.params.projectId),
        (req as any).user?.id,
        req.body
      );
      res.json({
        success: true,
        message: "Subtask KPI thresholds updated successfully",
        data,
      });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async resetSubtaskKpiConfig(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.resetSubtaskKpiConfig(
        String(req.params.projectId),
        (req as any).user?.id
      );
      res.json({
        success: true,
        message: "Subtask KPI thresholds restored to defaults",
        data,
      });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async listNotes(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.listNotes((req as any).user?.id);
      res.json({ success: true, data, count: data.length });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async createNote(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.createNote((req as any).user?.id, req.body);
      res.status(201).json({ success: true, data, message: "Note created successfully" });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async updateNote(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.updateNote(String(req.params.noteId), (req as any).user?.id, req.body);
      res.json({ success: true, data, message: "Note updated successfully" });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async deleteNote(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.deleteNote(String(req.params.noteId), (req as any).user?.id);
      res.json({ success: true, data, message: "Note deleted successfully" });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async addNoteItem(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.addNoteItem(String(req.params.noteId), (req as any).user?.id, req.body);
      res.status(201).json({ success: true, data, message: "Checklist item added successfully" });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async updateNoteItem(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.updateNoteItem(
        String(req.params.noteId), String(req.params.itemId), (req as any).user?.id, req.body
      );
      res.json({ success: true, data, message: "Checklist item updated successfully" });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }

  async deleteNoteItem(req: Request, res: Response) {
    try {
      const data = await projectDashboardService.deleteNoteItem(
        String(req.params.noteId), String(req.params.itemId), (req as any).user?.id
      );
      res.json({ success: true, data, message: "Checklist item deleted successfully" });
    } catch (error: any) {
      res.status(notFoundStatus(error)).json({ success: false, message: error.message });
    }
  }
}

export const projectDashboardController = new ProjectDashboardController();
