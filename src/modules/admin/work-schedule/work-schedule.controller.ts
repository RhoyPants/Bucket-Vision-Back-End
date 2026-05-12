import { Request, Response } from "express";
import { WorkScheduleService } from "./work-schedule.service";

export class WorkScheduleController {
  /**
   * POST /api/admin/work-schedules
   * Create new work schedule
   */
  async createWorkSchedule(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, monday, tuesday, wednesday, thursday, friday, saturday, sunday, includeHolidays, isDefault } = req.body;

      // Validation
      if (!name) {
        res.status(400).json({ error: "Schedule name is required" });
        return;
      }

      if (typeof monday !== "boolean" || typeof tuesday !== "boolean" || typeof wednesday !== "boolean" || 
          typeof thursday !== "boolean" || typeof friday !== "boolean" || typeof saturday !== "boolean" || 
          typeof sunday !== "boolean") {
        res.status(400).json({ error: "Day configuration must be boolean values" });
        return;
      }

      const schedule = await WorkScheduleService.createSchedule({
        name,
        description,
        monday,
        tuesday,
        wednesday,
        thursday,
        friday,
        saturday,
        sunday,
        includeHolidays: includeHolidays ?? true,
        isDefault: isDefault ?? false
      });

      res.status(201).json({
        success: true,
        data: schedule,
        message: "Work schedule created successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to create work schedule"
      });
    }
  }

  /**
   * GET /api/admin/work-schedules
   * Get all work schedules
   */
  async getAllWorkSchedules(req: Request, res: Response): Promise<void> {
    try {
      const { onlyActive } = req.query;
      const schedules = await WorkScheduleService.getAllSchedules(onlyActive === "true");

      res.status(200).json({
        success: true,
        data: schedules,
        message: "Work schedules retrieved successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to retrieve work schedules"
      });
    }
  }

  /**
   * GET /api/admin/work-schedules/:scheduleId
   * Get work schedule by ID
   */
  async getWorkScheduleById(req: Request, res: Response): Promise<void> {
    try {
      const scheduleId = Array.isArray(req.params.scheduleId) ? req.params.scheduleId[0] : req.params.scheduleId;

      if (!scheduleId) {
        res.status(400).json({ error: "Schedule ID is required" });
        return;
      }

      const schedule = await WorkScheduleService.getScheduleById(scheduleId);

      if (!schedule) {
        res.status(404).json({ error: "Work schedule not found" });
        return;
      }

      res.status(200).json({
        success: true,
        data: schedule,
        message: "Work schedule retrieved successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to retrieve work schedule"
      });
    }
  }

  /**
   * GET /api/admin/work-schedules/default
   * Get default work schedule
   */
  async getDefaultWorkSchedule(req: Request, res: Response): Promise<void> {
    try {
      const schedule = await WorkScheduleService.getDefaultSchedule();

      if (!schedule) {
        res.status(404).json({ error: "No default work schedule found" });
        return;
      }

      res.status(200).json({
        success: true,
        data: schedule,
        message: "Default work schedule retrieved successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to retrieve default work schedule"
      });
    }
  }

  /**
   * PATCH /api/admin/work-schedules/:scheduleId
   * Update work schedule
   */
  async updateWorkSchedule(req: Request, res: Response): Promise<void> {
    try {
      const scheduleId = Array.isArray(req.params.scheduleId) ? req.params.scheduleId[0] : req.params.scheduleId;
      const updateData = req.body;

      if (!scheduleId) {
        res.status(400).json({ error: "Schedule ID is required" });
        return;
      }

      const schedule = await WorkScheduleService.updateSchedule(scheduleId, updateData);

      res.status(200).json({
        success: true,
        data: schedule,
        message: "Work schedule updated successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to update work schedule"
      });
    }
  }

  /**
   * DELETE /api/admin/work-schedules/:scheduleId
   * Delete work schedule
   */
  async deleteWorkSchedule(req: Request, res: Response): Promise<void> {
    try {
      const scheduleId = Array.isArray(req.params.scheduleId) ? req.params.scheduleId[0] : req.params.scheduleId;

      if (!scheduleId) {
        res.status(400).json({ error: "Schedule ID is required" });
        return;
      }

      await WorkScheduleService.deleteSchedule(scheduleId);

      res.status(200).json({
        success: true,
        message: "Work schedule deleted successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to delete work schedule"
      });
    }
  }

  /**
   * POST /api/admin/work-schedules/:scheduleId/holidays
   * Add holiday to work schedule
   */
  async addHolidayToSchedule(req: Request, res: Response): Promise<void> {
    try {
      const scheduleId = Array.isArray(req.params.scheduleId) ? req.params.scheduleId[0] : req.params.scheduleId;
      const { date, name } = req.body;

      if (!scheduleId || !date || !name) {
        res.status(400).json({ error: "Schedule ID, date, and holiday name are required" });
        return;
      }

      const holiday = await WorkScheduleService.addHoliday(scheduleId, { date: new Date(date), name });

      res.status(201).json({
        success: true,
        data: holiday,
        message: "Holiday added to schedule successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to add holiday"
      });
    }
  }

  /**
   * DELETE /api/admin/work-schedules/holidays/:holidayId
   * Remove holiday from work schedule
   */
  async removeHolidayFromSchedule(req: Request, res: Response): Promise<void> {
    try {
      const holidayId = Array.isArray(req.params.holidayId) ? req.params.holidayId[0] : req.params.holidayId;

      if (!holidayId) {
        res.status(400).json({ error: "Holiday ID is required" });
        return;
      }

      await WorkScheduleService.removeHoliday(holidayId);

      res.status(200).json({
        success: true,
        message: "Holiday removed from schedule successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to remove holiday"
      });
    }
  }

  /**
   * PATCH /api/admin/work-schedules/:scheduleId/set-default
   * Set as default work schedule
   */
  async setDefaultWorkSchedule(req: Request, res: Response): Promise<void> {
    try {
      const scheduleId = Array.isArray(req.params.scheduleId) ? req.params.scheduleId[0] : req.params.scheduleId;

      if (!scheduleId) {
        res.status(400).json({ error: "Schedule ID is required" });
        return;
      }

      const schedule = await WorkScheduleService.setDefaultSchedule(scheduleId);

      res.status(200).json({
        success: true,
        data: schedule,
        message: "Schedule set as default successfully"
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to set default schedule"
      });
    }
  }
}

export const workScheduleController = new WorkScheduleController();
