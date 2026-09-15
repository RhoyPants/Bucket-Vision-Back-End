import { Request, Response } from "express";
import { incidentCaseManagementService } from "./incident-case-management.service";
import { incidentWorkflowService } from "../workflow/incident-workflow.service";
import { incidentReportService } from "../incident-report.service";
import { incidentReportPdfService } from "../reporting/incident-report-pdf.service";

const fail=(res:Response,e:any)=>res.status(e.status||400).json({success:false,error:{code:e.code||"VALIDATION_ERROR",message:e.message, ...(e.fields?{fields:e.fields}:{})}});
export class IncidentCaseManagementController {
  async getInvestigation(req:Request,res:Response){try{res.json({success:true,data:await incidentCaseManagementService.investigation(String(req.params.id),(req as any).user.id)});}catch(e){fail(res,e);}}
  async saveInvestigation(req:Request,res:Response){try{res.json({success:true,data:await incidentCaseManagementService.saveInvestigation(String(req.params.id),(req as any).user.id,req.body)});}catch(e){fail(res,e);}}
  async listActions(req:Request,res:Response){try{res.json({success:true,...await incidentCaseManagementService.actions(String(req.params.id),(req as any).user.id,req.query)});}catch(e){fail(res,e);}}
  async getAction(req:Request,res:Response){try{res.json({success:true,data:await incidentCaseManagementService.action(String(req.params.id),String(req.params.actionId),(req as any).user.id)});}catch(e){fail(res,e);}}
  async createAction(req:Request,res:Response){try{res.status(201).json({success:true,data:await incidentCaseManagementService.createAction(String(req.params.id),(req as any).user.id,req.body)});}catch(e){fail(res,e);}}
  async updateAction(req:Request,res:Response){try{res.json({success:true,data:await incidentCaseManagementService.updateAction(String(req.params.id),String(req.params.actionId),(req as any).user.id,req.body)});}catch(e){fail(res,e);}}
  async ownerOptions(req:Request,res:Response){try{res.json({success:true,...await incidentCaseManagementService.ownerOptions(String(req.params.id),(req as any).user.id,req.query)});}catch(e){fail(res,e);}}
  async readiness(req:Request,res:Response){try{res.json({success:true,data:await incidentCaseManagementService.readiness(String(req.params.id),(req as any).user.id)});}catch(e){fail(res,e);}}
  async history(req:Request,res:Response){try{await incidentReportService.getById(String(req.params.id),(req as any).user.id);res.json({success:true,...await incidentWorkflowService.history(String(req.params.id),req.query)});}catch(e){fail(res,e);}}
  async report(req:Request,res:Response){try{const id=String(req.params.id);const incident=await incidentReportService.getById(id,(req as any).user.id);const pdf=await incidentReportPdfService.generate(id,(req as any).user.id);res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`attachment; filename="${incident.incidentNumber}.pdf"`);res.send(pdf);}catch(e){fail(res,e);}}
}
export const incidentCaseManagementController=new IncidentCaseManagementController();
