import { randomUUID } from "crypto";
import prisma from "../../../config/prisma";
import { activeFilter, commonFields, conflict, invalid, missing, pagination, validateFields } from "../../incident-report/workflow/incident-workflow.contract";

const include = { _count: { select: { incidentTypes: true, incidents: true } } };
const resource = (row: any) => {
  const { _count, ...data } = row;
  const usage = { incidentTypeCount: _count?.incidentTypes || 0, incidentCount: _count?.incidents || 0 };
  const canDelete = !usage.incidentTypeCount && !usage.incidentCount;
  return { ...data, levelCount: row.levels.length, usage, canDelete, deleteBlockedReason: canDelete ? null : "Referenced by incident types or incidents" };
};

async function levels(raw: any, tx: any, previous: any[] = []) {
  if (!Array.isArray(raw) || !raw.length) invalid("levels", "At least one notification level is required.");
  const ids = new Set<string>(); const result: any[] = [];
  for (let index = 0; index < raw.length; index++) {
    const value = raw[index]; const field = `levels[${index}]`;
    validateFields(value, ["id", "order", "assignmentType", "roleId", "userId", "notifyAfterValue", "notifyAfterUnit", "slaValue", "slaUnit"]);
    if (value.order !== index + 1) invalid(`${field}.order`, "Levels must be consecutive starting at 1.");
    if (value.id !== undefined && (!previous.some(x => x.id === value.id) || ids.has(value.id))) invalid(`${field}.id`, "Unknown or duplicate level ID.");
    if (!["ROLE", "SPECIFIC_USER"].includes(value.assignmentType)) invalid(`${field}.assignmentType`, "Use ROLE or SPECIFIC_USER.");
    const notifyAfterValue = value.notifyAfterValue ?? value.slaValue;
    const notifyAfterUnit = value.notifyAfterUnit ?? value.slaUnit;
    if (typeof notifyAfterValue !== "number" || !Number.isFinite(notifyAfterValue) || notifyAfterValue < 0) invalid(`${field}.notifyAfterValue`, "Delay must be zero or greater.");
    if (!["HOURS", "DAYS"].includes(notifyAfterUnit)) invalid(`${field}.notifyAfterUnit`, "Use HOURS or DAYS.");
    if (notifyAfterUnit === "DAYS" && !Number.isInteger(notifyAfterValue)) invalid(`${field}.notifyAfterValue`, "Working days must be a whole number.");
    let label: string;
    if (value.assignmentType === "ROLE") {
      if (value.userId != null) invalid(`${field}.userId`, "Not applicable to ROLE.");
      const role = await tx.role.findFirst({ where: { id: value.roleId, isActive: true } });
      if (!role) invalid(`${field}.roleId`, "Select an active role."); label = role.name;
    } else {
      if (value.roleId != null) invalid(`${field}.roleId`, "Not applicable to SPECIFIC_USER.");
      const user = await tx.user.findFirst({ where: { id: value.userId, isActive: true, role: { isActive: true } } });
      if (!user) invalid(`${field}.userId`, "Select an active user."); label = user.name;
    }
    const id = value.id || randomUUID(); ids.add(id);
    result.push({ id, order: value.order, assignmentType: value.assignmentType, roleId: value.roleId ?? null, userId: value.userId ?? null, recipientLabel: label!, notifyAfterValue, notifyAfterUnit });
  }
  return result;
}

export class EscalationNotificationMatrixService {
  async list(query: any) {
    const { page, limit } = pagination(query); const active = activeFilter(query.active);
    const where = { ...(active === undefined ? {} : { isActive: active }), ...(query.search ? { name: { contains: String(query.search).trim(), mode: "insensitive" as const } } : {}) };
    const [rows, total] = await prisma.$transaction([prisma.escalationNotificationMatrix.findMany({ where, include, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }), prisma.escalationNotificationMatrix.count({ where })]);
    return { data: rows.map(resource), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  async get(id: string, tx: any = prisma) { const row = await tx.escalationNotificationMatrix.findUnique({ where: { id }, include }); if (!row) missing(); return resource(row); }
  async save(body: any, id?: string) {
    validateFields(body, ["name", "description", "isActive", "levels", "version"]);
    return prisma.$transaction(async tx => {
      const previous = id ? await this.get(id, tx) : null;
      if (body.version !== undefined && body.version !== previous?.version) conflict("STALE_VERSION", "The notification matrix has changed. Reload before saving.");
      const data = commonFields(body, !id);
      if (!id || body.levels !== undefined) data.levels = await levels(body.levels, tx, previous?.levels);
      if (id) data.version = { increment: 1 };
      const row = id ? await tx.escalationNotificationMatrix.update({ where: { id }, data, include }) : await tx.escalationNotificationMatrix.create({ data, include });
      return resource(row);
    }, { isolationLevel: "Serializable", timeout: 20000 });
  }
  async delete(id: string) { return prisma.$transaction(async tx => { const row = await this.get(id, tx); if (!row.canDelete) conflict("IN_USE", row.deleteBlockedReason); await tx.escalationNotificationMatrix.delete({ where: { id } }); return { id, deleted: true }; }); }
}
export const escalationNotificationMatrixService = new EscalationNotificationMatrixService();
