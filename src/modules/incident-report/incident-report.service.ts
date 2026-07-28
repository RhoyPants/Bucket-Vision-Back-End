import { randomUUID } from "crypto";
import prisma from "../../config/prisma";
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
      where.project = {
        OR: [
          { ownerId: userId },
          { projectMembers: { some: { userId } } },
        ],
      };
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
      data,
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
    await this.ensureProjectAccess(incident.projectId, userId);
    return incident;
  }

  async create(userId: string, dto: CreateIncidentReportDTO) {
    this.validateCreate(dto);
    await this.ensureProjectAccess(dto.projectId, userId);
    const source = await this.normalizeSource(dto.projectId, dto);

    return (prisma as any).incidentReport.create({
      data: {
        incidentNumber: this.generateIncidentNumber(),
        projectId: dto.projectId,
        reportedById: userId,
        title: dto.title.trim(),
        description: dto.description.trim(),
        severity: this.optionalSeverity(dto.severity) || "MEDIUM",
        dateRaised: this.optionalDate(dto.dateRaised, "dateRaised") || new Date(),
        remarks: dto.remarks?.trim() || null,
        ...source,
      },
      include: INCIDENT_INCLUDE,
    });
  }

  async update(id: string, userId: string, dto: UpdateIncidentReportDTO) {
    const incident = await this.findIncident(id);
    await this.assertCanManage(incident, userId);
    this.assertPending(incident);
    this.validateUpdate(dto);

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

    return (prisma as any).incidentReport.update({
      where: { id },
      data: {
        title: dto.title === undefined ? undefined : dto.title.trim(),
        description:
          dto.description === undefined ? undefined : dto.description.trim(),
        severity:
          dto.severity === undefined ? undefined : this.optionalSeverity(dto.severity),
        dateRaised:
          dto.dateRaised === undefined
            ? undefined
            : this.optionalDate(dto.dateRaised, "dateRaised"),
        remarks:
          dto.remarks === undefined ? undefined : dto.remarks?.trim() || null,
        ...source,
      },
      include: INCIDENT_INCLUDE,
    });
  }

  async resolve(
    id: string,
    userId: string,
    dto: ResolveIncidentReportDTO
  ) {
    const incident = await this.findIncident(id);
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

    return (prisma as any).incidentReport.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: userId,
        cancellationReason: dto.reason.trim(),
      },
      include: INCIDENT_INCLUDE,
    });
  }

  async delete(id: string, userId: string) {
    const incident = await this.findIncident(id);
    await this.assertCanManage(incident, userId);
    this.assertPending(incident);
    await (prisma as any).incidentReport.delete({ where: { id } });
    return { id };
  }

  async addAttachment(
    incidentId: string,
    userId: string,
    file: { fileUrl: string; fileName: string; mimeType?: string; size?: number }
  ) {
    const incident = await this.findIncident(incidentId);
    await this.assertCanManage(incident, userId);
    this.assertPending(incident);

    return (prisma as any).incidentAttachment.create({
      data: {
        incidentId,
        uploadedBy: userId,
        ...file,
      },
      include: { user: { select: USER_SELECT } },
    });
  }

  async listAttachments(incidentId: string, userId: string) {
    const incident = await this.findIncident(incidentId);
    await this.ensureProjectAccess(incident.projectId, userId);
    return (prisma as any).incidentAttachment.findMany({
      where: { incidentId },
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getAttachment(attachmentId: string, userId: string) {
    const attachment = await (prisma as any).incidentAttachment.findUnique({
      where: { id: attachmentId },
      include: { incident: { select: { projectId: true } } },
    });
    if (!attachment) throw new Error("Attachment not found");
    await this.ensureProjectAccess(attachment.incident.projectId, userId);
    return attachment;
  }

  async deleteAttachment(attachmentId: string, userId: string) {
    const attachment = await (prisma as any).incidentAttachment.findUnique({
      where: { id: attachmentId },
      include: { incident: true },
    });
    if (!attachment) throw new Error("Attachment not found");
    if (attachment.uploadedBy !== userId) {
      await this.assertCanManage(attachment.incident, userId);
    }
    this.assertPending(attachment.incident);
    await (prisma as any).incidentAttachment.delete({ where: { id: attachmentId } });
    return { id: attachmentId };
  }

  private async findIncident(id: string) {
    const incident = await (prisma as any).incidentReport.findUnique({
      where: { id },
      include: INCIDENT_INCLUDE,
    });
    if (!incident) throw new Error("Incident report not found");
    return incident;
  }

  private async ensureProjectAccess(projectId: string, userId: string) {
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
    if (membership?.role !== "SUB_OWNER") {
      throw new Error("Only the reporter, project owner, or sub-owner can modify this incident");
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
  }

  private validateUpdate(dto: UpdateIncidentReportDTO) {
    if (dto.title !== undefined && dto.title.trim().length < 3) {
      throw new Error("Title must be at least 3 characters");
    }
    if (dto.description !== undefined && dto.description.trim().length < 5) {
      throw new Error("Description must be at least 5 characters");
    }
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
