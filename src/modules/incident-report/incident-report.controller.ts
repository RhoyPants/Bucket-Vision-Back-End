import { Request, Response } from "express";
import {
  fetchSharePointFile,
  uploadBufferToSharePoint,
} from "../../services/sharepoint-upload.service";
import { incidentReportService } from "./incident-report.service";

const errorStatus = (error: any) => {
  if (
    ["Incident report not found", "Attachment not found", "Project not found or access denied"]
      .includes(error.message)
  ) {
    return 404;
  }
  if (
    error.message?.includes("Only the reporter") ||
    error.message?.includes("access denied")
  ) {
    return 403;
  }
  if (error.message?.includes("Only pending")) return 409;
  return 400;
};

const filesFromRequest = (req: any): Express.Multer.File[] => {
  const rawFiles = req.files;
  if (Array.isArray(rawFiles)) return rawFiles;
  return [
    ...((rawFiles?.attachments as Express.Multer.File[]) || []),
    ...((rawFiles?.files as Express.Multer.File[]) || []),
  ];
};

const withAttachmentProxy = (value: any, token?: string): any => {
  if (Array.isArray(value)) {
    return value.map((item) => withAttachmentProxy(item, token));
  }
  if (!value || typeof value !== "object") return value;
  const result: any = { ...value };
  if (result.incidentId && result.fileUrl && result.id) {
    result.proxyUrl = `/api/incidents/attachments/${result.id}/file${
      token ? `?token=${encodeURIComponent(token)}` : ""
    }`;
  }
  if (result.attachments) {
    result.attachments = withAttachmentProxy(result.attachments, token);
  }
  return result;
};

const bearerToken = (req: Request) => {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
};

export class IncidentReportController {
  async list(req: Request, res: Response) {
    try {
      const result = await incidentReportService.list((req as any).user.id, req.query);
      res.json({
        success: true,
        data: withAttachmentProxy(result.data, bearerToken(req)),
        pagination: result.pagination,
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const data = await incidentReportService.getById(
        String(req.params.id),
        (req as any).user.id
      );
      res.json({
        success: true,
        data: withAttachmentProxy(data, bearerToken(req)),
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const files = filesFromRequest(req);
      if (files.length > 10) throw new Error("A maximum of 10 attachments is allowed");

      let incident = await incidentReportService.create(userId, req.body);
      for (const file of files) {
        const uploaded = await uploadBufferToSharePoint({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          folder: `incidents/${incident.id}`,
        });
        await incidentReportService.addAttachment(incident.id, userId, {
          fileUrl: uploaded.downloadUrl || uploaded.webUrl || "",
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        });
      }

      if (files.length) {
        incident = await incidentReportService.getById(incident.id, userId);
      }

      res.status(201).json({
        success: true,
        message: "Incident report created successfully",
        data: withAttachmentProxy(incident, bearerToken(req)),
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const data = await incidentReportService.update(
        String(req.params.id),
        (req as any).user.id,
        req.body
      );
      res.json({
        success: true,
        message: "Incident report updated successfully",
        data: withAttachmentProxy(data, bearerToken(req)),
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async resolve(req: Request, res: Response) {
    try {
      const data = await incidentReportService.resolve(
        String(req.params.id),
        (req as any).user.id,
        req.body
      );
      res.json({
        success: true,
        message: "Incident report resolved successfully",
        data: withAttachmentProxy(data, bearerToken(req)),
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async cancel(req: Request, res: Response) {
    try {
      const data = await incidentReportService.cancel(
        String(req.params.id),
        (req as any).user.id,
        req.body
      );
      res.json({
        success: true,
        message: "Incident report cancelled successfully",
        data: withAttachmentProxy(data, bearerToken(req)),
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const data = await incidentReportService.delete(
        String(req.params.id),
        (req as any).user.id
      );
      res.json({
        success: true,
        message: "Incident report deleted successfully",
        data,
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async listAttachments(req: Request, res: Response) {
    try {
      const data = await incidentReportService.listAttachments(
        String(req.params.id),
        (req as any).user.id
      );
      res.json({
        success: true,
        data: withAttachmentProxy(data, bearerToken(req)),
        count: data.length,
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async uploadAttachments(req: Request, res: Response) {
    try {
      const incidentId = String(req.params.id);
      const userId = (req as any).user.id;
      const files = filesFromRequest(req);
      if (!files.length) throw new Error("No files provided");
      if (files.length > 10) throw new Error("A maximum of 10 attachments is allowed");

      const created = [];
      for (const file of files) {
        const uploaded = await uploadBufferToSharePoint({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          folder: `incidents/${incidentId}`,
        });
        created.push(
          await incidentReportService.addAttachment(incidentId, userId, {
            fileUrl: uploaded.downloadUrl || uploaded.webUrl || "",
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          })
        );
      }

      res.status(201).json({
        success: true,
        message: "Incident attachments uploaded successfully",
        data: withAttachmentProxy(created, bearerToken(req)),
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async streamAttachment(req: Request, res: Response) {
    try {
      const attachment = await incidentReportService.getAttachment(
        String(req.params.attachmentId),
        (req as any).user.id
      );
      const file = await fetchSharePointFile(attachment.fileUrl);
      res.setHeader("Content-Type", attachment.mimeType || file.contentType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(attachment.fileName)}"`
      );
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(file.buffer);
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }

  async deleteAttachment(req: Request, res: Response) {
    try {
      const data = await incidentReportService.deleteAttachment(
        String(req.params.attachmentId),
        (req as any).user.id
      );
      res.json({
        success: true,
        message: "Incident attachment deleted successfully",
        data,
      });
    } catch (error: any) {
      res.status(errorStatus(error)).json({ success: false, message: error.message });
    }
  }
}

export const incidentReportController = new IncidentReportController();

