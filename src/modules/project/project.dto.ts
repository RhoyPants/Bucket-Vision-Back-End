// =========================
// CREATE
// =========================
export interface CreateProjectDTO {
  name: string;
  description?: string;

  location?: string;
  managerId?: string;

  startDate?: Date | string;
  expectedEndDate?: Date | string;

  totalBudget?: number;
  priority?: string;
  pin?: string;
  businessUnit?: string;
  entity?: string;

  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
  includeHolidays?: boolean;
}

// =========================
// PARAMS
// =========================
export interface ProjectParamsDTO {
  id: string;
}

// =========================
// UPDATE
// =========================
export interface UpdateProjectDTO {
  name?: string;
  description?: string;
  businessUnit?: string;
  entity?: string;

  location?: string;
  managerId?: string;

  startDate?: Date | string;
  expectedEndDate?: Date | string;

  totalBudget?: number;
  priority?: string;
  pin?: string;

  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
  includeHolidays?: boolean;
  /** General project editing may only use this field to save an editable project as DRAFT. */
  status?: ProjectStatus;
}
import { ProjectStatus } from "@prisma/client";
