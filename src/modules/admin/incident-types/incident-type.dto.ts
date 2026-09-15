export interface CreateIncidentTypeDTO {
  name: string;
  description?: string | null;
  defaultCriticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  incidentWorkflowId: string;
  resolutionSlaValue: number;
  resolutionSlaUnit: "HOURS" | "DAYS";
  notificationMatrixId: string;
  isActive?: boolean;
}

export type UpdateIncidentTypeDTO = Partial<CreateIncidentTypeDTO>;
