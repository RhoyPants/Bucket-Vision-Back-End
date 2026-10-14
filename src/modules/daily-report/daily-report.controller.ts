import { Request, Response } from "express";
import prisma from "../../config/prisma";
import { assertUploadedObject, buildAssetUrl, deleteManagedAsset, fileKeyFromStoredValue, validateStoredFileReference } from "../../services/s3-assets.service";
import {
  CreateDailyReportDTO,
  UpdateDailyReportDTO,
  DailyReportParamsDTO,
  DailyReportFilterDTO,
  DailyReportSummaryDTO,
} from "./daily-report.dto";

export class DailyReportController {
  // ========================================
  // CREATE
  // ========================================
  static async create(
    req: Request<{}, {}, CreateDailyReportDTO>,
    res: Response
  ) {
    try {
      const { projectId, dayNumber, date, location, remarks, attachments, receiverIds } =
        req.body;
      const userId = (req as any).user.id;
      const attachmentInputs: any[] = Array.isArray(attachments) ? attachments : [];
      const attachmentReferences = attachmentInputs
        .filter((value) => value && typeof value === "object")
        .map((value) => validateStoredFileReference(value, "daily-reports"));
      await Promise.all(attachmentReferences.map(assertUploadedObject));
      const legacyAttachments = attachmentInputs.filter((value) => typeof value === "string") as string[];

      // Validate project exists
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Validate receivers exist if provided
      if (receiverIds && receiverIds.length > 0) {
        const receivers = await prisma.user.findMany({
          where: { id: { in: receiverIds } },
        });

        if (receivers.length !== receiverIds.length) {
          return res.status(404).json({ message: "One or more receivers not found" });
        }
      }

      const dailyReport = await prisma.dailyReport.create({
        data: {
          userId,
          projectId,
          dayNumber,
          date: new Date(date),
          location,
          remarks,
          attachments: legacyAttachments,
          ...(attachmentReferences.length > 0 && {
            uploadedFiles: { create: attachmentReferences.map((file) => ({
              uploadedBy: userId, fileUrl: file.fileKey, fileName: file.fileName,
              mimeType: file.contentType, size: file.fileSize,
            })) },
          }),
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
          project: {
            select: { id: true, name: true },
          },
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
          uploadedFiles: true,
        },
      });

      res.json(dailyReport);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET ALL (with filters)
  // ========================================
  static async getAll(req: Request<{}, {}, {}, DailyReportFilterDTO>, res: Response) {
    try {
      const { projectId, userId, dateFrom, dateTo, search } = req.query;

      const whereConditions: any = {};

      if (projectId) {
        whereConditions.projectId = projectId;
      }

      if (userId) {
        whereConditions.userId = userId;
      }

      if (dateFrom || dateTo) {
        whereConditions.date = {};

        if (dateFrom) {
          whereConditions.date.gte = new Date(dateFrom as string);
        }

        if (dateTo) {
          whereConditions.date.lte = new Date(dateTo as string);
        }
      }

      if (search) {
        whereConditions.OR = [
          { location: { contains: search as string, mode: "insensitive" } },
          { remarks: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const reports = await prisma.dailyReport.findMany({
        where: whereConditions,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          project: {
            select: { id: true, name: true },
          },
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { date: "desc" },
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
    req: Request<DailyReportParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const report = await prisma.dailyReport.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          project: {
            select: { id: true, name: true, description: true },
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
        return res.status(404).json({ message: "Daily report not found" });
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
    req: Request<DailyReportParamsDTO, {}, UpdateDailyReportDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;
      const { dayNumber, date, location, remarks, attachments, receiverIds } = req.body;

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
        await prisma.dailyReportReceiver.deleteMany({
          where: { reportId: id },
        });
      }

      const updated = await prisma.dailyReport.update({
        where: { id },
        data: {
          ...(dayNumber !== undefined && { dayNumber }),
          ...(date && { date: new Date(date) }),
          ...(location && { location }),
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
          project: {
            select: { id: true, name: true },
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
    req: Request<DailyReportParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const report = await prisma.dailyReport.findUnique({
        where: { id },
        include: { uploadedFiles: true },
      });

      if (!report) {
        return res.status(404).json({ message: "Daily report not found" });
      }

      for (const attachment of report.uploadedFiles) {
        await deleteManagedAsset(attachment.fileUrl);
        await prisma.attachment.delete({ where: { id: attachment.id } });
      }
      await prisma.dailyReport.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: "Daily report deleted successfully",
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ========================================
  // GET BY PROJECT
  // ========================================
  static async getByProject(
    req: Request<{ projectId: string }>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;
      const { dateFrom, dateTo } = req.query;

      const whereConditions: any = { projectId };

      if (dateFrom || dateTo) {
        whereConditions.date = {};

        if (dateFrom) {
          whereConditions.date.gte = new Date(dateFrom as string);
        }

        if (dateTo) {
          whereConditions.date.lte = new Date(dateTo as string);
        }
      }

      const reports = await prisma.dailyReport.findMany({
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
        orderBy: { date: "desc" },
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
        whereConditions.date = {};

        if (dateFrom) {
          whereConditions.date.gte = new Date(dateFrom as string);
        }

        if (dateTo) {
          whereConditions.date.lte = new Date(dateTo as string);
        }
      }

      if (search) {
        whereConditions.OR = [
          { location: { contains: search as string, mode: "insensitive" } },
          { remarks: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const reports = await prisma.dailyReport.findMany({
        where: whereConditions,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          project: {
            select: { id: true, name: true },
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
        orderBy: { date: "desc" },
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
        whereConditions.date = {};

        if (dateFrom) {
          whereConditions.date.gte = new Date(dateFrom as string);
        }

        if (dateTo) {
          whereConditions.date.lte = new Date(dateTo as string);
        }
      }

      if (search) {
        whereConditions.OR = [
          { location: { contains: search as string, mode: "insensitive" } },
          { remarks: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const reports = await prisma.dailyReport.findMany({
        where: whereConditions,
        include: {
          project: {
            select: { id: true, name: true },
          },
          receivers: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { date: "desc" },
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
      const receiver = await prisma.dailyReportReceiver.findUnique({
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

      const updated = await prisma.dailyReportReceiver.update({
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

  // ========================================
  // GET SUMMARY/DASHBOARD
  // ========================================
  static async getSummary(req: Request, res: Response) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const dayWhere = {
        date: {
          gte: today,
          lte: endOfDay,
        },
      };

      const [totalSubmitted, totalReviewed, totalPending] = await Promise.all([
        prisma.dailyReport.count({ where: dayWhere }),
        prisma.dailyReport.count({
          where: {
            ...dayWhere,
            receivers: {
              some: {},
              every: { read: true },
            },
          },
        }),
        prisma.dailyReport.count({
          where: {
            ...dayWhere,
            receivers: {
              some: { read: false },
            },
          },
        }),
      ]);

      // Existing logic effectively yields zero because dataset is restricted to today's reports.
      const lateReports = 0;

      const summary: DailyReportSummaryDTO = {
        totalSubmitted,
        totalPending,
        totalReviewed,
        lateReports,
        todayHighlights: {
          submittedCount: totalSubmitted,
          lateCount: lateReports,
          onTimeCount: totalSubmitted - lateReports,
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
}

// ========================================
// 📎 DAILY REPORT ATTACHMENTS
// ========================================
export async function uploadDailyReportAttachment(req: any, res: Response) {
  try {
    const { id: reportId } = req.params;
    const userId = req.user?.id;
    const files = Array.isArray(req.body?.attachments) ? req.body.attachments : [];

    if (!files.length) {
      return res.status(400).json({ success: false, message: "No files provided" });
    }

    const report = await prisma.dailyReport.findUnique({ where: { id: reportId } });
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });

    const created = await Promise.all(
      files.map(async (file: any) => {
        const reference = validateStoredFileReference(file, "daily-reports", reportId);
        await assertUploadedObject(reference);
        return prisma.attachment.create({
          data: {
            dailyReportId: reportId,
            uploadedBy: userId,
            fileUrl: reference.fileKey,
            fileName: reference.fileName,
            mimeType: reference.contentType,
            size: reference.fileSize,
          },
        });
      })
    );

    res.json({ success: true, data: created });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function deleteDailyReportAttachment(req: any, res: Response) {
  try {
    let { attachmentId } = req.params;
    if (Array.isArray(attachmentId)) attachmentId = attachmentId[0];
    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) return res.status(404).json({ success: false, message: "Attachment not found" });
    await deleteManagedAsset(attachment.fileUrl);
    await prisma.attachment.delete({ where: { id: attachmentId } });
    res.json({ success: true, message: "Attachment deleted" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function streamDailyReportAttachment(req: any, res: Response) {
  try {
    let { attachmentId } = req.params;
    if (Array.isArray(attachmentId)) attachmentId = attachmentId[0];

    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) return res.status(404).json({ success: false, message: "Attachment not found" });

    const fileKey = fileKeyFromStoredValue(attachment.fileUrl);
    if (fileKey) return res.redirect(buildAssetUrl(fileKey));
    return res.status(410).json({ success: false, message: "Legacy attachment is no longer available" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
}
