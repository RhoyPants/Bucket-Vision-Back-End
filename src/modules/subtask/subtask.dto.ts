// CREATE
export interface CreateSubtaskDTO {
  taskId: string;
  title: string;
  statusId: string;
}

// GET PARAMS
export interface GetSubtasksParamsDTO {
  taskId: string;
}

// UPDATE
export interface UpdateSubtaskParamsDTO {
  id: string;
}

export interface UpdateSubtaskDTO {
  title?: string;
  description?: string;
  statusId?: string;
  priority?: string;
  dueDate?: Date;
  order?: number;
}

// DELETE
export interface DeleteSubtaskParamsDTO {
  id: string;
}

// TOGGLE CHECKLIST
export interface ToggleChecklistParamsDTO {
  checklistId: string;
}

// DELETE CHECKLIST ITEM
export interface DeleteChecklistItemParamsDTO {
  checklistId: string;
}