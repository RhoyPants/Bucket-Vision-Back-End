import prisma from "../../../config/prisma";

export type MaintenanceSourceType = "CUSTOM" | "MAINTENANCE";

export function normalizeSourceType(value: unknown): MaintenanceSourceType {
  const normalized = String(value || "CUSTOM").trim().toUpperCase();
  if (normalized !== "CUSTOM" && normalized !== "MAINTENANCE") {
    throw new Error("sourceType must be CUSTOM or MAINTENANCE");
  }
  return normalized;
}

export async function resolveScopeSelection(input: {
  sourceType?: unknown;
  maintenanceId?: string | null;
  customName?: string | null;
}) {
  const sourceType = normalizeSourceType(input.sourceType);
  if (sourceType === "CUSTOM") {
    const name = String(input.customName || "").trim();
    if (!name) throw new Error("Scope name is required for a custom scope");
    if (input.maintenanceId) throw new Error("Custom scope cannot have a maintenance ID");
    return { sourceType, maintenanceId: null, name };
  }

  if (!input.maintenanceId) throw new Error("scopeMaintenanceId is required");
  const master = await (prisma as any).scopeMaintenance.findFirst({
    where: { id: input.maintenanceId, isActive: true },
  });
  if (!master) throw new Error("Scope maintenance record not found or inactive");
  return { sourceType, maintenanceId: master.id, name: master.name };
}

export async function resolveTaskSelection(input: {
  sourceType?: unknown;
  maintenanceId?: string | null;
  customTitle?: string | null;
  parentScopeMaintenanceId?: string | null;
}) {
  const sourceType = normalizeSourceType(input.sourceType);
  if (sourceType === "CUSTOM") {
    const title = String(input.customTitle || "").trim();
    if (!title) throw new Error("Task title is required for a custom task");
    if (input.maintenanceId) throw new Error("Custom task cannot have a maintenance ID");
    return { sourceType, maintenanceId: null, title };
  }

  if (!input.maintenanceId) throw new Error("taskMaintenanceId is required");
  const master = await (prisma as any).taskMaintenance.findFirst({
    where: { id: input.maintenanceId, isActive: true },
  });
  if (!master) throw new Error("Task maintenance record not found or inactive");

  if (input.parentScopeMaintenanceId) {
    const link = await (prisma as any).scopeMaintenanceTask.findUnique({
      where: {
        scopeMaintenanceId_taskMaintenanceId: {
          scopeMaintenanceId: input.parentScopeMaintenanceId,
          taskMaintenanceId: master.id,
        },
      },
    });
    if (!link) throw new Error("Selected task is not allowed under the selected scope");
  }

  return { sourceType, maintenanceId: master.id, title: master.name };
}

export async function resolveSubtaskSelection(input: {
  sourceType?: unknown;
  maintenanceId?: string | null;
  customTitle?: string | null;
  parentTaskMaintenanceId?: string | null;
}) {
  const sourceType = normalizeSourceType(input.sourceType);
  if (sourceType === "CUSTOM") {
    const title = String(input.customTitle || "").trim();
    if (!title) throw new Error("Subtask title is required for a custom subtask");
    if (input.maintenanceId) throw new Error("Custom subtask cannot have a maintenance ID");
    return { sourceType, maintenanceId: null, title };
  }

  if (!input.maintenanceId) throw new Error("subtaskMaintenanceId is required");
  const master = await (prisma as any).subtaskMaintenance.findFirst({
    where: { id: input.maintenanceId, isActive: true },
  });
  if (!master) throw new Error("Subtask maintenance record not found or inactive");

  if (input.parentTaskMaintenanceId) {
    const link = await (prisma as any).taskMaintenanceSubtask.findUnique({
      where: {
        taskMaintenanceId_subtaskMaintenanceId: {
          taskMaintenanceId: input.parentTaskMaintenanceId,
          subtaskMaintenanceId: master.id,
        },
      },
    });
    if (!link) throw new Error("Selected subtask is not allowed under the selected task");
  }

  return { sourceType, maintenanceId: master.id, title: master.name };
}

