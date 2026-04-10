// CREATE
export interface CreateProjectDTO {
  name: string;
  description?: string;
}

// PARAMS
export interface ProjectParamsDTO {
  id: string;
}

// UPDATE
export interface UpdateProjectDTO {
  name?: string;
  description?: string;
}