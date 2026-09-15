import { WorkflowLevel } from "../../incident-report/workflow/incident-workflow.contract";

export type IncidentWorkflowLevelDTO = Omit<WorkflowLevel, "id" | "responsiblePartyLabel" | "roleId" | "userId"> & {
  id?: string;
  roleId?: string | null;
  userId?: string | null;
};

export interface CreateIncidentWorkflowDTO {
  name: string;
  description?: string | null;
  isActive?: boolean;
  allowPeerResolution?: boolean;
  levels: IncidentWorkflowLevelDTO[];
}

export type UpdateIncidentWorkflowDTO = Partial<CreateIncidentWorkflowDTO> & { version?: number };
