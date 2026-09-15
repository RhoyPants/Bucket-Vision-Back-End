import prisma from "../../../config/prisma";
import { activeFilter, commonFields, conflict, invalid, missing, pagination, validateFields } from "../../incident-report/workflow/incident-workflow.contract";

const typeInclude = { incidentWorkflow: true, notificationMatrix: true, _count: { select: { incidents: true } } };
function typeResource(row: any) {
  const { _count, incidentWorkflow: workflow, notificationMatrix, ...data } = row;
  const incidentCount = _count.incidents;
  return { ...data, incidentWorkflow: workflow && { id: workflow.id, name: workflow.name, isActive: workflow.isActive, version: workflow.version, levelCount: workflow.levels.length }, notificationMatrix: notificationMatrix && { id: notificationMatrix.id, name: notificationMatrix.name, isActive: notificationMatrix.isActive, version: notificationMatrix.version, levelCount: notificationMatrix.levels.length }, incidentCount, canDelete: !incidentCount, deleteBlockedReason: incidentCount ? "Referenced by incidents" : null };
}
export class IncidentTypeService {
  async list(query: any, selectable = false) {
    const { page, limit } = pagination(query);
    const active = selectable ? true : activeFilter(query.active);
    if (query.search !== undefined && typeof query.search !== "string") invalid("search", "Must be text.");
    const where = { ...(active === undefined ? {} : { isActive: active }), ...(query.search ? { name: { contains: query.search.trim(), mode: "insensitive" as const } } : {}), ...(selectable ? { incidentWorkflow: { isActive: true }, notificationMatrix: { isActive: true }, resolutionSlaValue: { not: null }, resolutionSlaUnit: { not: null } } : {}) };
    return prisma.$transaction(async tx => {
      const model = tx.incidentType;
      const rows = await model.findMany({ where, include: typeInclude, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit });
      const total = await model.count({ where });
      return { data: rows.map(typeResource), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }, { isolationLevel: "Serializable", timeout: 20000 });
  }
  async get(id: string, tx: any = prisma) {
    const row = await (tx.incidentType).findUnique({ where: { id }, include: typeInclude });
    if (!row) missing();
    return typeResource(row);
  }
  async save(body: any, id?: string) {
    validateFields(body, ["name", "description", "isActive", "defaultCriticality", "incidentWorkflowId", "resolutionSlaValue", "resolutionSlaUnit", "notificationMatrixId"]);
    return prisma.$transaction(async tx => {
      const previous = id ? await this.get(id, tx) : null;
      const data = commonFields(body, !id);
      if (!id || body.defaultCriticality !== undefined) {
        if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(body.defaultCriticality)) invalid("defaultCriticality", "Select a valid criticality.");
        data.defaultCriticality = body.defaultCriticality;
      }
      const deactivationOnly = id && body.isActive === false && Object.keys(body).length === 1;
      const workflowId = body.incidentWorkflowId ?? previous?.incidentWorkflowId;
      const workflow = await tx.incidentWorkflow.findUnique({ where: { id: workflowId || "" } });
      if (!workflow || (!workflow.isActive && !deactivationOnly)) invalid("incidentWorkflowId", "Select an active incident workflow.");
      if (!deactivationOnly && !(workflow!.levels as any[]).every(level => ["ANY_ONE", "ALL"].includes(level.completionRule) && typeof level.slaValue === "number" && level.slaValue > 0 && ["HOURS", "DAYS"].includes(level.slaUnit))) invalid("incidentWorkflowId", "Update this workflow so every level, including the final level, has an SLA and completion rule.");
      data.incidentWorkflowId = workflowId;
      const matrixId = body.notificationMatrixId ?? previous?.notificationMatrixId;
      const matrix = await tx.escalationNotificationMatrix.findUnique({ where: { id: matrixId || "" } });
      if (!matrix || (!matrix.isActive && !deactivationOnly)) invalid("notificationMatrixId", "Select an active escalation notification matrix.");
      data.notificationMatrixId = matrixId;
      const slaValue = body.resolutionSlaValue ?? previous?.resolutionSlaValue;
      const slaUnit = body.resolutionSlaUnit ?? previous?.resolutionSlaUnit;
      if (typeof slaValue !== "number" || !Number.isFinite(slaValue) || slaValue <= 0) invalid("resolutionSlaValue", "Overall resolution SLA must be greater than zero.");
      if (!["HOURS", "DAYS"].includes(slaUnit)) invalid("resolutionSlaUnit", "Use HOURS or DAYS.");
      if (slaUnit === "DAYS" && !Number.isInteger(slaValue)) invalid("resolutionSlaValue", "Working days must be a whole number.");
      data.resolutionSlaValue = slaValue; data.resolutionSlaUnit = slaUnit;
      const row = id ? await tx.incidentType.update({ where: { id }, data, include: typeInclude }) : await tx.incidentType.create({ data, include: typeInclude });
      return typeResource(row);
    }, { isolationLevel: "Serializable", timeout: 20000 });
  }
  async delete(id: string) {
    return prisma.$transaction(async tx => {
      const resource = await this.get(id, tx);
      if (!resource.canDelete) conflict("IN_USE", resource.deleteBlockedReason);
      await (tx.incidentType).delete({ where: { id } });
      return { id, deleted: true };
    }, { isolationLevel: "Serializable", timeout: 20000 });
  }
}
export const incidentTypeService = new IncidentTypeService();
