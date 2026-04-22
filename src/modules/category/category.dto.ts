// =========================
// CREATE
// =========================
export interface CreateCategoryDTO {
  name: string;
  description?: string;

  projectId: string;

  budgetAllocated?: number;
  budgetPercent?: number;
}

// =========================
// PARAMS
// =========================
export interface CategoryParamsDTO {
  id: string;
}

// =========================
// GET BY PROJECT
// =========================
export interface GetCategoriesByProjectParamsDTO {
  projectId: string;
}

// =========================
// UPDATE
// =========================
export interface UpdateCategoryDTO {
  name?: string;
  description?: string;

  budgetAllocated?: number;
  budgetPercent?: number;
}