export interface GetBySubtaskParamsDTO {
  subtaskId: string;
}

export interface CreateProgressDTO {
  subtaskId: string;
  date: Date;
  dailyPercent: number;
  userId?: string;
  remarks?: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
  location?: string;
  dayNumber?: number;
}

export interface UpdateProgressDTO {
  dailyPercent?: number;
  remarks?: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
  location?: string;
  dayNumber?: number;
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