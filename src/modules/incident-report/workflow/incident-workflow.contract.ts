import { randomUUID } from "crypto";

export class IncidentApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) { super(message); }
}
export const invalid = (field: string, message: string): never => { throw new IncidentApiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { [field]: message }); };
export const missing = (): never => { throw new IncidentApiError(404, "NOT_FOUND", "Record not found."); };
export const conflict = (code: string, message: string): never => { throw new IncidentApiError(409, code, message); };

export interface WorkflowLevel {
  id: string; order: number;
  assignmentType: "REQUESTER_BU_HEAD" | "PROJECT_BU_HEAD" | "PROJECT_OWNER" | "ROLE" | "SPECIFIC_USER";
  roleId: string | null; userId: string | null;
  responsiblePartyLabel: string; completionRule: "ANY_ONE" | "ALL";
  slaValue: number; slaUnit: "HOURS" | "DAYS"; isFinal: boolean;
}

export function pagination(query: any) {
  const parse = (key: string, fallback: number, max: number) => {
    if (query[key] === undefined) return fallback;
    const n = Number(query[key]);
    if (!Number.isInteger(n) || n < 1 || n > max) invalid(key, `Must be an integer between 1 and ${max}.`);
    return n;
  };
  return { page: parse("page", 1, 1000000), limit: parse("limit", 10, 100) };
}
export function activeFilter(value: unknown) {
  if (value === undefined) return undefined;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return invalid("active", "Must be true or false.");
}
export function validateFields(body: any, allowed: string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("body", "An object is required.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) invalid(key, "Unsupported field.");
}
export function commonFields(body: any, create: boolean) {
  const data: any = {};
  if (create || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 200) invalid("name", "Name is required, up to 200 characters.");
    data.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") invalid("description", "Must be text or null.");
    data.description = body.description?.trim() || null;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") invalid("isActive", "Must be a boolean.");
    data.isActive = body.isActive;
  }
  return data;
}
export async function validateLevels(raw: any, tx: any, previous: WorkflowLevel[] = []): Promise<WorkflowLevel[]> {
  if (!Array.isArray(raw) || !raw.length) invalid("levels", "At least one level is required.");
  const ids = new Set<string>();
  const result: WorkflowLevel[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]; const field = `levels[${i}]`;
    validateFields(item, ["id", "order", "assignmentType", "roleId", "userId", "completionRule", "slaValue", "slaUnit", "isFinal"]);
    if (item.order !== i + 1) invalid(`${field}.order`, "Levels must be ordered consecutively starting at 1.");
    if (typeof item.isFinal !== "boolean" || item.isFinal !== (i === raw.length - 1)) invalid(`${field}.isFinal`, "Only the last level must be final.");
    if (item.id !== undefined && (!previous.some(l => l.id === item.id) || ids.has(item.id))) invalid(`${field}.id`, "Unknown or duplicate level ID.");
    const id = item.id || randomUUID(); ids.add(id);
    const labels: Record<string, string> = { REQUESTER_BU_HEAD: "Incident Creator's BU Head", PROJECT_BU_HEAD: "Project's BU Head", PROJECT_OWNER: "Project Owner" };
    let label = labels[item.assignmentType];
    const additional: Record<string, string> = { ROLE: "roleId", SPECIFIC_USER: "userId" };
    for (const key of ["roleId", "userId"]) {
      if (item[key] != null && additional[item.assignmentType] !== key) invalid(`${field}.${key}`, "Not applicable to this assignment type.");
    }
    if (additional[item.assignmentType] && (typeof item[additional[item.assignmentType]] !== "string" || !item[additional[item.assignmentType]].trim())) invalid(`${field}.${additional[item.assignmentType]}`, "Required.");
    if (item.assignmentType === "ROLE") {
      const role = await tx.role.findFirst({ where: { id: item.roleId, isActive: true } });
      if (!role) invalid(`${field}.roleId`, "Select an active role."); label = role.name;
    } else if (item.assignmentType === "SPECIFIC_USER") {
      const user = await tx.user.findFirst({ where: { id: item.userId, isActive: true, role: { isActive: true } } });
      if (!user) invalid(`${field}.userId`, "Select an active user with an active role."); label = user.name;
    } else if (!label) invalid(`${field}.assignmentType`, "Invalid assignment type.");
    const rule = item.completionRule ?? "ANY_ONE";
    if (!["ANY_ONE", "ALL"].includes(rule)) invalid(`${field}.completionRule`, "Use ANY_ONE or ALL.");
    if (typeof item.slaValue !== "number" || !Number.isFinite(item.slaValue) || item.slaValue <= 0 || item.slaValue > 36500) invalid(`${field}.slaValue`, "SLA must be greater than zero and at most 36500.");
    if (!["HOURS", "DAYS"].includes(item.slaUnit)) invalid(`${field}.slaUnit`, "Use HOURS or DAYS.");
    if (item.slaUnit === "DAYS" && !Number.isInteger(item.slaValue)) invalid(`${field}.slaValue`, "Working days must be a whole number.");
    result.push({ id, order: item.order, assignmentType: item.assignmentType, roleId: item.roleId ?? null, userId: item.userId ?? null, responsiblePartyLabel: label!, completionRule: rule, slaValue: item.slaValue, slaUnit: item.slaUnit, isFinal: item.isFinal });
  }
  return result;
}

// VISION's project includeHolidays flag means global holidays are excluded from working days.
// Projects have no timezone field; use the application's Philippine calendar explicitly.
export function slaDeadline(start: Date, level: Pick<WorkflowLevel, "slaValue" | "slaUnit">, calendar: any): Date {
  if (level.slaUnit === "HOURS") return new Date(start.getTime() + level.slaValue! * 3600000);
  const weekdays = [calendar.sunday, calendar.monday, calendar.tuesday, calendar.wednesday, calendar.thursday, calendar.friday, calendar.saturday];
  if (!weekdays.some(Boolean)) invalid("project.workSchedule", "At least one working day is required for a DAYS SLA.");
  const holidays = new Set<string>(calendar.holidays || []);
  const date = new Date(start); let remaining = level.slaValue!;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const local = new Date(date.getTime() + 8 * 3600000);
    if (weekdays[local.getUTCDay()] && !(calendar.includeHolidays && holidays.has(local.toISOString().slice(0, 10)))) remaining--;
  }
  return date;
}
