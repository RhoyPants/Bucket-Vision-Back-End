/**
 * Duration Calculator - Calculates working days based on work schedule
 * Handles weekday/weekend filtering and holiday exclusion
 */

interface WorkScheduleConfig {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  includeHolidays: boolean;
  holidays: Array<{ date: Date; name: string }>;
}

export class DurationCalculator {
  /**
   * Get day of week (0 = Sunday, 1 = Monday, etc.)
   */
  private static getDayOfWeek(date: Date): number {
    return date.getDay();
  }

  /**
   * Check if date is a working day based on schedule
   */
  private static isWorkingDay(date: Date, schedule: WorkScheduleConfig): boolean {
    const dayOfWeek = this.getDayOfWeek(date);

    const workingDays = [
      schedule.sunday,    // 0
      schedule.monday,    // 1
      schedule.tuesday,   // 2
      schedule.wednesday, // 3
      schedule.thursday,  // 4
      schedule.friday,    // 5
      schedule.saturday   // 6
    ];

    return workingDays[dayOfWeek];
  }

  /**
   * Check if date is a holiday
   */
  private static isHoliday(date: Date, schedule: WorkScheduleConfig): boolean {
    if (!schedule.includeHolidays || !schedule.holidays || schedule.holidays.length === 0) {
      return false;
    }

    const dateStr = date.toISOString().split("T")[0];
    const holidayStr = (holiday: any) =>
      new Date(holiday.date).toISOString().split("T")[0];

    return schedule.holidays.some((h) => holidayStr(h) === dateStr);
  }

  /**
   * Main function: Calculate working days between two dates
   * @param startDate Start date (inclusive)
   * @param endDate End date (inclusive)
   * @param schedule Work schedule configuration
   * @returns Number of working days
   */
  static calculateWorkDays(
    startDate: Date,
    endDate: Date,
    schedule: WorkScheduleConfig
  ): number {
    // Normalize dates to midnight
    let start = new Date(startDate);
    let end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    // Swap if end before start
    if (end < start) {
      [start, end] = [end, start];
    }

    let workDays = 0;
    const current = new Date(start);

    while (current <= end) {
      if (this.isWorkingDay(current, schedule) && !this.isHoliday(current, schedule)) {
        workDays++;
      }
      current.setDate(current.getDate() + 1);
    }

    return workDays;
  }

  /**
   * Calculate calendar days (simple version)
   */
  static calculateCalendarDays(startDate: Date, endDate: Date): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1; // Inclusive
  }

  /**
   * Get working days in a week based on schedule
   */
  static getWorkingDaysPerWeek(schedule: WorkScheduleConfig): number {
    const daysPerWeek = [
      schedule.sunday,
      schedule.monday,
      schedule.tuesday,
      schedule.wednesday,
      schedule.thursday,
      schedule.friday,
      schedule.saturday
    ];

    return daysPerWeek.filter((d) => d).length;
  }

  /**
   * Get schedule summary string
   * Example: "Weekdays (Mon-Fri) excluding 2 holidays"
   */
  static getScheduleSummary(schedule: WorkScheduleConfig): string {
    const days = [];
    if (schedule.monday) days.push("Mon");
    if (schedule.tuesday) days.push("Tue");
    if (schedule.wednesday) days.push("Wed");
    if (schedule.thursday) days.push("Thu");
    if (schedule.friday) days.push("Fri");
    if (schedule.saturday) days.push("Sat");
    if (schedule.sunday) days.push("Sun");

    const daysStr = days.join("-");
    let summary = daysStr;

    if (schedule.includeHolidays && schedule.holidays && schedule.holidays.length > 0) {
      summary += ` (excluding ${schedule.holidays.length} holiday${schedule.holidays.length > 1 ? "s" : ""})`;
    }

    return summary;
  }

  /**
   * Calculate end date from start date + working days
   * Useful for setting expected end date based on duration
   */
  static addWorkingDays(
    startDate: Date,
    workingDaysToAdd: number,
    schedule: WorkScheduleConfig
  ): Date {
    const result = new Date(startDate);
    result.setHours(0, 0, 0, 0);

    let daysAdded = 0;

    while (daysAdded < workingDaysToAdd) {
      result.setDate(result.getDate() + 1);
      if (this.isWorkingDay(result, schedule) && !this.isHoliday(result, schedule)) {
        daysAdded++;
      }
    }

    return result;
  }

  /**
   * Get next working day from given date
   */
  static getNextWorkingDay(startDate: Date, schedule: WorkScheduleConfig): Date {
    const result = new Date(startDate);
    result.setHours(0, 0, 0, 0);

    while (true) {
      result.setDate(result.getDate() + 1);
      if (this.isWorkingDay(result, schedule) && !this.isHoliday(result, schedule)) {
        return result;
      }
    }
  }

  /**
   * Get previous working day from given date
   */
  static getPreviousWorkingDay(startDate: Date, schedule: WorkScheduleConfig): Date {
    const result = new Date(startDate);
    result.setHours(0, 0, 0, 0);

    while (true) {
      result.setDate(result.getDate() - 1);
      if (this.isWorkingDay(result, schedule) && !this.isHoliday(result, schedule)) {
        return result;
      }
    }
  }

  /**
   * Get percentage progress of timeline
   */
  static getTimelineProgress(
    projectStart: Date,
    expectedEnd: Date,
    currentDate: Date,
    schedule: WorkScheduleConfig
  ): number {
    const totalWorkDays = this.calculateWorkDays(projectStart, expectedEnd, schedule);
    const elapsedWorkDays = this.calculateWorkDays(projectStart, currentDate, schedule);

    if (totalWorkDays === 0) return 0;
    return Math.min(100, Math.round((elapsedWorkDays / totalWorkDays) * 100));
  }
}
