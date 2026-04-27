// =========================
// CREATE DTO
// =========================
export interface CreateWeeklyReportDTO {
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  remarks?: string;
  attachments?: string[]; // Array of file URLs/links
  receiverIds?: string[]; // Array of user IDs to receive this report
}

// =========================
// UPDATE DTO
// =========================
export interface UpdateWeeklyReportDTO {
  title?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  remarks?: string;
  attachments?: string[];
  receiverIds?: string[]; // Update receivers
}

// =========================
// PARAMS DTO
// =========================
export interface WeeklyReportParamsDTO {
  id: string;
}

// =========================
// FILTER DTO
// =========================
export interface WeeklyReportFilterDTO {
  userId?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  search?: string;
}

// =========================
// RESPONSE/SUMMARY DTO
// =========================
export interface WeeklyReportSummaryDTO {
  totalSubmitted: number;
  totalPending: number;
  totalReviewed: number;
  lateReports: number;
  thisWeekHighlights: any;
}
