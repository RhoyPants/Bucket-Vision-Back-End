export interface GetBySubtaskParamsDTO {
  subtaskId: string;
}

export interface CreateProgressDTO {
  subtaskId: string;
  date: Date;
  dailyPercent: number;
  remarks?: string;
  photoUrl?: string;
  attachmentUrl?: string;
  latitude?: number | null;
  longitude?: number | null;
  userId?: string;
}

export interface UpdateProgressDTO {
  dailyPercent: number;
}

export interface UpdateProgressParamsDTO {
  id: string;
}

export interface DeleteProgressParamsDTO {
  id: string;
}

export interface GetSCurveParamsDTO {
  projectId: string;
}

export interface ProgressResponseDTO {
  success: boolean;
  message?: string;
  data?: any;
  status?: string;
}