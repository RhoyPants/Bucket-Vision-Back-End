import { Request, Response } from "express";
import prisma from "../../config/prisma";
import {
  CreateWeeklyReportDTO,
  UpdateWeeklyReportDTO,
  WeeklyReportParamsDTO,
  WeeklyReportFilterDTO,
  WeeklyReportSummaryDTO,
} from "./weekly-report.dto";

export class WeeklyReportController {
  // ========================================
  // CREATE
  // ========================================
  static async create(
    req: Request<{}, {}, CreateWeeklyReportDTO>,
    res: Response
  ) {
    try {
      const { title, dateFrom, dateTo, remarks, attachments, receiverIds } = req.body;
      const userId = (req as any).user.id;

      // Validate receivers exist if provided
      if (receiverIds && receiverIds.length > 0) {
        const receivers = await prisma.user.findMany({
          where: { id: { in: receiverIds } },
        });

        if (receivers.length !== receiverIds.length) {
          return res.status(404).json({ message: "One or more receivers not found" });
        }
      }

      const weeklyReport = await prisma.weeklyReport.create({
        data: {
          userId,
          title,
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo),
          remarks,
          attachments: attachments || [],
          ...(receiverIds &&
            receiverIds.length > 0 && {
              receivers: {
                create: receiverIds.map((id) => ({
                  userId: id,
                })),
              },
            }),
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
      });

      res.json(weeklyReport);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET ALL (with filters)
  // ========================================
  static async getAll(
    req: Request<{}, {}, {}, WeeklyReportFilterDTO>,
    res: Response
  ) {
    try {
      const { userId, dateFrom, dateTo, search } = req.query;

      const whereConditions: any = {};

      if (userId) {
        whereConditions.userId = userId;
      }

      if (dateFrom || dateTo) {
        whereConditions.OR = [];

        if (dateFrom) {
          whereConditions.OR.push({
            dateTo: {
              gte: new Date(dateFrom as string),
            },
          });
        }

        if (dateTo) {
          whereConditions.OR.push({
            dateFrom: {
              lte: new Date(dateTo as string),
            },
          });
        }
      }

      if (search) {
        whereConditions.OR = [
          { title: { contains: search as string, mode: "insensitive" } },
          { remarks: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const reports = await prisma.weeklyReport.findMany({
        where: whereConditions,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { dateTo: "desc" },
      });

      res.json({
        success: true,
        data: reports,
        total: reports.length,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET BY ID
  // ========================================
  static async getById(
    req: Request<WeeklyReportParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const report = await prisma.weeklyReport.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
      });

      if (!report) {
        return res.status(404).json({ message: "Weekly report not found" });
      }

      res.json(report);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // UPDATE
  // ========================================
  static async update(
    req: Request<WeeklyReportParamsDTO, {}, UpdateWeeklyReportDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;
      const { title, dateFrom, dateTo, remarks, attachments, receiverIds } = req.body;

      // Validate receivers exist if provided
      if (receiverIds && receiverIds.length > 0) {
        const receivers = await prisma.user.findMany({
          where: { id: { in: receiverIds } },
        });

        if (receivers.length !== receiverIds.length) {
          return res.status(404).json({ message: "One or more receivers not found" });
        }
      }

      // Delete existing receivers if new ones are provided
      if (receiverIds !== undefined) {
        await prisma.weeklyReportReceiver.deleteMany({
          where: { reportId: id },
        });
      }

      const updated = await prisma.weeklyReport.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(dateFrom && { dateFrom: new Date(dateFrom) }),
          ...(dateTo && { dateTo: new Date(dateTo) }),
          ...(remarks !== undefined && { remarks }),
          ...(attachments && { attachments }),
          ...(receiverIds &&
            receiverIds.length > 0 && {
              receivers: {
                create: receiverIds.map((userId) => ({
                  userId,
                })),
              },
            }),
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
      });

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // DELETE
  // ========================================
  static async delete(
    req: Request<WeeklyReportParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const report = await prisma.weeklyReport.findUnique({
        where: { id },
      });

      if (!report) {
        return res.status(404).json({ message: "Weekly report not found" });
      }

      await prisma.weeklyReport.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: "Weekly report deleted successfully",
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET MY REPORTS (Current User)
  // ========================================
  static async getMyReports(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { dateFrom, dateTo } = req.query;

      const whereConditions: any = { userId };

      if (dateFrom || dateTo) {
        whereConditions.OR = [];

        if (dateFrom) {
          whereConditions.OR.push({
            dateTo: {
              gte: new Date(dateFrom as string),
            },
          });
        }

        if (dateTo) {
          whereConditions.OR.push({
            dateFrom: {
              lte: new Date(dateTo as string),
            },
          });
        }
      }

      const reports = await prisma.weeklyReport.findMany({
        where: whereConditions,
        include: {
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { dateTo: "desc" },
      });

      res.json({
        success: true,
        data: reports,
        total: reports.length,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET SUMMARY/DASHBOARD
  // ========================================
  static async getSummary(req: Request, res: Response) {
    try {
      const currentWeekStart = new Date();
      currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay());
      currentWeekStart.setHours(0, 0, 0, 0);

      const currentWeekEnd = new Date(currentWeekStart);
      currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
      currentWeekEnd.setHours(23, 59, 59, 999);

      // Get all reports submitted this week with receivers
      const thisWeekReports = await prisma.weeklyReport.findMany({
        where: {
          createdAt: {
            gte: currentWeekStart,
            lte: currentWeekEnd,
          },
        },
        include: {
          user: {
            select: { id: true, name: true },
          },
          receivers: true,
        },
      });

      // Count late reports (submitted after due date)
      const lateReports = thisWeekReports.filter((report) => {
        const daysOverdue = Math.floor(
          (new Date().getTime() - report.dateTo.getTime()) / (1000 * 60 * 60 * 24)
        );
        return daysOverdue > 0;
      });

      // Count reviewed reports (all receivers have read it)
      const reviewedReports = thisWeekReports.filter((report) => {
        if (report.receivers.length === 0) return false; // No receivers = not reviewed
        return report.receivers.every((receiver) => receiver.read);
      });

      // Count pending reports (at least one receiver hasn't read it)
      const pendingReports = thisWeekReports.filter((report) => {
        if (report.receivers.length === 0) return false;
        return !report.receivers.every((receiver) => receiver.read);
      });

      const summary: WeeklyReportSummaryDTO = {
        totalSubmitted: thisWeekReports.length,
        totalPending: pendingReports.length,
        totalReviewed: reviewedReports.length,
        lateReports: lateReports.length,
        thisWeekHighlights: {
          submittedCount: thisWeekReports.length,
          lateCount: lateReports.length,
          onTimeCount: thisWeekReports.length - lateReports.length,
        },
      };

      res.json({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET REPORTS BY DATE RANGE
  // ========================================
  static async getByDateRange(
    req: Request<{}, {}, {}, { dateFrom: string; dateTo: string }>,
    res: Response
  ) {
    try {
      const { dateFrom, dateTo } = req.query;

      if (!dateFrom || !dateTo) {
        return res.status(400).json({
          message: "dateFrom and dateTo are required",
        });
      }

      const reports = await prisma.weeklyReport.findMany({
        where: {
          AND: [
            {
              dateTo: {
                gte: new Date(dateFrom),
              },
            },
            {
              dateFrom: {
                lte: new Date(dateTo),
              },
            },
          ],
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { dateTo: "desc" },
      });

      res.json({
        success: true,
        data: reports,
        total: reports.length,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET INBOX (Reports sent to current user)
  // ========================================
  static async getInbox(
    req: Request<{}, {}, {}, { dateFrom?: string; dateTo?: string; search?: string }>,
    res: Response
  ) {
    try {
      const userId = (req as any).user.id;
      const { dateFrom, dateTo, search } = req.query;

      const whereConditions: any = {
        receivers: {
          some: {
            userId,
          },
        },
      };

      if (dateFrom || dateTo) {
        whereConditions.AND = [];

        if (dateFrom) {
          whereConditions.AND.push({
            dateTo: {
              gte: new Date(dateFrom as string),
            },
          });
        }

        if (dateTo) {
          whereConditions.AND.push({
            dateFrom: {
              lte: new Date(dateTo as string),
            },
          });
        }
      }

      if (search) {
        whereConditions.OR = [
          { title: { contains: search as string, mode: "insensitive" } },
          { remarks: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const reports = await prisma.weeklyReport.findMany({
        where: whereConditions,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          receivers: {
            where: { userId },
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { dateTo: "desc" },
      });

      res.json({
        success: true,
        data: reports,
        total: reports.length,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET MY SUBMITTED (Reports created by current user)
  // ========================================
  static async getMySubmitted(
    req: Request<{}, {}, {}, { dateFrom?: string; dateTo?: string; search?: string }>,
    res: Response
  ) {
    try {
      const userId = (req as any).user.id;
      const { dateFrom, dateTo, search } = req.query;

      const whereConditions: any = { userId };

      if (dateFrom || dateTo) {
        whereConditions.AND = [];

        if (dateFrom) {
          whereConditions.AND.push({
            dateTo: {
              gte: new Date(dateFrom as string),
            },
          });
        }

        if (dateTo) {
          whereConditions.AND.push({
            dateFrom: {
              lte: new Date(dateTo as string),
            },
          });
        }
      }

      if (search) {
        whereConditions.OR = [
          { title: { contains: search as string, mode: "insensitive" } },
          { remarks: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const reports = await prisma.weeklyReport.findMany({
        where: whereConditions,
        include: {
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { dateTo: "desc" },
      });

      res.json({
        success: true,
        data: reports,
        total: reports.length,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // MARK AS READ
  // ========================================
  static async markAsRead(
    req: Request<{ id: string }>,
    res: Response
  ) {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Check if receiver relationship exists
      const receiver = await prisma.weeklyReportReceiver.findUnique({
        where: {
          reportId_userId: {
            reportId: id,
            userId,
          },
        },
      });

      if (!receiver) {
        return res.status(404).json({ 
          message: "Report not found in your inbox" 
        });
      }

      const updated = await prisma.weeklyReportReceiver.update({
        where: {
          reportId_userId: {
            reportId: id,
            userId,
          },
        },
        data: { read: true },
      });

      res.json({
        success: true,
        message: "Report marked as read",
        data: updated,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
}
