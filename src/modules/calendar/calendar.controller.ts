import { Request, Response } from "express";
import { calendarService } from "./calendar.service";

export class CalendarController {
  /**
   * GET /api/calendar/:projectId/subtasks
   * Get all subtasks for calendar view with optional date filtering
   */
  async getCalendarSubtasks(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const { startDate, endDate, scopeId } = req.query;

      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId required" });
        return;
      }

      // Parse dates if provided
      let parsedStartDate: Date | undefined;
      let parsedEndDate: Date | undefined;

      if (typeof startDate === "string") {
        parsedStartDate = new Date(startDate);
        if (isNaN(parsedStartDate.getTime())) {
          res.status(400).json({ error: "Invalid startDate format. Use ISO 8601" });
          return;
        }
      }

      if (typeof endDate === "string") {
        parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime())) {
          res.status(400).json({ error: "Invalid endDate format. Use ISO 8601" });
          return;
        }
      }

      const subtasks = await calendarService.getProjectCalendarSubtasks(
        projectId,
        parsedStartDate,
        parsedEndDate,
        typeof scopeId === "string" ? scopeId : undefined
      );

      res.status(200).json({
        success: true,
        data: subtasks,
        count: subtasks.length,
      });
    } catch (error: any) {
      const status = error.message === "Project not found" ? 404 : 400;
      res.status(status).json({
        success: false,
        error: error.message || "Failed to fetch calendar subtasks",
      });
    }
  }

  /**
   * GET /api/calendar/:projectId/month/:year/:month
   * Get subtasks for a specific month (optimized for month view)
   */
  async getMonthCalendar(req: Request, res: Response): Promise<void> {
    try {
      const { projectId, year, month } = req.params;
      const { scopeId } = req.query;

      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId required" });
        return;
      }

      const yearNum = parseInt(year as string, 10);
      const monthNum = parseInt(month as string, 10);

      if (isNaN(yearNum) || yearNum < 1970 || yearNum > 2100) {
        res.status(400).json({ error: "Invalid year. Must be between 1970 and 2100" });
        return;
      }

      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        res.status(400).json({ error: "Invalid month. Must be between 1 and 12" });
        return;
      }

      const subtasks = await calendarService.getMonthCalendar(
        projectId,
        yearNum,
        monthNum,
        typeof scopeId === "string" ? scopeId : undefined
      );

      res.status(200).json({
        success: true,
        data: subtasks,
        count: subtasks.length,
        month: `${yearNum}-${String(monthNum).padStart(2, "0")}`,
      });
    } catch (error: any) {
      const status = error.message === "Project not found" ? 404 : 400;
      res.status(status).json({
        success: false,
        error: error.message || "Failed to fetch month calendar",
      });
    }
  }

  /**
   * GET /api/calendar/subtask/:subtaskId
   * Get single subtask details for progress modal
   */
  async getSubtaskDetail(req: Request, res: Response): Promise<void> {
    try {
      const { subtaskId } = req.params;

      if (!subtaskId || typeof subtaskId !== "string") {
        res.status(400).json({ error: "subtaskId required" });
        return;
      }

      const subtask = await calendarService.getSubtaskDetail(subtaskId);

      res.status(200).json({
        success: true,
        data: subtask,
      });
    } catch (error: any) {
      const status = error.message === "Subtask not found" ? 404 : 400;
      res.status(status).json({
        success: false,
        error: error.message || "Failed to fetch subtask details",
      });
    }
  }

  /**
   * GET /api/calendar/:projectId/scopes
   * Get all scopes (categories) for a project - for filtering
   */
  async getProjectScopes(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;

      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId required" });
        return;
      }

      const scopes = await calendarService.getProjectScopes(projectId);

      res.status(200).json({
        success: true,
        data: scopes,
        count: scopes.length,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to fetch scopes",
      });
    }
  }
}

export const calendarController = new CalendarController();
