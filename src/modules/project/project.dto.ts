// =========================
// CREATE
// =========================
export interface CreateProjectDTO {
  name: string;
  description?: string;

  location?: string;
  managerId?: string;

  startDate?: Date | string;
  expectedEndDate?: Date | string;

  totalBudget?: number;
  priority?: string;
  pin?: string;
  businessUnit?: string;
  entity?: string;
}

// =========================
// PARAMS
// =========================
export interface ProjectParamsDTO {
  id: string;
}

// =========================
// UPDATE
// =========================
export interface UpdateProjectDTO {
  name?: string;
  description?: string;
  businessUnit?: string;
  entity?: string;

  location?: string;
  managerId?: string;

  startDate?: Date | string;
  expectedEndDate?: Date | string;

  totalBudget?: number;
  priority?: string;
  pin?: string;
}
