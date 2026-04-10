// CREATE
export interface CreateTaskDTO {
  title: string;
  description?: string;
  projectId: string;
}

// PARAMS
export interface TaskParamsDTO {
  id: string;
}

// GET BY PROJECT
export interface GetTasksByProjectParamsDTO {
  projectId: string;
}

// UPDATE
export interface UpdateTaskDTO {
  title?: string;
  description?: string;
}