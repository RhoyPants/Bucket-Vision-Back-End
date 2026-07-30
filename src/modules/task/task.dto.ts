// =========================
// CREATE
// =========================
export interface CreateTaskDTO {
  title: string;
  sourceType?: "CUSTOM" | "MAINTENANCE" | null;
  taskMaintenanceId?: string | null;
  description?: string;
  order?: number;

  scopeId: string; // 🔥 RENAMED FROM categoryId

  budgetAllocated?: number;
  budgetPercent?: number;
}

// =========================
// PARAMS
// =========================
export interface TaskParamsDTO {
  id: string;
}

// =========================
// GET BY SCOPE
//=========================
export interface GetTasksByScopeParamsDTO {
  scopeId: string;
}

// =========================
// UPDATE (SAFE)
// =========================
export interface UpdateTaskDTO {
  title?: string;
  sourceType?: "CUSTOM" | "MAINTENANCE" | null;
  taskMaintenanceId?: string | null;
  description?: string;
  order?: number;

  budgetAllocated?: number;
  budgetPercent?: number;
}
