import { ScheduleHealthStatus } from "../../utils/schedule-health";

export const REPORT_HEALTH_PRESENTATION: Record<ScheduleHealthStatus, { label: string; color: string }> = {
  DANGER: { label: "Danger", color: "#dc2626" },
  WARNING: { label: "Warning", color: "#f59e0b" },
  HEALTHY: { label: "Healthy", color: "#16a34a" },
  NOT_STARTED: { label: "Not Started", color: "#64748b" },
  UNCLASSIFIED: { label: "Unavailable", color: "#94a3b8" },
};

export function reportHealthLabel(status: unknown) {
  return REPORT_HEALTH_PRESENTATION[status as ScheduleHealthStatus]?.label || "Unavailable";
}
