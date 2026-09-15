import prisma from "../../../config/prisma";
import { IncidentApiError, invalid, pagination } from "../workflow/incident-workflow.contract";
import { audit, lockIncident } from "../workflow/incident-workflow.service";
import { incidentReportService } from "../incident-report.service";
import { notificationService } from "../../notification/notification.service";

const USER = { id: true, name: true } as const;
const ACTION_INCLUDE = { owner: { select: USER }, completedBy: { select: USER }, cancelledBy: { select: USER }, evidence: { include: { user: { select: USER } }, orderBy: { displayOrder: "asc" as const } } };
const sections = ["INITIAL_REPORT","SITE_FINDINGS","IMMEDIATE_ACTION","ROOT_CAUSE","CONTRIBUTING_FACTORS","MITIGATION","RECOMMENDATIONS","ACTION","RESOLUTION"];

export class IncidentCaseManagementService {
  private async incident(id: string, userId: string) {
    const incident = await (prisma as any).incidentReport.findUnique({ where: { id } });
    if (!incident) throw new IncidentApiError(404, "NOT_FOUND", "Incident report not found");
    await incidentReportService.ensureIncidentAccess(incident, userId);
    return incident;
  }
  private resolver(incident: any, userId: string) { return incident.status === "PENDING" && incident.reportedById !== userId && incident.workflow?.eligibleResolvers?.some((u: any) => u.id === userId); }
  async investigation(id: string, userId: string) {
    const incident = await this.incident(id, userId);
    const row = await (prisma as any).incidentInvestigation.findUnique({ where: { incidentId: id }, include: { updatedBy: { select: USER } } });
    const evidence = await (prisma as any).incidentAttachment.findMany({ where: { incidentId: id, section: { in: sections.filter(s => !["INITIAL_REPORT","ACTION","RESOLUTION"].includes(s)) } }, include: { user: { select: USER } }, orderBy: [{ section: "asc" }, { displayOrder: "asc" }] });
    return { ...(row || { incidentId: id, revision: 0, siteFindings: null, rootCause: null, contributingFactors: null, mitigation: null, recommendations: null, updatedBy: null, updatedAt: null }), evidence, permissions: { canEdit: this.resolver(incident, userId), canManageEvidence: incident.status === "PENDING" && (incident.reportedById === userId || this.resolver(incident, userId)) } };
  }
  async saveInvestigation(id: string, userId: string, body: any) {
    const allowed = ["revision","siteFindings","rootCause","contributingFactors","mitigation","recommendations"];
    for (const key of Object.keys(body || {})) if (!allowed.includes(key)) invalid(key, "Unsupported field.");
    return prisma.$transaction(async (tx: any) => {
      const incident = await lockIncident(tx, id);
      if (!this.resolver(incident, userId)) throw new IncidentApiError(403, "FORBIDDEN", "Only a current resolver can edit the investigation.");
      const current = await tx.incidentInvestigation.findUnique({ where: { incidentId: id } });
      if (!Number.isInteger(body.revision) || body.revision !== (current?.revision || 0)) throw new IncidentApiError(409, "STALE_REVISION", "Reload the investigation before saving.");
      const data: any = { updatedById: userId, revision: { increment: 1 } };
      for (const key of allowed.slice(1)) if (body[key] !== undefined) data[key] = typeof body[key] === "string" ? body[key].trim() || null : invalid(key, "Must be text.");
      const saved = current ? await tx.incidentInvestigation.update({ where: { incidentId: id }, data }) : await tx.incidentInvestigation.create({ data: { incidentId: id, updatedById: userId, revision: 1, ...Object.fromEntries(allowed.slice(1).map(k => [k, body[k]?.trim() || null])) } });
      await audit(tx, id, "INVESTIGATION_UPDATED", { changedFields: Object.keys(body).filter(k => k !== "revision"), revision: saved.revision }, incident.workflow?.activeLevelId, userId);
    }, { isolationLevel: "Serializable" }).then(() => this.investigation(id, userId));
  }
  async ownerOptions(id: string, userId: string, query: any) {
    const incident = await this.incident(id, userId); const { page, limit } = pagination(query);
    const search = String(query.search || "").trim();
    const where: any = { isActive: true, role: { isActive: true }, OR: [{ projects: { some: { id: incident.projectId } } }, { projectMembers: { some: { projectId: incident.projectId } } }], ...(search ? { name: { contains: search, mode: "insensitive" } } : {}) };
    const [data,total] = await Promise.all([prisma.user.findMany({ where, select: USER, orderBy: { name: "asc" }, skip:(page-1)*limit,take:limit }), prisma.user.count({ where })]);
    return { data, pagination:{page,limit,total,totalPages:Math.ceil(total/limit)} };
  }
  async actions(id: string, userId: string, query: any) {
    const incident = await this.incident(id,userId); const {page,limit}=pagination(query);
    const [rows,total]=await Promise.all([(prisma as any).incidentAction.findMany({where:{incidentId:id},include:ACTION_INCLUDE,orderBy:{createdAt:"desc"},skip:(page-1)*limit,take:limit}),(prisma as any).incidentAction.count({where:{incidentId:id}})]);
    return {data:rows.map((a:any)=>this.actionView(a,incident,userId)),pagination:{page,limit,total,totalPages:Math.ceil(total/limit)}};
  }
  async action(id:string,actionId:string,userId:string){const incident=await this.incident(id,userId);const row=await (prisma as any).incidentAction.findFirst({where:{id:actionId,incidentId:id},include:ACTION_INCLUDE});if(!row)throw new IncidentApiError(404,"NOT_FOUND","Action not found.");return this.actionView(row,incident,userId);}
  async createAction(id:string,userId:string,body:any){
    const incident=await this.incident(id,userId); if(!this.resolver(incident,userId)) throw new IncidentApiError(403,"FORBIDDEN","Only a current resolver can create actions.");
    if(!body.title?.trim()) invalid("title","Title is required."); if(!body.description?.trim()) invalid("description","Description is required.");
    if(!["CORRECTIVE","PREVENTIVE"].includes(body.actionType)) invalid("actionType","Select a valid action type.");
    const due=this.date(body.dueDate,"dueDate"); const eligible=(await this.ownerOptions(id,userId,{page:1,limit:100})).data.some((u: any)=>u.id===body.ownerId); if(!eligible) throw new IncidentApiError(400,"INVALID_ACTION_OWNER","Select an eligible project user.");
    const row=await prisma.$transaction(async(tx:any)=>{const created=await tx.incidentAction.create({data:{incidentId:id,title:body.title.trim(),description:body.description.trim(),actionType:body.actionType,ownerId:body.ownerId,dueDate:due,requiredForResolution:body.requiredForResolution!==false},include:ACTION_INCLUDE});const project=await tx.project.findUnique({where:{id:incident.projectId},select:{name:true}});await notificationService.create(tx,{recipientId:body.ownerId,type:"INCIDENT_CORRECTIVE_ACTION_ASSIGNED",category:"CORRECTIVE_ACTION",priority:"HIGH",title:"Corrective action assigned",message:`You were assigned to ${created.title}.`,requiresAcknowledgement:true,actorId:userId,target:{resourceType:"INCIDENT_ACTION",projectId:incident.projectId,incidentId:id,actionId:created.id,preferredTab:"actions"},metadata:{incidentNumber:incident.incidentNumber,projectName:project?.name||null,dueDate:body.dueDate,actionTitle:created.title},eventKey:`INCIDENT_CORRECTIVE_ACTION_ASSIGNED:${body.ownerId}:${created.id}`});await audit(tx,id,"ACTION_CREATED",{actionId:created.id,title:created.title},incident.workflow?.activeLevelId,userId);return created;});return this.actionView(row,incident,userId);
  }
  async updateAction(id:string,actionId:string,userId:string,body:any){
    return prisma.$transaction(async (tx: any)=>{ const incident=await lockIncident(tx,id); const action=await tx.incidentAction.findFirst({where:{id:actionId,incidentId:id},include:ACTION_INCLUDE}); if(!action) throw new IncidentApiError(404,"NOT_FOUND","Action not found.");
      const manager=this.resolver(incident,userId); if(!manager&&action.ownerId!==userId) throw new IncidentApiError(403,"FORBIDDEN","You cannot update this action."); if(incident.status!=="PENDING") throw new IncidentApiError(409,"INCIDENT_NOT_EDITABLE","The incident is read-only.");
      if(body.revision!==action.revision) throw new IncidentApiError(409,"STALE_REVISION","Reload the action before saving."); const data:any={revision:{increment:1}};
      for(const k of ["title","description","completionRemarks"]) if(body[k]!==undefined)data[k]=body[k]?.trim()||null;
      if(body.status!==undefined){if(!["PENDING","IN_PROGRESS","COMPLETED","CANCELLED"].includes(body.status))invalid("status","Invalid action status.");data.status=body.status;if(body.status==="COMPLETED"){if(!body.completionRemarks?.trim())invalid("completionRemarks","Completion remarks are required.");data.completedAt=new Date();data.completedById=userId;}if(body.status==="CANCELLED"){if(!manager||!body.cancellationReason?.trim())invalid("cancellationReason","An authorized manager must provide a cancellation reason.");data.cancelledAt=new Date();data.cancelledById=userId;data.cancellationReason=body.cancellationReason.trim();}}
      if(body.requiredForResolution!==undefined){if(!manager||!body.requirementChangeReason?.trim())invalid("requirementChangeReason","A reason is required to change the resolution requirement.");data.requiredForResolution=!!body.requiredForResolution;data.requirementChangeReason=body.requirementChangeReason.trim();}
      if(body.ownerId!==undefined){if(!manager)throw new IncidentApiError(403,"FORBIDDEN","Only a current resolver can reassign actions.");data.ownerId=body.ownerId;}
      const saved=await tx.incidentAction.update({where:{id:actionId},data,include:ACTION_INCLUDE});
      const event=body.status==="COMPLETED"?"ACTION_COMPLETED":body.status==="CANCELLED"?"ACTION_CANCELLED":body.requiredForResolution!==undefined?"ACTION_REQUIREMENT_CHANGED":"ACTION_UPDATED";
      await audit(tx,id,event,{actionId,previousStatus:action.status,status:saved.status},incident.workflow?.activeLevelId,userId);
      if(body.ownerId&&body.ownerId!==action.ownerId)await notificationService.create(tx,{recipientId:body.ownerId,type:"INCIDENT_CORRECTIVE_ACTION_ASSIGNED",category:"CORRECTIVE_ACTION",priority:"HIGH",title:"Corrective action assigned",message:`You were assigned to ${saved.title}.`,requiresAcknowledgement:true,actorId:userId,target:{resourceType:"INCIDENT_ACTION",projectId:incident.projectId,incidentId:id,actionId:saved.id,preferredTab:"actions"},metadata:{incidentNumber:incident.incidentNumber,dueDate:saved.dueDate.toISOString().slice(0,10),actionTitle:saved.title},eventKey:`INCIDENT_CORRECTIVE_ACTION_ASSIGNED:${body.ownerId}:${saved.id}:${saved.revision}`});
      if(body.status==="COMPLETED"){const recipientIds=[incident.reportedById,...(incident.workflow?.eligibleResolvers||[]).map((x:any)=>x.id)].filter((value,index,array)=>value!==userId&&array.indexOf(value)===index);for(const recipientId of recipientIds)await notificationService.create(tx,{recipientId,type:"INCIDENT_CORRECTIVE_ACTION_COMPLETED",category:"CORRECTIVE_ACTION",priority:"NORMAL",title:"Corrective action completed",message:`${saved.title} was completed.`,actorId:userId,target:{resourceType:"INCIDENT_ACTION",projectId:incident.projectId,incidentId:id,actionId:saved.id,preferredTab:"actions"},metadata:{incidentNumber:incident.incidentNumber,actionTitle:saved.title},eventKey:`INCIDENT_CORRECTIVE_ACTION_COMPLETED:${recipientId}:${saved.id}`});}
      return this.actionView(saved,incident,userId);
    },{isolationLevel:"Serializable"});
  }
  async readiness(id:string,userId:string){const incident=await this.incident(id,userId);const open=await (prisma as any).incidentAction.findMany({where:{incidentId:id,requiredForResolution:true,status:{not:"COMPLETED"}},select:{id:true}});const can=this.resolver(incident,userId);return{activeLevelId:incident.workflow?.activeLevelId||null,isFinal:!!incident.workflow?.isFinal,canResolve:can&&!!incident.workflow?.isFinal&&!open.length,completionRule:incident.workflow?.completionRule||null,confirmedCount:incident.workflow?.confirmedResolverIds?.length||0,eligibleResolverCount:incident.workflow?.eligibleResolvers?.length||0,requiredOpenActionCount:open.length,blockers:open.length?[{code:"REQUIRED_ACTIONS_INCOMPLETE",message:"Complete the required corrective actions before resolution.",actionIds:open.map((a:any)=>a.id)}]:[],classificationOptions:[{value:"CORRECTIVE_ACTION_COMPLETED",label:"Corrective action completed"},{value:"NO_ACTION_REQUIRED",label:"No corrective action required"}]};}
  private actionView(a:any,incident:any,userId:string){const manager=this.resolver(incident,userId),editable=incident.status==="PENDING";return{...a,isOverdue:editable&&a.status!=="COMPLETED"&&a.status!=="CANCELLED"&&a.dueDate<new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Manila"})),permissions:{canEdit:editable&&manager,canUpdateProgress:editable&&(manager||a.ownerId===userId),canComplete:editable&&(manager||a.ownerId===userId),canCancel:editable&&manager}};}
  private date(value:any,field:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))invalid(field,"Use YYYY-MM-DD.");const d=new Date(`${value}T00:00:00+08:00`);if(Number.isNaN(d.getTime()))invalid(field,"Enter a valid date.");return d;}
}
export const incidentCaseManagementService=new IncidentCaseManagementService();
