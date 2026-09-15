import { Request, Response } from "express";
import { incidentInboxService } from "./incident-inbox.service";
const fail=(res:Response,error:any)=>res.status(error.status||500).json({success:false,error:{code:error.code||"INTERNAL_ERROR",message:error.status?error.message:"Unable to complete the request.",...(error.fields?{fields:error.fields}:{})}});
const user=(req:Request)=>(req as any).user.id;
export class IncidentInboxController {
  summary=async(req:Request,res:Response)=>{try{res.json({success:true,data:await incidentInboxService.summary(user(req),req.query)});}catch(e){fail(res,e);}};
  myReports=async(req:Request,res:Response)=>{try{res.json({success:true,...await incidentInboxService.myReports(user(req),req.query)});}catch(e){fail(res,e);}};
  forMyAction=async(req:Request,res:Response)=>{try{res.json({success:true,...await incidentInboxService.forMyAction(user(req),req.query)});}catch(e){fail(res,e);}};
  myCorrectiveActions=async(req:Request,res:Response)=>{try{res.json({success:true,...await incidentInboxService.myCorrectiveActions(user(req),req.query)});}catch(e){fail(res,e);}};
  all=async(req:Request,res:Response)=>{try{res.json({success:true,...await incidentInboxService.all(user(req),req.query)});}catch(e){fail(res,e);}};
  projects=async(req:Request,res:Response)=>{try{res.json({success:true,...await incidentInboxService.filterOptions(user(req),req.query,"projects")});}catch(e){fail(res,e);}};
  incidentTypes=async(req:Request,res:Response)=>{try{res.json({success:true,...await incidentInboxService.filterOptions(user(req),req.query,"incidentTypes")});}catch(e){fail(res,e);}};
}
export const incidentInboxController=new IncidentInboxController();
