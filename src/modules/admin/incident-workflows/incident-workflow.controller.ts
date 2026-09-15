import { Request, Response } from "express";
import { incidentWorkflowService } from "./incident-workflow.service";
import { CreateIncidentWorkflowDTO, UpdateIncidentWorkflowDTO } from "./incident-workflow.dto";

const sendError = (res: Response, error: any) => {
  const status = error.status || (error.code === "P2003" || error.code === "P2034" ? 409 : 500);
  if (status === 500) console.error("Incident workflow error", error);
  return res.status(status).json({
    success: false,
    error: {
      code: error.code === "P2003" ? "IN_USE" : error.code === "P2034" ? "CONFLICT" : error.code || "INTERNAL_ERROR",
      message: status === 500 ? "Unable to complete the request." : error.code === "P2003" ? "Referenced by incident types or incidents." : error.code === "P2034" ? "The record changed during this request. Please retry." : error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  });
};

export class IncidentWorkflowController {
  async list(req: Request, res: Response) {
    try { res.json({ success: true, ...await incidentWorkflowService.list(req.query) }); }
    catch (error) { sendError(res, error); }
  }

  async getById(req: Request, res: Response) {
    try { res.json({ success: true, data: await incidentWorkflowService.get(String(req.params.id)) }); }
    catch (error) { sendError(res, error); }
  }

  async create(req: Request, res: Response) {
    try { res.status(201).json({ success: true, data: await incidentWorkflowService.save(req.body as CreateIncidentWorkflowDTO) }); }
    catch (error) { sendError(res, error); }
  }

  async update(req: Request, res: Response) {
    try { res.json({ success: true, data: await incidentWorkflowService.save(req.body as UpdateIncidentWorkflowDTO, String(req.params.id)) }); }
    catch (error) { sendError(res, error); }
  }

  async delete(req: Request, res: Response) {
    try { res.json({ success: true, data: await incidentWorkflowService.delete(String(req.params.id)) }); }
    catch (error) { sendError(res, error); }
  }
}
export const incidentWorkflowController = new IncidentWorkflowController();
