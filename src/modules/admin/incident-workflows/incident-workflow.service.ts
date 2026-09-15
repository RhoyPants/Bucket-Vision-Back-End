import prisma from "../../../config/prisma";
import { activeFilter, commonFields, conflict, invalid, missing, pagination, validateFields, validateLevels } from "../../incident-report/workflow/incident-workflow.contract";

const workflowInclude = { _count: { select: { incidentTypes: true, incidents: true } } };
export function workflowResource(row: any) {
  const { _count, ...data } = row;
  const usage = { incidentTypeCount: _count?.incidentTypes || 0, incidentCount: _count?.incidents || 0 };
  const canDelete = !usage.incidentTypeCount && !usage.incidentCount;
  return { ...data, levelCount: row.levels.length, usage, canDelete, deleteBlockedReason: canDelete ? null : "Referenced by incident types or incidents" };
}
export class IncidentWorkflowService {
  async list(query: any) {
    const { page, limit } = pagination(query);
    const active = activeFilter(query.active);
    if (query.search !== undefined && typeof query.search !== "string") invalid("search", "Must be text.");
    const where = { ...(active === undefined ? {} : { isActive: active }), ...(query.search ? { name: { contains: query.search.trim(), mode: "insensitive" as const } } : {}) };
    return prisma.$transaction(async tx => {
      const model = tx.incidentWorkflow;
      const rows = await model.findMany({ where, include: workflowInclude, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit });
      const total = await model.count({ where });
      return { data: rows.map(workflowResource), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }, { isolationLevel: "Serializable", timeout: 20000 });
  }
  async get(id: string, tx: any = prisma) {
    const row = await (tx.incidentWorkflow).findUnique({ where: { id }, include: workflowInclude });
    if (!row) missing();
    return workflowResource(row);
  }
  async save(body: any, id?: string) {
    validateFields(body, ["name", "description", "isActive", "allowPeerResolution", "levels", "version"]);
    return prisma.$transaction(async tx => {
      const previous = id ? await this.get(id, tx) : null;
      if (body.version !== undefined && (!Number.isInteger(body.version) || body.version !== previous?.version)) conflict("STALE_VERSION", "The workflow has changed. Reload before saving.");
      const data = commonFields(body, !id);
      if (body.allowPeerResolution !== undefined) {
        if (typeof body.allowPeerResolution !== "boolean") invalid("allowPeerResolution", "Must be a boolean.");
        data.allowPeerResolution = body.allowPeerResolution;
      }
      if (!id || body.levels !== undefined) data.levels = await validateLevels(body.levels, tx, previous?.levels);
      if (id) data.version = { increment: 1 };
      const row = id ? await tx.incidentWorkflow.update({ where: { id }, data, include: workflowInclude }) : await tx.incidentWorkflow.create({ data, include: workflowInclude });
      return workflowResource(row);
    }, { isolationLevel: "Serializable", timeout: 20000 });
  }
  async delete(id: string) {
    return prisma.$transaction(async tx => {
      const resource = await this.get(id, tx);
      if (!resource.canDelete) conflict("IN_USE", resource.deleteBlockedReason);
      await (tx.incidentWorkflow).delete({ where: { id } });
      return { id, deleted: true };
    }, { isolationLevel: "Serializable", timeout: 20000 });
  }
}
export const incidentWorkflowService = new IncidentWorkflowService();
