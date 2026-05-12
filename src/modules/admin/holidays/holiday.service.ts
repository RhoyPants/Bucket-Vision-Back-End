import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class HolidayService {
  /**
   * 🔥 LIST ALL GLOBAL HOLIDAYS
   * Returns all holidays sorted by date
   */
  static async listHolidays() {
    return await prisma.holiday.findMany({
      orderBy: { date: "asc" },
    });
  }

  /**
   * 🔥 GET SINGLE HOLIDAY BY ID
   */
  static async getHolidayById(id: string) {
    return await prisma.holiday.findUnique({
      where: { id },
    });
  }

  /**
   * 🔥 CREATE HOLIDAY
   * Super admin adds a global holiday
   * @param date - Holiday date
   * @param name - Holiday name (e.g., "Christmas", "New Year")
   * @param description - Optional description
   */
  static async createHoliday(
    date: Date,
    name: string,
    description?: string
  ) {
    // Check if holiday already exists on this date
    const existing = await prisma.holiday.findFirst({
      where: {
        date: new Date(date),
      },
    });

    if (existing) {
      throw new Error(`Holiday already exists on ${date}`);
    }

    return await prisma.holiday.create({
      data: {
        date: new Date(date),
        name,
        ...(description && { description }),
      },
    });
  }

  /**
   * 🔥 UPDATE HOLIDAY
   * Super admin modifies holiday details
   */
  static async updateHoliday(
    id: string,
    data: {
      date?: Date;
      name?: string;
      description?: string;
    }
  ) {
    const holiday = await prisma.holiday.findUnique({
      where: { id },
    });

    if (!holiday) {
      throw new Error("Holiday not found");
    }

    // If date is being changed, check for conflicts
    if (data.date) {
      const existing = await prisma.holiday.findFirst({
        where: {
          date: new Date(data.date),
          id: { not: id },
        },
      });

      if (existing) {
        throw new Error(`Holiday already exists on ${data.date}`);
      }
    }

    return await prisma.holiday.update({
      where: { id },
      data: {
        ...(data.date && { date: new Date(data.date) }),
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description || null }),
      },
    });
  }

  /**
   * 🔥 DELETE HOLIDAY
   * Super admin removes a holiday
   */
  static async deleteHoliday(id: string) {
    const holiday = await prisma.holiday.findUnique({
      where: { id },
    });

    if (!holiday) {
      throw new Error("Holiday not found");
    }

    return await prisma.holiday.delete({
      where: { id },
    });
  }

  /**
   * 🔥 GET HOLIDAYS FOR DATE RANGE
   * Used by DurationCalculator to exclude holidays
   * @param startDate - Range start
   * @param endDate - Range end
   */
  static async getHolidaysInRange(startDate: Date, endDate: Date) {
    return await prisma.holiday.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }

  /**
   * 🔥 CHECK IF DATE IS HOLIDAY
   * @param date - Date to check
   */
  static async isHoliday(date: Date): Promise<boolean> {
    const holiday = await prisma.holiday.findFirst({
      where: {
        date: new Date(date),
      },
    });
    return !!holiday;
  }

  /**
   * 🔥 BATCH DELETE HOLIDAYS
   * Super admin removes multiple holidays at once (optional)
   */
  static async deleteHolidaysInRange(startDate: Date, endDate: Date) {
    return await prisma.holiday.deleteMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }
}
