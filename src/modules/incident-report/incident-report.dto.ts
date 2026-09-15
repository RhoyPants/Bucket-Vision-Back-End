export type IncidentStatus = "PENDING" | "RESOLVED" | "CANCELLED";
export type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CreateIncidentReportDTO {
  incidentTypeId: string;
  projectId: string;
  title: string;
  description: string;
  occurredAt: string | Date;
  location: string;
  immediateActionTaken?: string;
  reportRecipient?: string;
  severity?: IncidentSeverity;
  dateRaised?: string | Date;
  remarks?: string;
  scopeId?: string;
  taskId?: string;
  subtaskId?: string;
}

export interface UpdateIncidentReportDTO {
  revision?: number;
  title?: string;
  description?: string;
  occurredAt?: string | Date;
  location?: string;
  immediateActionTaken?: string | null;
  reportRecipient?: string | null;
  severity?: IncidentSeverity;
  dateRaised?: string | Date;
  remarks?: string | null;
  scopeId?: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
}

export interface ResolveIncidentReportDTO {
  activeLevelId?: string;
  remarks?: string | null;
  dateAddressed?: string | Date;
  resolutionClassification?: string;
  finalEvidenceIds?: string[];
  confirmRequiredActionsCompleted?: boolean;
}

export interface CancelIncidentReportDTO {
  reason: string;
}
