import prisma from "../../config/prisma";

export class BusinessUnitService {
  /**
   * Get all business units
   */
  async getAllBusinessUnits(filters?: { entity?: string; isActive?: boolean }) {
    const where: any = {};

    if (filters?.entity) {
      where.entity = filters.entity;
    }

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    return await prisma.businessUnit.findMany({
      where,
      orderBy: { code: "asc" },
    });
  }

  /**
   * Get business unit by code
   */
  async getBusinessUnitByCode(code: string) {
    return await prisma.businessUnit.findUnique({
      where: { code: code.toUpperCase() },
    });
  }

  /**
   * Get business unit by ID
   */
  async getBusinessUnitById(id: string) {
    return await prisma.businessUnit.findUnique({
      where: { id },
    });
  }

  /**
   * Create new business unit
   */
  async createBusinessUnit(data: {
    code: string;
    name: string;
    entity: string;
    buHead?: string;
    assistantHead?: string;
  }) {
    const code = data.code.toUpperCase().trim();
    const name = data.name.trim();
    const entity = data.entity.trim();

    // Check if code already exists
    const existing = await prisma.businessUnit.findUnique({
      where: { code },
    });

    if (existing) {
      throw new Error(`Business Unit with code '${code}' already exists`);
    }

    return await prisma.businessUnit.create({
      data: {
        code,
        name,
        entity,
        buHead: data.buHead?.trim() || null,
        assistantHead: data.assistantHead?.trim() || null,
        isActive: true,
      },
    });
  }

  /**
   * Update business unit
   */
  async updateBusinessUnit(
    id: string,
    data: {
      name?: string;
      entity?: string;
      buHead?: string | null;
      assistantHead?: string | null;
      isActive?: boolean;
    }
  ) {
    const businessUnit = await prisma.businessUnit.findUnique({
      where: { id },
    });

    if (!businessUnit) {
      throw new Error("Business Unit not found");
    }

    return await prisma.businessUnit.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name.trim() }),
        ...(data.entity && { entity: data.entity.trim() }),
        ...(data.buHead !== undefined && { buHead: data.buHead ? data.buHead.trim() : null }),
        ...(data.assistantHead !== undefined && {
          assistantHead: data.assistantHead ? data.assistantHead.trim() : null,
        }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  /**
   * Assign BU Head to business unit
   */
  async assignBUHead(id: string, buHead: string | null) {
    const businessUnit = await prisma.businessUnit.findUnique({
      where: { id },
    });

    if (!businessUnit) {
      throw new Error("Business Unit not found");
    }

    return await prisma.businessUnit.update({
      where: { id },
      data: {
        buHead: buHead ? buHead.trim() : null,
      },
    });
  }

  /**
   * Assign Assistant BU Head to business unit
   */
  async assignAssistantBUHead(id: string, assistantHead: string | null) {
    const businessUnit = await prisma.businessUnit.findUnique({
      where: { id },
    });

    if (!businessUnit) {
      throw new Error("Business Unit not found");
    }

    return await prisma.businessUnit.update({
      where: { id },
      data: {
        assistantHead: assistantHead ? assistantHead.trim() : null,
      },
    });
  }

  /**
   * Delete business unit
   */
  async deleteBusinessUnit(id: string) {
    const businessUnit = await prisma.businessUnit.findUnique({
      where: { id },
    });

    if (!businessUnit) {
      throw new Error("Business Unit not found");
    }

    return await prisma.businessUnit.delete({
      where: { id },
    });
  }

  /**
   * Get business units for dropdown (minimal data)
   */
  async getBusinessUnitsForDropdown(entity?: string) {
    const where: any = { isActive: true };

    if (entity) {
      where.entity = entity;
    }

    return await prisma.businessUnit.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        entity: true,
      },
      orderBy: { code: "asc" },
    });
  }
}

export const businessUnitService = new BusinessUnitService();
