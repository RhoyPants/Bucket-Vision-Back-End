import { Request, Response } from "express";
import { incidentTypeService } from "./incident-type.service";
import { CreateIncidentTypeDTO, UpdateIncidentTypeDTO } from "./incident-type.dto";
import { incidentReportService } from "../../incident-report/incident-report.service";
import { IncidentApiError } from "../../incident-report/workflow/incident-workflow.contract";

const sendError = (res: Response, error: any) => {
  const status = error.status || (error.code === "P2003" || error.code === "P2034" ? 409 : 500);
  if (status === 500) console.error("Incident type error", error);
  return res.status(status).json({
    success: false,
    error: {
      code: error.code === "P2003" ? "IN_USE" : error.code === "P2034" ? "CONFLICT" : error.code || "INTERNAL_ERROR",
      message: status === 500 ? "Unable to complete the request." : error.code === "P2003" ? "Referenced by incidents." : error.code === "P2034" ? "The record changed during this request. Please retry." : error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  });
};

export class IncidentTypeController {
  async list(req: Request, res: Response) {
    try { res.json({ success: true, ...await incidentTypeService.list(req.query) }); }
    catch (error) { sendError(res, error); }
  }

  async getById(req: Request, res: Response) {
    try { res.json({ success: true, data: await incidentTypeService.get(String(req.params.id)) }); }
    catch (error) { sendError(res, error); }
  }

  async create(req: Request, res: Response) {
    try { res.status(201).json({ success: true, data: await incidentTypeService.save(req.body as CreateIncidentTypeDTO) }); }
    catch (error) { sendError(res, error); }
  }

  async update(req: Request, res: Response) {
    try { res.json({ success: true, data: await incidentTypeService.save(req.body as UpdateIncidentTypeDTO, String(req.params.id)) }); }
    catch (error) { sendError(res, error); }
  }

  async delete(req: Request, res: Response) {
    try { res.json({ success: true, data: await incidentTypeService.delete(String(req.params.id)) }); }
    catch (error) { sendError(res, error); }
  }

  async lookup(req: Request, res: Response) {
    try {
      if (req.query.projectId) await incidentReportService.ensureProjectAccess(String(req.query.projectId), (req as any).user.id);
      res.json({ success: true, ...await incidentTypeService.list(req.query, true) });
    } catch (error: any) {
      if (error.message === "Project not found or access denied") error = new IncidentApiError(404, "NOT_FOUND", error.message);
      sendError(res, error);
    }
  }
}
export const incidentTypeController = new IncidentTypeController();
