import { Request, Response } from "express";
import {
  generateProjectTimeline,
  getProjectTimeline,
  getLatestTimelineSnapshot,
  forecastCompletionDate,
  generateTimelineSnapshot,
} from "./timeline.service";

export class TimelineController {
  // ========================================
  // GENERATE TIMELINE (Manual trigger or cron job)
  // ========================================
  static async generateTimeline(
    req: Request<{ projectId: string }, {}, { interval?: "daily" | "weekly" }>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;
      const { interval = "daily" } = req.body;

      await generateProjectTimeline(projectId, interval);

      res.json({
        success: true,
        message: `Timeline generated for project ${projectId}`,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET TIMELINE (For S-Curve Chart)
  // ========================================
  static async getTimeline(
    req: Request<
      { projectId: string },
      {},
      {},
      { dateFrom?: string; dateTo?: string; limit?: string }
    >,
    res: Response
  ) {
    try {
      const { projectId } = req.params;
      const { dateFrom, dateTo, limit } = req.query;

      const options: any = {};

      if (dateFrom) options.dateFrom = new Date(dateFrom);
      if (dateTo) options.dateTo = new Date(dateTo);
      if (limit) options.limit = parseInt(limit as string);

      const timeline = await getProjectTimeline(projectId, options);

      res.json({
        success: true,
        data: timeline,
        total: timeline.length,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET LATEST SNAPSHOT (Current Status)
  // ========================================
  static async getLatestSnapshot(
    req: Request<{ projectId: string }>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;

      const snapshot = await getLatestTimelineSnapshot(projectId);

      if (!snapshot) {
        return res.status(404).json({
          message: "No timeline data available. Run generate first.",
        });
      }

      res.json({
        success: true,
        data: snapshot,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET FORECAST
  // ========================================
  static async getForecast(
    req: Request<{ projectId: string }>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;

      const forecastDate = await forecastCompletionDate(projectId);

      if (!forecastDate) {
        return res.status(404).json({
          message:
            'Cannot forecast. Need at least 2 timeline snapshots.',
        });
      }

      res.json({
        success: true,
        data: {
          forecastCompletionDate: forecastDate,
        },
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET VARIANCE REPORT
  // ========================================
  static async getVarianceReport(
    req: Request<{ projectId: string }>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;

      const latest = await getLatestTimelineSnapshot(projectId);

      if (!latest) {
        return res.status(404).json({
          message: "No timeline data available",
        });
      }

      res.json({
        success: true,
        data: {
          date: latest.date,
          plannedProgress: latest.planned,
          actualProgress: latest.actual,
          variance: latest.variance,
          daysAheadBehind: latest.daysAhead,
          status:
            latest.variance > 5
              ? "AHEAD"
              : latest.variance < -5
                ? "DELAYED"
                : "ON_TRACK",
        },
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET TODAY'S SNAPSHOT (Real-time)
  // ========================================
  static async getTodaySnapshot(
    req: Request<{ projectId: string }>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const snapshot = await generateTimelineSnapshot(projectId, today);

      res.json({
        success: true,
        data: snapshot,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // REFRESH/UPDATE TIMELINE (For cron jobs)
  // ========================================
  static async refreshTimeline(
    req: Request<{ projectId: string }>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;

      // Delete old data (keep only last 90 days)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Generate fresh timeline
      await generateProjectTimeline(projectId, "daily");

      res.json({
        success: true,
        message: "Timeline refreshed successfully",
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
}
