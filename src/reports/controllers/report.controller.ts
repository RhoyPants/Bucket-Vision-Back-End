import { Request, Response } from "express";
import { reportDataService } from "../services/report-data.service";
import { reportPdfService } from "../services/report-pdf.service";
import { reportExcelService } from "../services/report-excel.service";

function sendError(res: Response, error: any) {
  const status = Number(error?.statusCode) || 500;
  if (status === 500) {
    console.error("Project report generation failed:", error);
  }
  return res.status(status).json({
    success: false,
    message: status === 500 ? "Unable to generate project report" : error.message,
    ...(status === 500 && process.env.NODE_ENV !== "production"
      ? { developmentError: error?.message || String(error) }
      : {}),
  });
}

export class ReportController {
  static async preview(req: Request, res: Response) {
    try {
      const data = await reportDataService.buildPreview(
        String(req.params.projectId),
        (req as any).user.id,
        req.query
      );
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }

  static async calendar(req: Request, res: Response) {
    try {
      const data = await reportDataService.getCalendar(
        String(req.params.projectId),
        (req as any).user.id,
        req.query.month
      );
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }

  static async pdf(req: Request, res: Response) {
    try {
      const data = await reportDataService.buildPreview(
        String(req.params.projectId),
        (req as any).user.id,
        req.query
      );
      const pdf = await reportPdfService.generate(data);
      const download =
        String(req.query.mode || "").toLowerCase() === "download" ||
        String(req.query.download || "").toLowerCase() === "true";
      const pin = String(data.project.pin || data.project.name || "Project")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      const period =
        data.report.type === "DAILY"
          ? data.report.periodEnd
          : `${data.report.periodStart}-to-${data.report.periodEnd}`;
      const filename = `BV-${pin}-${data.report.type === "DAILY" ? "Daily" : "Weekly"}-Report-${period}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(pdf.length));
      res.setHeader(
        "Content-Disposition",
        `${download ? "attachment" : "inline"}; filename="${filename}"`
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.send(pdf);
    } catch (error) {
      sendError(res, error);
    }
  }

  static async excel(req: Request, res: Response) {
    try {
      const projectId = String(req.params.projectId);
      const data = await reportDataService.buildPreview(
        projectId,
        (req as any).user.id,
        req.query
      );
      const workbook = await reportExcelService.generate(projectId, data);
      const pin = String(data.project.pin || data.project.name || "Project")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      const period =
        data.report.type === "DAILY"
          ? data.report.periodEnd
          : `${data.report.periodStart}-to-${data.report.periodEnd}`;
      const filename = `BV-${pin}-${data.report.type === "DAILY" ? "Daily" : "Weekly"}-Report-${period}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Length", String(workbook.length));
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(workbook);
    } catch (error) {
      sendError(res, error);
    }
  }
}
