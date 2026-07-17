import prisma from "../../config/prisma";

export class BusinessUnitService {
  private businessUnitWithAssignedUsersSelect = {
    id: true,
    code: true,
    name: true,
    entity: true,
    buHead: true,
    buHeadUserId: true,
    assistantHead: true,
    assistantHeadUserId: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    buHeadUser: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
    assistantHeadUser: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
  };

  private async resolveAssignedUser(userId: string, fieldName: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
      },
    });

    if (!user) {
      throw new Error(`${fieldName} user not found`);
    }

    return user;
  }

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
      select: this.businessUnitWithAssignedUsersSelect,
      orderBy: { code: "asc" },
    });
  }

  /**
   * Get business unit by code
   */
  async getBusinessUnitByCode(code: string) {
    return await prisma.businessUnit.findUnique({
      where: { code: code.toUpperCase() },
      select: this.businessUnitWithAssignedUsersSelect,
    });
  }

  /**
   * Get business unit by ID
   */
  async getBusinessUnitById(id: string) {
    return await prisma.businessUnit.findUnique({
      where: { id },
      select: this.businessUnitWithAssignedUsersSelect,
    });
  }

  /**
   * Create new business unit
   */
  async createBusinessUnit(data: {
    code: string;
    name: string;
    entity: string;
    buHeadUserId?: string | null;
    assistantHeadUserId?: string | null;
  }) {
    const code = data.code.toUpperCase().trim();
    const name = data.name.trim();
    const entity = data.entity.trim();

    const buHeadUser = data.buHeadUserId
      ? await this.resolveAssignedUser(data.buHeadUserId, "BU Head")
      : null;
    const assistantHeadUser = data.assistantHeadUserId
      ? await this.resolveAssignedUser(data.assistantHeadUserId, "Assistant BU Head")
      : null;

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
        buHead: buHeadUser?.name || null,
        buHeadUserId: buHeadUser?.id || null,
        assistantHead: assistantHeadUser?.name || null,
        assistantHeadUserId: assistantHeadUser?.id || null,
        isActive: true,
      },
      select: this.businessUnitWithAssignedUsersSelect,
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
      buHeadUserId?: string | null;
      assistantHeadUserId?: string | null;
      isActive?: boolean;
    }
  ) {
    const businessUnit = await prisma.businessUnit.findUnique({
      where: { id },
    });

    if (!businessUnit) {
      throw new Error("Business Unit not found");
    }

    const updateData: any = {
      ...(data.name && { name: data.name.trim() }),
      ...(data.entity && { entity: data.entity.trim() }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    };

    if (data.buHeadUserId !== undefined) {
      if (data.buHeadUserId) {
        const buHeadUser = await this.resolveAssignedUser(data.buHeadUserId, "BU Head");
        updateData.buHeadUserId = buHeadUser.id;
        updateData.buHead = buHeadUser.name;
      } else {
        updateData.buHeadUserId = null;
        updateData.buHead = null;
      }
    }

    if (data.assistantHeadUserId !== undefined) {
      if (data.assistantHeadUserId) {
        const assistantHeadUser = await this.resolveAssignedUser(
          data.assistantHeadUserId,
          "Assistant BU Head"
        );
        updateData.assistantHeadUserId = assistantHeadUser.id;
        updateData.assistantHead = assistantHeadUser.name;
      } else {
        updateData.assistantHeadUserId = null;
        updateData.assistantHead = null;
      }
    }

    return await prisma.businessUnit.update({
      where: { id },
      data: updateData,
      select: this.businessUnitWithAssignedUsersSelect,
    });
  }

  /**
   * Assign BU Head to business unit
   */
  async assignBUHead(id: string, buHeadUserId: string | null) {
    const businessUnit = await prisma.businessUnit.findUnique({
      where: { id },
    });

    if (!businessUnit) {
      throw new Error("Business Unit not found");
    }

    const buHeadUser = buHeadUserId
      ? await this.resolveAssignedUser(buHeadUserId, "BU Head")
      : null;

    return await prisma.businessUnit.update({
      where: { id },
      data: {
        buHeadUserId: buHeadUser?.id || null,
        buHead: buHeadUser?.name || null,
      },
      select: this.businessUnitWithAssignedUsersSelect,
    });
  }

  /**
   * Assign Assistant BU Head to business unit
   */
  async assignAssistantBUHead(id: string, assistantHeadUserId: string | null) {
    const businessUnit = await prisma.businessUnit.findUnique({
      where: { id },
    });

    if (!businessUnit) {
      throw new Error("Business Unit not found");
    }

    const assistantHeadUser = assistantHeadUserId
      ? await this.resolveAssignedUser(assistantHeadUserId, "Assistant BU Head")
      : null;

    return await prisma.businessUnit.update({
      where: { id },
      data: {
        assistantHeadUserId: assistantHeadUser?.id || null,
        assistantHead: assistantHeadUser?.name || null,
      },
      select: this.businessUnitWithAssignedUsersSelect,
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
