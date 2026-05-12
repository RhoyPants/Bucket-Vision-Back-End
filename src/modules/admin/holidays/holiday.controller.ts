import { Request, Response } from "express";
import { HolidayService } from "./holiday.service";

export class HolidayController {
  /**
   * 🔥 LIST ALL GLOBAL HOLIDAYS
   * GET /admin/holidays
   */
  static async listHolidays(req: Request, res: Response) {
    try {
      const holidays = await HolidayService.listHolidays();
      return res.status(200).json({
        success: true,
        data: holidays,
        count: holidays.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET SINGLE HOLIDAY
   * GET /admin/holidays/:id
   */
  static async getHoliday(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };

      const holiday = await HolidayService.getHolidayById(id);
      if (!holiday) {
        return res.status(404).json({
          success: false,
          error: "Holiday not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: holiday,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 CREATE GLOBAL HOLIDAY
   * POST /admin/holidays
   * Body: { date: ISOString, name: string, description?: string }
   */
  static async createHoliday(req: Request, res: Response) {
    try {
      const { date, name, description } = req.body;

      if (!date || !name) {
        return res.status(400).json({
          success: false,
          error: "date and name are required",
        });
      }

      const holiday = await HolidayService.createHoliday(
        new Date(date),
        name,
        description
      );

      return res.status(201).json({
        success: true,
        message: "Holiday created successfully",
        data: holiday,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 UPDATE HOLIDAY
   * PUT /admin/holidays/:id
   * Body: { date?: ISOString, name?: string, description?: string }
   */
  static async updateHoliday(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { date, name, description } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: "Holiday ID is required",
        });
      }

      const holiday = await HolidayService.updateHoliday(id, {
        ...(date && { date: new Date(date) }),
        ...(name && { name }),
        ...(description !== undefined && { description }),
      });

      return res.status(200).json({
        success: true,
        message: "Holiday updated successfully",
        data: holiday,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 DELETE HOLIDAY
   * DELETE /admin/holidays/:id
   */
  static async deleteHoliday(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };

      if (!id) {
        return res.status(400).json({
          success: false,
          error: "Holiday ID is required",
        });
      }

      const holiday = await HolidayService.deleteHoliday(id);

      return res.status(200).json({
        success: true,
        message: "Holiday deleted successfully",
        data: holiday,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET HOLIDAYS IN DATE RANGE (for S-Curve & calculations)
   * GET /admin/holidays/range?startDate=2026-01-01&endDate=2026-12-31
   */
  static async getHolidaysInRange(req: Request, res: Response) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: "startDate and endDate are required",
        });
      }

      const holidays = await HolidayService.getHolidaysInRange(
        new Date(startDate as string),
        new Date(endDate as string)
      );

      return res.status(200).json({
        success: true,
        data: holidays,
        count: holidays.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}
