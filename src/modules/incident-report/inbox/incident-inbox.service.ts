import prisma from "../../../config/prisma";
import { IncidentApiError, invalid, pagination } from "../workflow/incident-workflow.contract";

const USER = { id: true, name: true } as const;
const INCIDENT_INCLUDE = {
  project: { select: { id: true, name: true } },
  incidentType: { select: { id: true, name: true } },
  reportedBy: { select: USER },
  actions: { select: { status: true, requiredForResolution: true, dueDate: true } },
} as const;

export class IncidentInboxService {
  private async user(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user?.isActive || !user.role.isActive) throw new IncidentApiError(403, "FORBIDDEN", "An active user and role are required.");
    return user;
  }

  private visibility(user: any, userId: string) {
    if (user.role.name === "SUPERADMIN") return {};
    return { OR: [
      { reportedById: userId },
      { project: { OR: [{ ownerId: userId }, { projectMembers: { some: { userId } } }] } },
      { workflow: { path: ["eligibleResolvers"], array_contains: [{ id: userId }] } },
      { actions: { some: { ownerId: userId, status: { not: "CANCELLED" } } } },
    ] };
  }

  private filters(query: any) {
    const allowedSla = ["WITHIN_SLA", "LEVEL_OVERDUE", "OVERALL_SLA_BREACHED"];
    if (query.slaState && !allowedSla.includes(String(query.slaState))) invalid("slaState", `Use ${allowedSla.join(", ")}.`);
    if (query.status && !["PENDING", "RESOLVED", "CANCELLED"].includes(String(query.status))) invalid("status", "Select a valid incident status.");
    if (query.severity && !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(query.severity))) invalid("severity", "Select a valid severity.");
    const date = (value: any, field: string) => { if (!value) return undefined; const parsed = new Date(String(value)); if (Number.isNaN(parsed.getTime())) invalid(field, "Enter a valid date."); return parsed; };
    const dateFrom = date(query.dateFrom, "dateFrom"), dateTo = date(query.dateTo, "dateTo");
    const sla: any = query.slaState === "LEVEL_OVERDUE" ? { workflow: { path: ["isLevelOverdue"], equals: true } }
      : query.slaState === "OVERALL_SLA_BREACHED" ? { overallSlaBreachedAt: { not: null } }
      : query.slaState === "WITHIN_SLA" ? { overallSlaBreachedAt: null, NOT: { workflow: { path: ["isLevelOverdue"], equals: true } } } : {};
    const search = String(query.search || "").trim();
    return {
      ...(search ? { OR: [{ incidentNumber: { contains: search, mode: "insensitive" } }, { title: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] } : {}),
      ...(query.projectId ? { projectId: String(query.projectId) } : {}),
      ...(query.incidentTypeId ? { incidentTypeId: String(query.incidentTypeId) } : {}),
      ...(query.status ? { status: String(query.status) } : {}),
      ...(query.severity ? { severity: String(query.severity) } : {}),
      ...(dateFrom || dateTo ? { dateRaised: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
      ...(String(query.overdue) === "true" ? { workflow: { path: ["isLevelOverdue"], equals: true } } : String(query.overdue) === "false" ? { NOT: { workflow: { path: ["isLevelOverdue"], equals: true } } } : {}),
      ...sla,
    };
  }

  private todayManila() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const get = (type:string) => parts.find(x => x.type === type)!.value; return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00+08:00`); }
  private actionSummary(actions: any[]) { const today = this.todayManila(); return { total: actions.length, completed: actions.filter(x => x.status === "COMPLETED").length, requiredOpen: actions.filter(x => x.requiredForResolution && x.status !== "COMPLETED").length, overdue: actions.filter(x => !["COMPLETED", "CANCELLED"].includes(x.status) && x.dueDate < today).length }; }
  private incidentView(row: any, userId: string) { const state = row.workflow || {}; return {
    id: row.id, incidentNumber: row.incidentNumber, projectId: row.projectId, project: row.project, incidentType: row.incidentType,
    title: row.title, description: row.description, severity: row.severity, status: row.status, dateRaised: row.dateRaised, reportedBy: row.reportedBy,
    workflow: row.workflow ? { workflowName: row.workflowSnapshot?.workflowName || null, activeLevelId: state.activeLevelId, activeLevelOrder: state.activeLevelOrder, levelCount: row.workflowSnapshot?.levels?.length || 0, responsiblePartyLabel: state.responsiblePartyLabel, completionRule: state.completionRule, eligibleResolverCount: state.eligibleResolvers?.length || 0, confirmationCount: state.confirmedResolverIds?.length || 0, currentUserConfirmed: state.confirmedResolverIds?.includes(userId) || false, isFinal: state.isFinal, isLevelOverdue: !!state.isLevelOverdue, levelSlaDeadline: state.levelSlaDeadline, levelSlaBreachedAt: state.levelSlaBreachedAt } : null,
    overallSla: { deadline: row.overallSlaDeadline, isBreached: !!row.overallSlaBreachedAt, breachedAt: row.overallSlaBreachedAt },
    actionSummary: this.actionSummary(row.actions),
    permissions: { canView: true, canCompleteLevel: row.status === "PENDING" && row.reportedById !== userId && state.eligibleResolvers?.some((x:any) => x.id === userId) && !state.confirmedResolverIds?.includes(userId), completeLevelBlockedReason: state.confirmedResolverIds?.includes(userId) ? "ALREADY_CONFIRMED" : null, canExportReport: true },
  }; }

  private async incidents(userId: string, query: any, mode: "ALL" | "MINE" | "ACTION") {
    const user = await this.user(userId); const { page, limit } = pagination(query); const base: any = this.filters(query);
    const modeWhere = mode === "MINE" ? { reportedById: userId } : mode === "ACTION" ? { status: "PENDING", workflow: { path: ["eligibleResolvers"], array_contains: [{ id: userId }] } } : this.visibility(user, userId);
    const where = { AND: [base, modeWhere, ...(mode === "ALL" ? [] : [this.visibility(user, userId)])] };
    const allowedSort = mode === "ACTION" ? ["levelSlaDeadline", "dateRaised", "severity"] : ["dateRaised", "severity", "status", "incidentNumber"];
    const sortBy = String(query.sortBy || (mode === "ACTION" ? "levelSlaDeadline" : "dateRaised")); if (!allowedSort.includes(sortBy)) invalid("sortBy", `Use ${allowedSort.join(", ")}.`);
    const sortOrder = String(query.sortOrder || (mode === "ACTION" ? "asc" : "desc")); if (!["asc", "desc"].includes(sortOrder)) invalid("sortOrder", "Use asc or desc.");
    const orderBy: any = sortBy === "levelSlaDeadline" ? { levelSlaDeadline: sortOrder } : { [sortBy]: sortOrder };
    const [rows,total] = await prisma.$transaction([prisma.incidentReport.findMany({ where, include: INCIDENT_INCLUDE, orderBy, skip:(page-1)*limit, take:limit }), prisma.incidentReport.count({ where })]);
    return { data: rows.map(row => this.incidentView(row,userId)), pagination:{page,limit,total,totalPages:Math.ceil(total/limit)} };
  }
  myReports(userId:string,query:any){return this.incidents(userId,query,"MINE");}
  forMyAction(userId:string,query:any){if(query.overdue!==undefined&&!["true","false",true,false].includes(query.overdue))invalid("overdue","Use true or false.");return this.incidents(userId,query,"ACTION");}
  all(userId:string,query:any){return this.incidents(userId,query,"ALL");}

  async myCorrectiveActions(userId:string,query:any){await this.user(userId);const {page,limit}=pagination(query);if(query.actionType&&!['CORRECTIVE','PREVENTIVE'].includes(String(query.actionType)))invalid("actionType","Select a valid action type.");if(query.status&&!['PENDING','IN_PROGRESS','COMPLETED','CANCELLED'].includes(String(query.status)))invalid("status","Select a valid action status.");for(const key of ["overdue","requiredForResolution"])if(query[key]!==undefined&&!["true","false",true,false].includes(query[key]))invalid(key,"Use true or false.");const parseDue=(value:any,field:string)=>{if(!value)return undefined;if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))invalid(field,"Use YYYY-MM-DD.");return new Date(`${value}T00:00:00+08:00`);};const dueFrom=parseDue(query.dueDateFrom,"dueDateFrom"),dueTo=parseDue(query.dueDateTo,"dueDateTo");const search=String(query.search||"").trim();const today=this.todayManila();const conditions:any[]=[{ownerId:userId},query.actionType?{actionType:String(query.actionType)}:{},query.status?{status:String(query.status)}:{status:{not:"CANCELLED"}},query.projectId?{incident:{projectId:String(query.projectId)}}:{},query.requiredForResolution!==undefined?{requiredForResolution:String(query.requiredForResolution)==="true"}:{},dueFrom||dueTo?{dueDate:{...(dueFrom?{gte:dueFrom}:{}),...(dueTo?{lte:dueTo}:{})}}:{},search?{OR:[{title:{contains:search,mode:"insensitive"}},{description:{contains:search,mode:"insensitive"}},{incident:{incidentNumber:{contains:search,mode:"insensitive"}}}]}:{},String(query.overdue)==="true"?{status:{notIn:["COMPLETED","CANCELLED"]},dueDate:{lt:today}}:String(query.overdue)==="false"?{OR:[{status:{in:["COMPLETED","CANCELLED"]}},{dueDate:{gte:today}}]}:{}];const where:any={AND:conditions};const allowed=["dueDate","createdAt","status","title"];const sortBy=String(query.sortBy||"dueDate");if(!allowed.includes(sortBy))invalid("sortBy",`Use ${allowed.join(", ")}.`);const sortOrder=String(query.sortOrder||"asc");if(!["asc","desc"].includes(sortOrder))invalid("sortOrder","Use asc or desc.");const include:any={owner:{select:USER},evidence:{select:{id:true}},incident:{include:{project:{select:{id:true,name:true}}}}};const [rows,total]=await prisma.$transaction([prisma.incidentAction.findMany({where,include,orderBy:{[sortBy]:sortOrder},skip:(page-1)*limit,take:limit}),prisma.incidentAction.count({where})]);return{data:rows.map((a:any)=>({id:a.id,incidentId:a.incidentId,revision:a.revision,title:a.title,description:a.description,actionType:a.actionType,status:a.status,dueDate:a.dueDate,isOverdue:!["COMPLETED","CANCELLED"].includes(a.status)&&a.dueDate<today,requiredForResolution:a.requiredForResolution,completionRemarks:a.completionRemarks,completedAt:a.completedAt,evidenceCount:a.evidence.length,owner:a.owner,incident:{id:a.incident.id,incidentNumber:a.incident.incidentNumber,title:a.incident.title,severity:a.incident.severity,status:a.incident.status},project:a.incident.project,permissions:{canViewIncident:true,canEdit:a.incident.status==="PENDING",canUpdateProgress:a.incident.status==="PENDING",canComplete:a.incident.status==="PENDING",canCancel:false}})),pagination:{page,limit,total,totalPages:Math.ceil(total/limit)}};}

  async summary(userId:string,query:any){const user=await this.user(userId);if(query.severity&&!['LOW','MEDIUM','HIGH','CRITICAL'].includes(String(query.severity)))invalid("severity","Select a valid severity.");const visible:any=this.visibility(user,userId);const scope:any={...(query.projectId?{projectId:String(query.projectId)}:{}),...(query.severity?{severity:String(query.severity)}:{})};const today=this.todayManila();const [myReports,forMyAction,myCorrectiveActions,allIncidents,overdueWorkflowLevels,overdueCorrectiveActions,createPermission]=await prisma.$transaction([prisma.incidentReport.count({where:{AND:[visible,scope,{reportedById:userId}]}}),prisma.incidentReport.count({where:{AND:[visible,scope,{status:"PENDING",workflow:{path:["eligibleResolvers"],array_contains:[{id:userId}]}}]}}),prisma.incidentAction.count({where:{ownerId:userId,status:{not:"CANCELLED"},incident:scope}}),prisma.incidentReport.count({where:{AND:[visible,scope]}}),prisma.incidentReport.count({where:{AND:[visible,scope,{status:"PENDING",workflow:{path:["isLevelOverdue"],equals:true}}]}}),prisma.incidentAction.count({where:{ownerId:userId,status:{notIn:["COMPLETED","CANCELLED"]},dueDate:{lt:today},incident:scope}}),prisma.rolePermission.findFirst({where:{roleId:user.roleId,module:{name:{equals:"incident_reports",mode:"insensitive"},isActive:true},permission:{action:"CREATE"}},select:{id:true}})]);return{myReports,forMyAction,myCorrectiveActions,allIncidents,overdueWorkflowLevels,overdueCorrectiveActions,permissions:{canViewAllIncidents:true,canCreateIncident:!!createPermission}};}

  async filterOptions(userId:string,query:any,type:"projects"|"incidentTypes"){const user=await this.user(userId);const {page,limit}=pagination(query);const visible:any=this.visibility(user,userId);const search=String(query.search||"").trim();if(type==="projects"){const ids=(await prisma.incidentReport.findMany({where:visible,distinct:["projectId"],select:{projectId:true}})).map(x=>x.projectId);const where:any={id:{in:ids},...(search?{name:{contains:search,mode:"insensitive"}}:{})};const [data,total]=await prisma.$transaction([prisma.project.findMany({where,select:{id:true,name:true},orderBy:{name:"asc"},skip:(page-1)*limit,take:limit}),prisma.project.count({where})]);return{data,pagination:{page,limit,total,totalPages:Math.ceil(total/limit)}};}const ids=(await prisma.incidentReport.findMany({where:{...visible,incidentTypeId:{not:null}},distinct:["incidentTypeId"],select:{incidentTypeId:true}})).map(x=>x.incidentTypeId!).filter(Boolean);const where:any={id:{in:ids},...(search?{name:{contains:search,mode:"insensitive"}}:{})};const [data,total]=await prisma.$transaction([prisma.incidentType.findMany({where,select:{id:true,name:true,isActive:true},orderBy:{name:"asc"},skip:(page-1)*limit,take:limit}),prisma.incidentType.count({where})]);return{data,pagination:{page,limit,total,totalPages:Math.ceil(total/limit)}};}
}
export const incidentInboxService=new IncidentInboxService();
