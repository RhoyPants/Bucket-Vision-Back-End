// =========================
// CREATE
// =========================
export interface CreateSubtaskDTO {
  taskId: string;
  title: string;

  // OPTIONAL
  description?: string;
  priority?: string;

  projectedStartDate?: Date | string;
  projectedEndDate?: Date | string;

  budgetAllocated?: number;
  budgetPercent?: number;

  remarks?: string;
  userIds?: string[];
}

// =========================
// GET PARAMS
// =========================
export interface GetSubtasksParamsDTO {
  taskId: string;
}

// =========================
// UPDATE PARAMS
// =========================
export interface UpdateSubtaskParamsDTO {
  id: string;
}

// =========================
// UPDATE (SAFE 🔥)
// =========================
export interface UpdateSubtaskDTO {
  title?: string;
  description?: string;

  // ❌ REMOVE statusId
  // status is AUTO computed from progress

  priority?: string;

  projectedStartDate?: Date | string;
  projectedEndDate?: Date | string;

  budgetAllocated?: number;
  budgetPercent?: number;

  remarks?: string;
  userIds?: string[];
}

// =========================
// DELETE
// =========================
export interface DeleteSubtaskParamsDTO {
  id: string;
}

// =========================
// CHECKLIST
// =========================
export interface ToggleChecklistParamsDTO {
  checklistId: string;
}

export interface DeleteChecklistItemParamsDTO {
  checklistId: string;
}

export interface EditChecklistParamsDTO {
  checklistId: string;
}

export interface EditChecklistDTO {
  title?: string;
  isCompleted?: boolean;
  order?: number;
}

// =========================
// GET BY ID
// =========================
export interface GetSubtaskByIdParamsDTO {
  id: string;
}

export interface AssignSubtaskDTO {
  userIds: string[];
}
