import { Request,Response } from "express";
import { notificationService } from "./notification.service";
const user=(req:Request)=>(req as any).user.id;const fail=(res:Response,e:any)=>res.status(e.status||500).json({success:false,error:{code:e.code||"INTERNAL_ERROR",message:e.status?e.message:"Unable to complete the request.",...(e.fields?{fields:e.fields}:{})}});
export class NotificationController{
 summary=async(req:Request,res:Response)=>{try{res.json({success:true,data:await notificationService.summary(user(req))});}catch(e){fail(res,e);}};
 list=async(req:Request,res:Response)=>{try{res.json({success:true,...await notificationService.list(user(req),req.query)});}catch(e){fail(res,e);}};
 acknowledgements=async(req:Request,res:Response)=>{try{res.json({success:true,data:await notificationService.acknowledgements(user(req),req.query)});}catch(e){fail(res,e);}};
 get=async(req:Request,res:Response)=>{try{res.json({success:true,data:await notificationService.get(String(req.params.notificationId),user(req))});}catch(e){fail(res,e);}};
 read=async(req:Request,res:Response)=>{try{res.json({success:true,data:await notificationService.read(String(req.params.notificationId),user(req))});}catch(e){fail(res,e);}};
 readAll=async(req:Request,res:Response)=>{try{res.json({success:true,message:"Notifications marked as read",data:await notificationService.readAll(user(req),req.body)});}catch(e){fail(res,e);}};
 acknowledge=async(req:Request,res:Response)=>{try{res.json({success:true,message:"Notification acknowledged",data:await notificationService.acknowledge(String(req.params.notificationId),user(req),req.body)});}catch(e){fail(res,e);}};
 archive=async(req:Request,res:Response)=>{try{res.json({success:true,message:"Notification archived",data:await notificationService.archive(String(req.params.notificationId),user(req))});}catch(e){fail(res,e);}};
 restore=async(req:Request,res:Response)=>{try{res.json({success:true,message:"Notification restored",data:await notificationService.restore(String(req.params.notificationId),user(req))});}catch(e){fail(res,e);}};
 archiveAll=async(req:Request,res:Response)=>{try{res.json({success:true,data:await notificationService.archiveAll(user(req),req.body)});}catch(e){fail(res,e);}};
}
export const notificationController=new NotificationController();
