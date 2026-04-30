// =========================
// CREATE DTO
// =========================
export interface CreateDailyReportDTO {
  projectId: string;
  dayNumber: number;
  date: Date | string;
  location: string;
  remarks?: string;
  attachments?: string[]; // Array of file URLs
  receiverIds?: string[]; // Array of user IDs to receive this report
}

// =========================
// UPDATE DTO
// =========================
export interface UpdateDailyReportDTO {
  dayNumber?: number;
  date?: Date | string;
  location?: string;
  remarks?: string;
  attachments?: string[];
  receiverIds?: string[]; // Update receivers
}

// =========================
// PARAMS DTO
// =========================
export interface DailyReportParamsDTO {
  id: string;
}

export interface GetDailyReportsByProjectDTO {
  projectId: string;
}

// =========================
// FILTER DTO
// =========================
export interface DailyReportFilterDTO {
  projectId?: string;
  userId?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  search?: string;
}

// =========================
// SUMMARY DTO
// =========================
export interface DailyReportSummaryDTO {
  totalSubmitted: number;
  totalPending: number;
  totalReviewed: number;
  lateReports: number;
  todayHighlights: {
    submittedCount: number;
    lateCount: number;
    onTimeCount: number;
  };
}
