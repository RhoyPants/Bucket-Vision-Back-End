// =========================
// CREATE
// =========================
export interface CreateTaskDTO {
  title: string;
  description?: string;
  order?: number;

  categoryId: string; // 🔥 REPLACED

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
// GET BY CATEGORY
// =========================
export interface GetTasksByCategoryParamsDTO {
  categoryId: string;
}

// =========================
// UPDATE (SAFE)
// =========================
export interface UpdateTaskDTO {
  title?: string;
  description?: string;
  order?: number;

  budgetAllocated?: number;
  budgetPercent?: number;
}