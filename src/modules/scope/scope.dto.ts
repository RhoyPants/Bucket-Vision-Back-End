// =========================
// CREATE
// =========================
export interface CreateScopeDTO {
  name: string;
  sourceType?: "CUSTOM" | "MAINTENANCE" | null;
  scopeMaintenanceId?: string | null;
  description?: string;
  order?: number;

  projectId: string;
  phaseId?: string | null;

  budgetAllocated?: number;
  budgetPercent?: number;
}

// =========================
// PARAMS
// =========================
export interface ScopeParamsDTO {
  id: string;
}

// =========================
// GET BY PROJECT
// =========================
export interface GetScopesByProjectParamsDTO {
  projectId: string;
}

// =========================
// UPDATE
// =========================
export interface UpdateScopeDTO {
  name?: string;
  sourceType?: "CUSTOM" | "MAINTENANCE" | null;
  scopeMaintenanceId?: string | null;
  description?: string;
  order?: number;
  phaseId?: string | null;

  budgetAllocated?: number;
  budgetPercent?: number;
}
