export type IncidentStatus = "PENDING" | "RESOLVED" | "CANCELLED";
export type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CreateIncidentReportDTO {
  projectId: string;
  title: string;
  description: string;
  severity?: IncidentSeverity;
  dateRaised?: string | Date;
  remarks?: string;
  scopeId?: string;
  taskId?: string;
  subtaskId?: string;
}

export interface UpdateIncidentReportDTO {
  title?: string;
  description?: string;
  severity?: IncidentSeverity;
  dateRaised?: string | Date;
  remarks?: string | null;
  scopeId?: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
}

export interface ResolveIncidentReportDTO {
  remarks?: string | null;
  dateAddressed?: string | Date;
}

export interface CancelIncidentReportDTO {
  reason: string;
}

