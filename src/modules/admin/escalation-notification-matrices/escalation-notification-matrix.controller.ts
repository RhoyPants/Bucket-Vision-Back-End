import { Request, Response } from "express";
import { escalationNotificationMatrixService as service } from "./escalation-notification-matrix.service";

const sendError = (res: Response, error: any) => {
  const status = error.status || (error.code === "P2003" || error.code === "P2034" ? 409 : 500);
  if (status === 500) console.error("Escalation notification matrix error", error);
  return res.status(status).json({
    success: false,
    error: {
      code: error.code === "P2003" ? "IN_USE" : error.code === "P2034" ? "CONFLICT" : error.code || "INTERNAL_ERROR",
      message: status === 500 ? "Unable to complete the request." : error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  });
};

export class EscalationNotificationMatrixController {
  list = async (req: Request, res: Response) => { try { res.json({ success: true, ...await service.list(req.query) }); } catch (e) { sendError(res, e); } };
  get = async (req: Request, res: Response) => { try { res.json({ success: true, data: await service.get(String(req.params.id)) }); } catch (e) { sendError(res, e); } };
  create = async (req: Request, res: Response) => { try { res.status(201).json({ success: true, data: await service.save(req.body) }); } catch (e) { sendError(res, e); } };
  update = async (req: Request, res: Response) => { try { res.json({ success: true, data: await service.save(req.body, String(req.params.id)) }); } catch (e) { sendError(res, e); } };
  delete = async (req: Request, res: Response) => { try { res.json({ success: true, data: await service.delete(String(req.params.id)) }); } catch (e) { sendError(res, e); } };
}
export const escalationNotificationMatrixController = new EscalationNotificationMatrixController();
