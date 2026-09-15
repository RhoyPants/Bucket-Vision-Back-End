import prisma from "../../config/prisma";
import { IncidentApiError, invalid, pagination } from "../incident-report/workflow/incident-workflow.contract";

const CATEGORIES=["PROJECT","APPROVAL","PROGRESS_UPDATE","INCIDENT","CORRECTIVE_ACTION","SYSTEM"];
const PRIORITIES=["LOW","NORMAL","HIGH","URGENT"];
const STATES=["ALL","UNREAD","READ","UNACKNOWLEDGED","ARCHIVED"];

export interface CreateNotificationInput { recipientId:string;type:string;category:string;priority?:string;title:string;message:string;requiresAcknowledgement?:boolean;actorId?:string|null;target?:any;metadata?:any;eventKey?:string|null; }

export class NotificationService {
  async create(tx:any,input:CreateNotificationInput){if(!CATEGORIES.includes(input.category))invalid("category","Invalid notification category.");if(!PRIORITIES.includes(input.priority||"NORMAL"))invalid("priority","Invalid notification priority.");const data={userId:input.recipientId,type:input.type,category:input.category,priority:input.priority||"NORMAL",title:input.title,message:input.message,requiresAcknowledgement:!!input.requiresAcknowledgement,actorId:input.actorId||null,target:input.target||undefined,metadata:input.metadata||undefined,eventKey:input.eventKey||null};return input.eventKey?tx.notification.upsert({where:{eventKey:input.eventKey},create:data,update:{}}):tx.notification.create({data});}
  private where(userId:string,query:any){const state=String(query.state||"ALL").toUpperCase();if(!STATES.includes(state))invalid("state",`Use ${STATES.join(", ")}.`);if(query.category&&!CATEGORIES.includes(String(query.category)))invalid("category","Invalid notification category.");if(query.priority&&!PRIORITIES.includes(String(query.priority)))invalid("priority","Invalid notification priority.");const search=String(query.search||"").trim();return{userId,...(state==="ARCHIVED"?{archivedAt:{not:null}}:{archivedAt:null}),...(state==="UNREAD"?{readAt:null}:state==="READ"?{readAt:{not:null}}:state==="UNACKNOWLEDGED"?{requiresAcknowledgement:true,acknowledgedAt:null}:{}),...(query.category?{category:String(query.category)}:{}),...(query.priority?{priority:String(query.priority)}:{}),...(search?{OR:[{title:{contains:search,mode:"insensitive"}},{message:{contains:search,mode:"insensitive"}}]}:{})};}
  private async actorMap(rows:any[]){const ids=[...new Set(rows.map(x=>x.actorId).filter(Boolean))] as string[];const users=ids.length?await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,name:true}}):[];return new Map(users.map(x=>[x.id,x]));}
  private view(row:any,actors:Map<string,any>){return{id:row.id,recipientId:row.userId,type:row.type,category:row.category,priority:row.priority,title:row.title||String(row.type).replace(/_/g," ").toLowerCase().replace(/^./,x=>x.toUpperCase()),message:row.message,requiresAcknowledgement:row.requiresAcknowledgement,readAt:row.readAt,acknowledgedAt:row.acknowledgedAt,acknowledgementRemarks:row.acknowledgementRemarks,archivedAt:row.archivedAt,createdAt:row.createdAt,actor:row.actorId?actors.get(row.actorId)||null:null,target:row.target||null,metadata:row.metadata||null,permissions:{canRead:!row.readAt,canAcknowledge:row.requiresAcknowledgement&&!row.acknowledgedAt,canArchive:!row.archivedAt&&(!row.requiresAcknowledgement||!!row.acknowledgedAt)}};}
  async list(userId:string,query:any){const {page,limit}=pagination(query);const where:any=this.where(userId,query);const [rows,total]=await prisma.$transaction([prisma.notification.findMany({where,orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(page-1)*limit,take:limit}),prisma.notification.count({where})]);const actors=await this.actorMap(rows);return{data:rows.map(x=>this.view(x,actors)),pagination:{page,limit,total,totalPages:Math.ceil(total/limit)}};}
  async summary(userId:string){const active={userId,archivedAt:null};const [unreadCount,unacknowledgedCount,groups]=await prisma.$transaction([prisma.notification.count({where:{...active,readAt:null}}),prisma.notification.count({where:{...active,requiresAcknowledgement:true,acknowledgedAt:null}}),prisma.notification.groupBy({by:["category"],where:active,_count:{_all:true},orderBy:{category:"asc"}})]);return{unreadCount,unacknowledgedCount,byCategory:Object.fromEntries((groups as any[]).map(x=>[x.category,x._count._all]))};}
  private async own(id:string,userId:string){const row=await prisma.notification.findFirst({where:{id,userId}});if(!row)throw new IncidentApiError(404,"NOT_FOUND","Notification not found.");return row;}
  async get(id:string,userId:string){const row=await this.own(id,userId);return this.view(row,await this.actorMap([row]));}
  async read(id:string,userId:string){const row=await this.own(id,userId);if(!row.readAt){const now=new Date();await prisma.notification.update({where:{id},data:{readAt:now,isRead:true}});}const result=await this.own(id,userId);return{id:result.id,readAt:result.readAt,acknowledgedAt:result.acknowledgedAt};}
  async readAll(userId:string,body:any={}){if(body.category&&!CATEGORIES.includes(String(body.category)))invalid("category","Invalid notification category.");const now=new Date();const result=await prisma.notification.updateMany({where:{userId,archivedAt:null,readAt:null,...(body.category?{category:String(body.category)}:{})},data:{readAt:now,isRead:true}});return{updatedCount:result.count,readAt:now};}
  private async notifyAcknowledgement(tx:any,row:any,userId:string,remarks:string|null){
    const target:any=row.target||{};
    const metadata:any=row.metadata||{};
    let type:string|null=null;
    let category=row.category;
    let title="Assignment acknowledged";
    let recipientIds:string[]=[];

    if(row.type==="PROGRESS_UPDATE_APPROVAL_ASSIGNED"){
      type="PROGRESS_UPDATE_APPROVAL_ACKNOWLEDGED";
      category="PROGRESS_UPDATE";
      title="Progress update assignment acknowledged";
      if(metadata.requesterId)recipientIds.push(String(metadata.requesterId));
    }else if(row.type==="PROJECT_APPROVAL_ASSIGNED"){
      type="PROJECT_APPROVAL_ACKNOWLEDGED";
      category="APPROVAL";
      title="Project approval assignment acknowledged";
      if(row.actorId)recipientIds.push(String(row.actorId));
    }else if(row.type==="INCIDENT_WORKFLOW_LEVEL_ASSIGNED"){
      type="INCIDENT_WORKFLOW_LEVEL_ACKNOWLEDGED";
      category="INCIDENT";
      title="Incident workflow assignment acknowledged";
      if(target.incidentId){
        const incident=await tx.incidentReport.findUnique({where:{id:String(target.incidentId)},select:{reportedById:true}});
        if(incident?.reportedById)recipientIds.push(incident.reportedById);
      }
    }else if(row.type==="INCIDENT_CORRECTIVE_ACTION_ASSIGNED"){
      type="INCIDENT_CORRECTIVE_ACTION_ACKNOWLEDGED";
      category="CORRECTIVE_ACTION";
      title="Corrective action assignment acknowledged";
      if(row.actorId)recipientIds.push(String(row.actorId));
    }

    if(!type)return;
    recipientIds=[...new Set(recipientIds)].filter(recipientId=>recipientId!==userId);
    const actor=await tx.user.findUnique({where:{id:userId},select:{name:true}});
    for(const recipientId of recipientIds)await this.create(tx,{
      recipientId,type,category,priority:"NORMAL",title,
      message:`${actor?.name||"The assignee"} acknowledged the assignment.`,
      actorId:userId,target,metadata:{...metadata,sourceNotificationId:row.id,acknowledgementRemarks:remarks},
      eventKey:`${type}:${recipientId}:${row.id}`,
    });
  }

  async acknowledge(id:string,userId:string,body:any={}){
    const row=await this.own(id,userId);
    if(!row.requiresAcknowledgement)throw new IncidentApiError(409,"ACKNOWLEDGEMENT_NOT_REQUIRED","This notification does not require acknowledgement.");
    if(!row.acknowledgedAt){
      const remarks=body.remarks===undefined?null:String(body.remarks).trim()||null;
      const acknowledgedAt=new Date();
      await prisma.$transaction(async tx=>{
        await tx.notification.update({where:{id},data:{acknowledgedAt,acknowledgementRemarks:remarks,readAt:row.readAt||acknowledgedAt,isRead:true}});
        const target:any=row.target||{};
        const metadata:any=row.metadata||{};
        if(target.incidentId)await tx.incidentEscalationEvent.create({data:{incidentId:String(target.incidentId),eventType:"NOTIFICATION_ACKNOWLEDGED",timestamp:acknowledgedAt,actorId:userId,levelId:metadata.activeLevelId||null,details:{notificationId:id,recipientId:userId,notificationType:row.type,remarks,workflowLevelOrder:metadata.levelOrder||null,incidentId:target.incidentId,actionId:target.actionId||null}}});
        await this.notifyAcknowledgement(tx,row,userId,remarks);
      });
    }
    const result=await this.own(id,userId);
    return{id:result.id,readAt:result.readAt,acknowledgedAt:result.acknowledgedAt,acknowledgementRemarks:result.acknowledgementRemarks};
  }
  async acknowledgements(userId:string,query:any){const resourceType=String(query.resourceType||"");const incidentId=String(query.incidentId||"");const actionId=query.actionId?String(query.actionId):null;if(!incidentId)invalid("incidentId","incidentId is required.");if(!["INCIDENT","INCIDENT_ACTION","INCIDENT_INVESTIGATION"].includes(resourceType))invalid("resourceType","Use INCIDENT, INCIDENT_ACTION, or INCIDENT_INVESTIGATION.");const incident=await prisma.incidentReport.findUnique({where:{id:incidentId},include:{project:{select:{ownerId:true}},actions:{where:{ownerId:userId},select:{id:true}}}});if(!incident)throw new IncidentApiError(404,"NOT_FOUND","Incident not found.");if(actionId&&!await prisma.incidentAction.findFirst({where:{id:actionId,incidentId},select:{id:true}}))throw new IncidentApiError(404,"NOT_FOUND","Corrective action not found.");const requester=await prisma.user.findUnique({where:{id:userId},include:{role:true}});const member=await prisma.projectMember.findUnique({where:{projectId_userId:{projectId:incident.projectId,userId}},select:{role:true}});const recipient=await prisma.notification.findFirst({where:{userId,requiresAcknowledgement:true,AND:[{target:{path:["incidentId"],equals:incidentId}},...(actionId?[{target:{path:["actionId"],equals:actionId}}]:[])]},select:{id:true}});const currentResolver=(incident.workflow as any)?.eligibleResolvers?.some((x:any)=>x.id===userId);const allowed=!!recipient||requester?.role.name==="SUPERADMIN"||incident.reportedById===userId||incident.project.ownerId===userId||member?.role==="SUB_OWNER"||currentResolver||incident.actions.length>0;if(!allowed)throw new IncidentApiError(403,"FORBIDDEN","You do not have permission to view notification acknowledgements for this incident.");const rows=await prisma.notification.findMany({where:{requiresAcknowledgement:true,AND:[{target:{path:["resourceType"],equals:resourceType}},{target:{path:["incidentId"],equals:incidentId}},...(actionId?[{target:{path:["actionId"],equals:actionId}}]:[])]},include:{user:{select:{id:true,name:true}}},orderBy:[{createdAt:"asc"},{id:"asc"}]});return rows.map(row=>({notificationId:row.id,recipient:row.user,type:row.type,sentAt:row.createdAt,readAt:row.readAt,acknowledgedAt:row.acknowledgedAt,acknowledgementRemarks:row.acknowledgementRemarks,status:row.acknowledgedAt?"ACKNOWLEDGED":row.readAt?"READ":"AWAITING_ACKNOWLEDGEMENT"}));}
  async archive(id:string,userId:string){const row=await this.own(id,userId);if(row.requiresAcknowledgement&&!row.acknowledgedAt)throw new IncidentApiError(409,"ACKNOWLEDGEMENT_REQUIRED","Acknowledge this notification before archiving it.");if(!row.archivedAt)await prisma.notification.update({where:{id},data:{archivedAt:new Date(),readAt:row.readAt||new Date(),isRead:true}});const result=await this.own(id,userId);return{id:result.id,archivedAt:result.archivedAt};}
  async restore(id:string,userId:string){await this.own(id,userId);const result=await prisma.notification.update({where:{id},data:{archivedAt:null}});return{id:result.id,archivedAt:null};}
  async archiveAll(userId:string,body:any={}){if(body.category&&!CATEGORIES.includes(String(body.category)))invalid("category","Invalid notification category.");if(body.state&&!["READ","ALL"].includes(String(body.state)))invalid("state","Use READ or ALL.");const base:any={userId,archivedAt:null,...(body.category?{category:String(body.category)}:{}),...(body.state==="READ"?{readAt:{not:null}}:{})};const skippedUnacknowledgedCount=await prisma.notification.count({where:{...base,requiresAcknowledgement:true,acknowledgedAt:null}});const now=new Date();const result=await prisma.notification.updateMany({where:{...base,OR:[{requiresAcknowledgement:false},{acknowledgedAt:{not:null}}]},data:{archivedAt:now,readAt:now,isRead:true}});return{archivedCount:result.count,skippedUnacknowledgedCount};}
}
export const notificationService=new NotificationService();
