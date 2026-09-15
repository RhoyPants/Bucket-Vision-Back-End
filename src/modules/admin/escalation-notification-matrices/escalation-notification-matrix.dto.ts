export interface NotificationLevelDTO {
  id?: string;
  order: number;
  assignmentType: "ROLE" | "SPECIFIC_USER";
  roleId?: string | null;
  userId?: string | null;
  notifyAfterValue: number;
  notifyAfterUnit: "HOURS" | "DAYS";
  slaValue?: number;
  slaUnit?: "HOURS" | "DAYS";
}

export interface CreateEscalationNotificationMatrixDTO {
  name: string;
  description?: string | null;
  isActive?: boolean;
  levels: NotificationLevelDTO[];
}

export type UpdateEscalationNotificationMatrixDTO = Partial<CreateEscalationNotificationMatrixDTO> & { version?: number };
