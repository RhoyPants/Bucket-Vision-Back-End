export interface CreatePhaseDTO {
  projectId: string;
  name: string;
  description?: string;
  order?: number;
}

export interface UpdatePhaseDTO {
  name?: string;
  description?: string | null;
  order?: number;
}
