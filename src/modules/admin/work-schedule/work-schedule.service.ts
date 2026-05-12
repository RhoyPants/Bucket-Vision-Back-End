import prisma from "../../../config/prisma";

interface CreateWorkScheduleInput {
  name: string;
  description?: string;
  isDefault?: boolean;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
  includeHolidays?: boolean;
}

interface UpdateWorkScheduleInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
  includeHolidays?: boolean;
}

interface AddHolidayInput {
  date: Date;
  name: string;
}

export class WorkScheduleService {
  /**
   * Create new work schedule with day configurations
   */
  static async createSchedule(data: CreateWorkScheduleInput) {
    try {
      // Check if name already exists
      const existing = await (prisma as any).workSchedule.findUnique({
        where: { name: data.name }
      });

      if (existing) {
        throw new Error(`Work schedule "${data.name}" already exists`);
      }

      // If marking as default, unset others
      if (data.isDefault) {
        await (prisma as any).workSchedule.updateMany({
          where: { isDefault: true },
          data: { isDefault: false }
        });
      }

      const schedule = await (prisma as any).workSchedule.create({
        data: {
          name: data.name,
          description: data.description,
          isDefault: data.isDefault || false,
          isActive: true,
          monday: data.monday ?? true,
          tuesday: data.tuesday ?? true,
          wednesday: data.wednesday ?? true,
          thursday: data.thursday ?? true,
          friday: data.friday ?? true,
          saturday: data.saturday ?? false,
          sunday: data.sunday ?? false,
          includeHolidays: data.includeHolidays ?? false
        },
        include: { holidays: true }
      });

      return schedule;
    } catch (error: any) {
      throw new Error(`Failed to create work schedule: ${error.message}`);
    }
  }

  /**
   * Get all work schedules
   */
  static async getAllSchedules(onlyActive = false) {
    try {
      const schedules = await (prisma as any).workSchedule.findMany({
        where: onlyActive ? { isActive: true } : undefined,
        include: { holidays: { orderBy: { date: "asc" } } },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }]
      });

      return schedules;
    } catch (error: any) {
      throw new Error(`Failed to fetch work schedules: ${error.message}`);
    }
  }

  /**
   * Get schedule by ID
   */
  static async getScheduleById(scheduleId: string) {
    try {
      const schedule = await (prisma as any).workSchedule.findUnique({
        where: { id: scheduleId },
        include: { holidays: { orderBy: { date: "asc" } } }
      });

      if (!schedule) {
        throw new Error(`Work schedule not found`);
      }

      return schedule;
    } catch (error: any) {
      throw new Error(`Failed to fetch work schedule: ${error.message}`);
    }
  }

  /**
   * Get default schedule
   */
  static async getDefaultSchedule() {
    try {
      const schedule = await (prisma as any).workSchedule.findFirst({
        where: { isDefault: true, isActive: true },
        include: { holidays: { orderBy: { date: "asc" } } }
      });

      if (!schedule) {
        throw new Error(`No default work schedule configured`);
      }

      return schedule;
    } catch (error: any) {
      throw new Error(`Failed to fetch default work schedule: ${error.message}`);
    }
  }

  /**
   * Update work schedule
   */
  static async updateSchedule(scheduleId: string, data: UpdateWorkScheduleInput) {
    try {
      const schedule = await (prisma as any).workSchedule.findUnique({
        where: { id: scheduleId }
      });

      if (!schedule) {
        throw new Error(`Work schedule not found`);
      }

      // If marking as default, unset others
      if (data.isDefault) {
        await (prisma as any).workSchedule.updateMany({
          where: { isDefault: true, id: { not: scheduleId } },
          data: { isDefault: false }
        });
      }

      const updated = await (prisma as any).workSchedule.update({
        where: { id: scheduleId },
        data: {
          name: data.name,
          description: data.description,
          isDefault: data.isDefault,
          isActive: data.isActive,
          monday: data.monday,
          tuesday: data.tuesday,
          wednesday: data.wednesday,
          thursday: data.thursday,
          friday: data.friday,
          saturday: data.saturday,
          sunday: data.sunday,
          includeHolidays: data.includeHolidays
        },
        include: { holidays: { orderBy: { date: "asc" } } }
      });

      return updated;
    } catch (error: any) {
      throw new Error(`Failed to update work schedule: ${error.message}`);
    }
  }

  /**
   * Delete work schedule
   */
  static async deleteSchedule(scheduleId: string) {
    try {
      const schedule = await (prisma as any).workSchedule.findUnique({
        where: { id: scheduleId }
      });

      if (!schedule) {
        throw new Error(`Work schedule not found`);
      }

      if (schedule.isDefault) {
        // Check if any projects use this schedule
        const projectCount = await (prisma.project as any).count({
          where: { workScheduleId: scheduleId }
        });

        if (projectCount > 0) {
          throw new Error(
            `Cannot delete default schedule - ${projectCount} project(s) depend on it. Set another schedule as default first.`
          );
        }
      }

      await (prisma as any).workSchedule.delete({
        where: { id: scheduleId }
      });

      return { success: true, message: "Work schedule deleted" };
    } catch (error: any) {
      throw new Error(`Failed to delete work schedule: ${error.message}`);
    }
  }

  /**
   * Add holiday to schedule
   */
  static async addHoliday(scheduleId: string, data: AddHolidayInput) {
    try {
      const schedule = await (prisma as any).workSchedule.findUnique({
        where: { id: scheduleId }
      });

      if (!schedule) {
        throw new Error(`Work schedule not found`);
      }

      const holiday = await (prisma as any).holiday.create({
        data: {
          scheduleId,
          date: new Date(data.date),
          name: data.name
        }
      });

      return holiday;
    } catch (error: any) {
      throw new Error(`Failed to add holiday: ${error.message}`);
    }
  }

  /**
   * Remove holiday from schedule
   */
  static async removeHoliday(holidayId: string) {
    try {
      const holiday = await (prisma as any).holiday.findUnique({
        where: { id: holidayId }
      });

      if (!holiday) {
        throw new Error(`Holiday not found`);
      }

      await (prisma as any).holiday.delete({
        where: { id: holidayId }
      });

      return { success: true, message: "Holiday removed" };
    } catch (error: any) {
      throw new Error(`Failed to remove holiday: ${error.message}`);
    }
  }

  /**
   * Get working days configuration as bitmask
   * Returns object with day flags
   */
  static getDayConfiguration(schedule: any) {
    return {
      monday: schedule.monday,
      tuesday: schedule.tuesday,
      wednesday: schedule.wednesday,
      thursday: schedule.thursday,
      friday: schedule.friday,
      saturday: schedule.saturday,
      sunday: schedule.sunday,
      includeHolidays: schedule.includeHolidays,
      holidays: schedule.holidays || []
    };
  }

  /**
   * Set schedule as default
   */
  static async setDefaultSchedule(scheduleId: string) {
    try {
      const schedule = await (prisma as any).workSchedule.findUnique({
        where: { id: scheduleId }
      });

      if (!schedule) {
        throw new Error(`Work schedule not found`);
      }

      // Unset all other defaults
      await (prisma as any).workSchedule.updateMany({
        where: { isDefault: true, id: { not: scheduleId } },
        data: { isDefault: false }
      });

      const updated = await (prisma as any).workSchedule.update({
        where: { id: scheduleId },
        data: { isDefault: true },
        include: { holidays: { orderBy: { date: "asc" } } }
      });

      return updated;
    } catch (error: any) {
      throw new Error(`Failed to set default schedule: ${error.message}`);
    }
  }
}
