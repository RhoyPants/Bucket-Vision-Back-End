export interface GetBySubtaskParamsDTO {
  subtaskId: string;
}

export interface AttachmentInputDTO {
  url: string;
  name: string;
  mimeType?: string;
  size?: number;
  sortOrder?: number;
}

export interface UpdateAttachmentInputDTO {
  id: string;
  name?: string;
  sortOrder?: number;
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
  attachments?: AttachmentInputDTO[];
}

export interface UpdateProgressDTO {
  dailyPercent?: number;
  remarks?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface UpdateProgressAttachmentsDTO {
  attachmentUpdates?: UpdateAttachmentInputDTO[];
  removeAttachmentIds?: string[];
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