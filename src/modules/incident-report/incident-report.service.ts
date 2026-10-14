import { randomUUID } from "crypto";
import prisma from "../../config/prisma";
import { deleteManagedAsset } from "../../services/s3-assets.service";
import { incidentWorkflowService, audit, lockIncident } from "./workflow/incident-workflow.service";
import { conflict, invalid, IncidentApiError } from "./workflow/incident-workflow.contract";
import {
  CancelIncidentReportDTO,
  CreateIncidentReportDTO,
  IncidentSeverity,
  IncidentStatus,
  ResolveIncidentReportDTO,
  UpdateIncidentReportDTO,
} from "./incident-report.dto";

const USER_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  email: true,
  position: true,
} as const;

const INCIDENT_INCLUDE = {
  project: { select: { id: true, name: true, status: true } },
  reportedBy: { select: USER_SELECT },
  resolvedBy: { select: USER_SELECT },
  cancelledBy: { select: USER_SELECT },
  scope: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
  subtask: { select: { id: true, title: true } },
  attachments: {
    include: { user: { select: USER_SELECT } },
    orderBy: { createdAt: "desc" as const },
  },
  investigation: true,
  actions: { select: { status: true, requiredForResolution: true, dueDate: true } },
} as const;

export class IncidentReportService {
  async list(userId: string, query: any) {
    const user = await this.getUser(userId);
    const page = this.positiveInt(query.page, 1);
    const limit = Math.min(this.positiveInt(query.limit, 20), 100);
    const status = this.optionalStatus(query.status);
    const severity = this.optionalSeverity(query.severity);
    const dateFrom = this.optionalDate(query.dateFrom, "dateFrom");
    const dateTo = this.optionalDate(query.dateTo, "dateTo");

    const where: any = {
      ...(query.projectId ? { projectId: String(query.projectId) } : {}),
      ...(query.reportedById ? { reportedById: String(query.reportedById) } : {}),
      ...(status ? { status } : {}),
      ...(severity ? { severity } : {}),
      ...(dateFrom || dateTo
        ? {
            dateRaised: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    if (user.role?.name !== "SUPERADMIN") {
      where.OR = [
        { project: { OR: [{ ownerId: userId }, { projectMembers: { some: { userId } } }] } },
        { workflow: { path: ["eligibleResolvers"], array_contains: [{ id: userId }] } },
      ];
    }

    const [data, total] = await Promise.all([
      (prisma as any).incidentReport.findMany({
        where,
        include: INCIDENT_INCLUDE,
        orderBy: { dateRaised: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      (prisma as any).incidentReport.count({ where }),
    ]);

    return {
      data: await Promise.all(data.map((row: any) => incidentWorkflowService.decorate(row, userId))),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getById(id: string, userId: string) {
    const incident = await this.findIncident(id);
    await this.ensureIncidentAccess(incident, userId);
    return this.decorateDetail(await incidentWorkflowService.decorate(incident, userId), userId);
  }

  async create(userId: string, dto: CreateIncidentReportDTO) {
    this.validateCreate(dto);
    await this.ensureProjectAccess(dto.projectId, userId);
    const source = await this.normalizeSource(dto.projectId, dto);

    if (typeof dto.incidentTypeId !== "string" || !dto.incidentTypeId) invalid("incidentTypeId", "Select an active incident type.");
    const id = await prisma.$transaction(async tx => {
      const type = await tx.incidentType.findFirst({ where: { id: dto.incidentTypeId, isActive: true, incidentWorkflow: { isActive: true }, notificationMatrix: { isActive: true }, resolutionSlaValue: { not: null }, resolutionSlaUnit: { not: null } }, include: { incidentWorkflow: true, notificationMatrix: true } });
      if (!type) return invalid("incidentTypeId", "Select an active incident type with an active workflow and notification matrix.");
      const incident = await tx.incidentReport.create({
      data: {
        incidentTypeId: type.id,
        incidentWorkflowId: type.incidentWorkflowId,
        notificationMatrixId: type.notificationMatrixId,
        incidentNumber: this.generateIncidentNumber(),
        projectId: dto.projectId,
        reportedById: userId,
        title: dto.title.trim(),
        description: dto.description.trim(),
        occurredAt: this.optionalDate(dto.occurredAt, "occurredAt"),
        location: dto.location.trim(),
        immediateActionTaken: dto.immediateActionTaken?.trim() || null,
        reportRecipient: dto.reportRecipient?.trim() || null,
        severity: type.defaultCriticality,
        dateRaised: this.optionalDate(dto.dateRaised, "dateRaised") || new Date(),
        remarks: dto.remarks?.trim() || null,
        ...source,
      },
      include: INCIDENT_INCLUDE,
      });
      await incidentWorkflowService.initialize(tx, incident, type);
      return incident.id;
    }, { isolationLevel: "Serializable", timeout: 20000 });
    return this.getById(id, userId);
  }

  async update(id: string, userId: string, dto: UpdateIncidentReportDTO) {
      const incident = await this.findIncident(id);
    await this.assertCanManage(incident, userId);
    this.assertPending(incident);
    this.validateUpdate(dto);
    if (!Number.isInteger(dto.revision) || dto.revision !== incident.revision) throw new IncidentApiError(409, "STALE_REVISION", "Reload the incident before saving.");

    const sourceChanged = ["scopeId", "taskId", "subtaskId"].some(
      (key) => Object.prototype.hasOwnProperty.call(dto, key)
    );
    const source = sourceChanged
      ? await this.normalizeSource(incident.projectId, {
          scopeId: dto.scopeId === undefined ? incident.scopeId : dto.scopeId,
          taskId: dto.taskId === undefined ? incident.taskId : dto.taskId,
          subtaskId: dto.subtaskId === undefined ? incident.subtaskId : dto.subtaskId,
        })
      : {};

    const data = {
        title: dto.title === undefined ? undefined : dto.title.trim(),
        description:
          dto.description === undefined ? undefined : dto.description.trim(),
        occurredAt: dto.occurredAt === undefined ? undefined : this.optionalDate(dto.occurredAt, "occurredAt"),
        location: dto.location === undefined ? undefined : dto.location.trim(),
        immediateActionTaken: dto.immediateActionTaken === undefined ? undefined : dto.immediateActionTaken?.trim() || null,
        reportRecipient: dto.reportRecipient === undefined ? undefined : dto.reportRecipient?.trim() || null,
        revision: { increment: 1 },
        severity:
          dto.severity === undefined ? undefined : this.optionalSeverity(dto.severity),
        dateRaised:
          dto.dateRaised === undefined
            ? undefined
            : this.optionalDate(dto.dateRaised, "dateRaised"),
        remarks:
          dto.remarks === undefined ? undefined : dto.remarks?.trim() || null,
        ...source,
      };
    await prisma.$transaction(async (tx: any) => {
      const result = await tx.incidentReport.updateMany({ where: { id, revision: dto.revision, status: "PENDING" }, data });
      if (result.count !== 1) throw new IncidentApiError(409, "STALE_REVISION", "Reload the incident before saving.");
      await audit(tx, id, "INCIDENT_OVERVIEW_UPDATED", { changedFields: Object.keys(dto).filter(key => key !== "revision"), revision: dto.revision! + 1 }, incident.workflow?.activeLevelId, userId);
    }, { isolationLevel: "Serializable", timeout: 20000 });
    return this.getById(id, userId);
  }

  async resolve(
    id: string,
    userId: string,
    dto: ResolveIncidentReportDTO
  ) {
    const incident = await this.findIncident(id);
    if (incident.workflowSnapshot) conflict("USE_WORKFLOW_COMPLETION_ENDPOINT", "Complete the current workflow level through /workflow/complete-level.");
    await this.assertCanManage(incident, userId);
    this.assertPending(incident);

    return (prisma as any).incidentReport.update({
      where: { id },
      data: {
        status: "RESOLVED",
        dateAddressed:
          this.optionalDate(dto.dateAddressed, "dateAddressed") || new Date(),
        resolvedById: userId,
        remarks:
          dto.remarks === undefined ? incident.remarks : dto.remarks?.trim() || null,
      },
      include: INCIDENT_INCLUDE,
    });
  }

  async cancel(id: string, userId: string, dto: CancelIncidentReportDTO) {
    const incident = await this.findIncident(id);
    await this.assertCanManage(incident, userId);
    this.assertPending(incident);

    if (!dto.reason || dto.reason.trim().length < 3) {
      throw new Error("Cancellation reason must be at least 3 characters");
    }

    return prisma.$transaction(async tx => {
      const locked = await lockIncident(tx, id);
      this.assertPending(locked);
      if (locked.workflowSnapshot) await audit(tx, id, "INCIDENT_CANCELLED", { reason: dto.reason.trim() }, locked.workflow?.activeLevelId, userId);
      return tx.incidentReport.update({
      where: { id },
      data: {
        levelSlaDeadline: null,
        overallSlaDeadline: null,
        nextNotificationAt: null,
        ...(locked.workflow ? { workflow: { ...locked.workflow, levelSlaDeadline: null } } : {}),
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: userId,
        cancellationReason: dto.reason.trim(),
      },
      include: INCIDENT_INCLUDE,
      });
    }, { isolationLevel: "Serializable", timeout: 20000 });
  }

  async delete(id: string, userId: string) {
    const incident = await this.findIncident(id);
    await this.assertCanManage(incident, userId);
    this.assertPending(incident);
    if (incident.workflowSnapshot) conflict("HISTORY_PROTECTED", "Cancel this incident to preserve its workflow audit history.");
    for (const attachment of incident.attachments || []) {
      await deleteManagedAsset(attachment.fileUrl);
      await (prisma as any).incidentAttachment.delete({ where: { id: attachment.id } });
    }
    await (prisma as any).incidentReport.delete({ where: { id } });
    return { id };
  }

  async addAttachment(
    incidentId: string,
    userId: string,
    file: { fileUrl: string; fileName: string; mimeType?: string; size?: number; section?: string; actionId?: string; caption?: string; displayOrder?: number }
  ) {
    const incident = await this.findIncident(incidentId);
    this.assertPending(incident);

    const section = String((file as any).section || "INITIAL_REPORT");
    const validSections = ["INITIAL_REPORT","SITE_FINDINGS","IMMEDIATE_ACTION","ROOT_CAUSE","CONTRIBUTING_FACTORS","MITIGATION","RECOMMENDATIONS","ACTION","RESOLUTION"];
    if (!validSections.includes(section)) invalid("section", "Select a valid evidence section.");
    const actionId = (file as any).actionId || null;
    if ((section === "ACTION") !== !!actionId) invalid("actionId", "actionId is required only for ACTION evidence.");
    await this.assertCanManageEvidence(incident, userId, section, actionId);
    const count = await (prisma as any).incidentAttachment.count({ where: { incidentId } });
    if (count >= 10) throw new IncidentApiError(400, "ATTACHMENT_LIMIT_EXCEEDED", "A maximum of 10 attachments is allowed.");
    const created = await (prisma as any).incidentAttachment.create({
      data: {
        incidentId,
        uploadedBy: userId,
        ...file,
        section,
        actionId,
        caption: (file as any).caption?.trim() || null,
        displayOrder: Number((file as any).displayOrder) || count + 1,
      },
      include: { user: { select: USER_SELECT } },
    });
    await audit(prisma, incidentId, "EVIDENCE_UPLOADED", { attachmentId: created.id, section, actionId }, incident.workflow?.activeLevelId, userId);
    return created;
  }

  async updateAttachment(attachmentId:string,userId:string,body:any){
    const attachment=await (prisma as any).incidentAttachment.findUnique({where:{id:attachmentId},include:{incident:true}});if(!attachment)throw new IncidentApiError(404,"NOT_FOUND","Attachment not found");this.assertPending(attachment.incident);
    const targetSection=String(body.section||attachment.section);await this.assertCanManageEvidence(attachment.incident,userId,targetSection,attachment.actionId);
    const validSections=["INITIAL_REPORT","SITE_FINDINGS","IMMEDIATE_ACTION","ROOT_CAUSE","CONTRIBUTING_FACTORS","MITIGATION","RECOMMENDATIONS","ACTION","RESOLUTION"];if(!validSections.includes(targetSection))invalid("section","Select a valid evidence section.");if(targetSection==="ACTION"&&!attachment.actionId)invalid("section","Evidence without an action cannot be moved to ACTION.");if(targetSection!=="ACTION"&&attachment.actionId)invalid("section","Action evidence must remain in the ACTION section.");
    const data:any={};if(body.caption!==undefined)data.caption=body.caption?.trim()||null;if(body.displayOrder!==undefined){if(!Number.isInteger(body.displayOrder)||body.displayOrder<1)invalid("displayOrder","Must be a positive integer.");data.displayOrder=body.displayOrder;}if(body.section!==undefined)data.section=targetSection;
    const saved=await (prisma as any).incidentAttachment.update({where:{id:attachmentId},data,include:{user:{select:USER_SELECT}}});await audit(prisma,attachment.incidentId,"EVIDENCE_UPDATED",{attachmentId,changedFields:Object.keys(data)},attachment.incident.workflow?.activeLevelId,userId);return saved;
  }

  async listAttachments(incidentId: string, userId: string) {
    const incident = await this.findIncident(incidentId);
    await this.ensureIncidentAccess(incident, userId);
    return (prisma as any).incidentAttachment.findMany({
      where: { incidentId },
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getAttachment(attachmentId: string, userId: string) {
    const attachment = await (prisma as any).incidentAttachment.findUnique({
      where: { id: attachmentId },
      include: { incident: true },
    });
    if (!attachment) throw new Error("Attachment not found");
    await this.ensureIncidentAccess(attachment.incident, userId);
    return attachment;
  }

  async deleteAttachment(attachmentId: string, userId: string) {
    const attachment = await this.authorizeAttachmentDeletion(attachmentId, userId);
    await (prisma as any).incidentAttachment.delete({ where: { id: attachmentId } });
    await audit(prisma, attachment.incidentId, "EVIDENCE_DELETED", { attachmentId, section: attachment.section }, attachment.incident.workflow?.activeLevelId, userId);
    return { id: attachmentId };
  }

  async authorizeAttachmentDeletion(attachmentId: string, userId: string) {
    const attachment = await (prisma as any).incidentAttachment.findUnique({
      where: { id: attachmentId },
      include: { incident: true },
    });
    if (!attachment) throw new Error("Attachment not found");
    if (attachment.uploadedBy !== userId) await this.assertCanManageEvidence(attachment.incident, userId, attachment.section, attachment.actionId);
    this.assertPending(attachment.incident);
    return attachment;
  }

  private async findIncident(id: string) {
    const incident = await (prisma as any).incidentReport.findUnique({
      where: { id },
      include: INCIDENT_INCLUDE,
    });
    if (!incident) throw new Error("Incident report not found");
    return incident;
  }

  async ensureIncidentAccess(incident: any, userId: string) {
    const user = await this.getUser(userId);
    if (user.isActive && user.role.isActive && incident.workflow?.eligibleResolvers?.some((u: any) => u.id === userId)) return;
    if (await prisma.incidentAction.findFirst({ where: { incidentId: incident.id, ownerId: userId, status: { not: "CANCELLED" } }, select: { id: true } })) return;
    await this.ensureProjectAccess(incident.projectId, userId);
  }

  async assertCanUploadAttachment(incidentId:string,userId:string,sectionValue:any,actionIdValue:any){const incident=await this.findIncident(incidentId);this.assertPending(incident);const section=String(sectionValue||"INITIAL_REPORT");const actionId=actionIdValue?String(actionIdValue):null;const valid=["INITIAL_REPORT","SITE_FINDINGS","IMMEDIATE_ACTION","ROOT_CAUSE","CONTRIBUTING_FACTORS","MITIGATION","RECOMMENDATIONS","ACTION","RESOLUTION"];if(!valid.includes(section))invalid("section","Select a valid evidence section.");if((section==="ACTION")!==!!actionId)invalid("actionId","actionId is required only for ACTION evidence.");await this.assertCanManageEvidence(incident,userId,section,actionId);return incident;}

  private async assertCanManageEvidence(incident:any,userId:string,section:string,actionId:string|null){const user=await this.getUser(userId);const currentResolver=incident.status==="PENDING"&&incident.reportedById!==userId&&incident.workflow?.eligibleResolvers?.some((entry:any)=>entry.id===userId);const project=await prisma.project.findUnique({where:{id:incident.projectId},select:{ownerId:true}});const membership=await prisma.projectMember.findUnique({where:{projectId_userId:{projectId:incident.projectId,userId}},select:{role:true}});const manager=user.role.name==="SUPERADMIN"||incident.reportedById===userId||project?.ownerId===userId||["CO_OWNER","SUB_OWNER"].includes(membership?.role||"");if(section==="ACTION"){const action=actionId?await prisma.incidentAction.findFirst({where:{id:actionId,incidentId:incident.id},select:{ownerId:true}}):null;if(!action)invalid("actionId","Action must belong to this incident.");if(manager||currentResolver||action!.ownerId===userId)return;}else if(manager||currentResolver)return;throw new IncidentApiError(403,"FORBIDDEN","You do not have permission to manage evidence in this section.");}

  async ensureProjectAccess(projectId: string, userId: string) {
    const user = await this.getUser(userId);
    const project = await prisma.project.findFirst({
      where:
        user.role?.name === "SUPERADMIN"
          ? { id: projectId }
          : {
              id: projectId,
              OR: [
                { ownerId: userId },
                { projectMembers: { some: { userId } } },
              ],
            },
      select: { id: true, ownerId: true },
    });
    if (!project) throw new Error("Project not found or access denied");
    return { project, user };
  }

  private async assertCanManage(incident: any, userId: string) {
    const { project, user } = await this.ensureProjectAccess(
      incident.projectId,
      userId
    );
    if (
      user.role?.name === "SUPERADMIN" ||
      incident.reportedById === userId ||
      project.ownerId === userId
    ) {
      return;
    }
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: incident.projectId, userId } },
      select: { role: true },
    });
    if (!membership || !["CO_OWNER", "SUB_OWNER"].includes(membership.role)) {
      throw new Error("Only the reporter, project owner, co-owner, or sub-owner can modify this incident");
    }
  }

  private async normalizeSource(projectId: string, dto: any) {
    const requestedScopeId = dto.scopeId || null;
    const requestedTaskId = dto.taskId || null;
    const requestedSubtaskId = dto.subtaskId || null;

    if (requestedSubtaskId) {
      const subtask = await prisma.subtask.findFirst({
        where: {
          id: requestedSubtaskId,
          task: { scope: { projectId } },
        },
        select: { id: true, taskId: true, task: { select: { scopeId: true } } },
      });
      if (!subtask) throw new Error("Subtask does not belong to the project");
      if (requestedTaskId && requestedTaskId !== subtask.taskId) {
        throw new Error("Subtask does not belong to the selected task");
      }
      if (requestedScopeId && requestedScopeId !== subtask.task.scopeId) {
        throw new Error("Subtask does not belong to the selected scope");
      }
      return {
        scopeId: subtask.task.scopeId,
        taskId: subtask.taskId,
        subtaskId: subtask.id,
      };
    }

    if (requestedTaskId) {
      const task = await prisma.task.findFirst({
        where: { id: requestedTaskId, scope: { projectId } },
        select: { id: true, scopeId: true },
      });
      if (!task) throw new Error("Task does not belong to the project");
      if (requestedScopeId && requestedScopeId !== task.scopeId) {
        throw new Error("Task does not belong to the selected scope");
      }
      return { scopeId: task.scopeId, taskId: task.id, subtaskId: null };
    }

    if (requestedScopeId) {
      const scope = await prisma.scope.findFirst({
        where: { id: requestedScopeId, projectId },
        select: { id: true },
      });
      if (!scope) throw new Error("Scope does not belong to the project");
      return { scopeId: scope.id, taskId: null, subtaskId: null };
    }

    return { scopeId: null, taskId: null, subtaskId: null };
  }

  private async getUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new Error("User not found");
    if (!user.isActive || !user.role.isActive) throw new IncidentApiError(403, "FORBIDDEN", "An active user and role are required.");
    return user;
  }

  private validateCreate(dto: CreateIncidentReportDTO) {
    if (!dto.projectId) throw new Error("projectId is required");
    if (!dto.title || dto.title.trim().length < 3) {
      throw new Error("Title must be at least 3 characters");
    }
    if (!dto.description || dto.description.trim().length < 5) {
      throw new Error("Description must be at least 5 characters");
    }
    if (!this.optionalDate(dto.occurredAt, "occurredAt")) invalid("occurredAt", "Enter a valid incident date and time.");
    if (!dto.location || !dto.location.trim()) invalid("location", "Location is required.");
  }

  private validateUpdate(dto: UpdateIncidentReportDTO) {
    if (dto.title !== undefined && dto.title.trim().length < 3) {
      throw new Error("Title must be at least 3 characters");
    }
    if (dto.description !== undefined && dto.description.trim().length < 5) {
      throw new Error("Description must be at least 5 characters");
    }
    if (dto.location !== undefined && !dto.location.trim()) invalid("location", "Location is required.");
  }

  private async decorateDetail(incident: any, userId: string) {
    const actions = incident.actions || [];
    const now = new Date();
    const actionSummary = { total: actions.length, completed: actions.filter((a:any)=>a.status === "COMPLETED").length, requiredOpen: actions.filter((a:any)=>a.requiredForResolution && a.status !== "COMPLETED").length, overdue: actions.filter((a:any)=>!["COMPLETED","CANCELLED"].includes(a.status) && a.dueDate < now).length };
    const current = incident.workflow?.eligibleResolvers?.some((u:any)=>u.id===userId) && incident.reportedById !== userId && incident.status === "PENDING";
    const canManageEvidence = incident.status === "PENDING" && (incident.reportedById === userId || current);
    return { ...incident, investigationSummary: { hasContent: !!incident.investigation && ["siteFindings","rootCause","contributingFactors","mitigation","recommendations"].some(k=>!!incident.investigation[k]), updatedAt: incident.investigation?.updatedAt || null }, actionSummary, permissions: { ...incident.permissions, canEditOverview: incident.status === "PENDING" && incident.reportedById === userId, canEditInvestigation: current, canCreateAction: current, canManageEvidence, canExportReport: true } };
  }

  private assertPending(incident: any) {
    if (incident.status !== "PENDING") {
      throw new Error("Only pending incident reports can be modified");
    }
  }

  private optionalStatus(value: any): IncidentStatus | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const normalized = String(value).toUpperCase() as IncidentStatus;
    if (!["PENDING", "RESOLVED", "CANCELLED"].includes(normalized)) {
      throw new Error("Invalid incident status");
    }
    return normalized;
  }

  private optionalSeverity(value: any): IncidentSeverity | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const normalized = String(value).toUpperCase() as IncidentSeverity;
    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(normalized)) {
      throw new Error("Invalid incident severity");
    }
    return normalized;
  }

  private optionalDate(value: any, field: string) {
    if (value === undefined || value === null || value === "") return undefined;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date`);
    return date;
  }

  private positiveInt(value: any, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private generateIncidentNumber() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    return `INC-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }
}

export const incidentReportService = new IncidentReportService();
