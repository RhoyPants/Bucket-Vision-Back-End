import { Request, Response } from "express";
import { businessUnitService } from "./business-unit.service";

export class BusinessUnitController {
  /**
   * GET /api/business-units
   * Get all business units with optional filters
   */
  async getAllBusinessUnits(req: Request, res: Response): Promise<void> {
    try {
      const { entity, isActive } = req.query;

      const filters: any = {};
      if (entity) filters.entity = entity as string;
      if (isActive !== undefined) filters.isActive = isActive === "true";

      const businessUnits = await businessUnitService.getAllBusinessUnits(filters);

      res.status(200).json({
        success: true,
        data: businessUnits,
        count: businessUnits.length,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch business units",
      });
    }
  }

  /**
   * GET /api/business-units/dropdown/:entity
   * Get business units for dropdown selection
   */
  async getBusinessUnitsForDropdown(req: Request, res: Response): Promise<void> {
    try {
      const { entity } = req.params as { entity?: string };
      const userId = (req as any).user.id;

      const businessUnits = await businessUnitService.getAccessibleBusinessUnitsForDropdown(
        userId,
        entity && entity !== "all" ? entity : undefined
      );

      res.status(200).json({
        data: businessUnits,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch business units",
      });
    }
  }

  /**
   * GET /api/business-units/:id
   * Get business unit by ID
   */
  async getBusinessUnitById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params as { id: string };

      const businessUnit = await businessUnitService.getBusinessUnitById(id);

      if (!businessUnit) {
        res.status(404).json({
          success: false,
          error: "Business Unit not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: businessUnit,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch business unit",
      });
    }
  }

  /**
   * GET /api/business-units/code/:code
   * Get business unit by code
   */
  async getBusinessUnitByCode(req: Request, res: Response): Promise<void> {
    try {
      const { code } = req.params as { code: string };

      const businessUnit = await businessUnitService.getBusinessUnitByCode(code);

      if (!businessUnit) {
        res.status(404).json({
          success: false,
          error: `Business Unit with code '${code}' not found`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: businessUnit,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch business unit",
      });
    }
  }

  /**
   * POST /api/business-units
   * Create new business unit
   */
  async createBusinessUnit(req: Request, res: Response): Promise<void> {
    try {
      const { code, name, entity, buHeadUserId, assistantHeadUserId } = req.body;

      if (!code || !name || !entity) {
        res.status(400).json({
          success: false,
          error: "code, name, and entity are required",
        });
        return;
      }

      const businessUnit = await businessUnitService.createBusinessUnit({
        code,
        name,
        entity,
        buHeadUserId,
        assistantHeadUserId,
      });

      res.status(201).json({
        success: true,
        data: businessUnit,
        message: "Business Unit created successfully",
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to create business unit",
      });
    }
  }

  /**
   * PUT /api/business-units/:id
   * Update business unit
   */
  async updateBusinessUnit(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const { name, entity, buHeadUserId, assistantHeadUserId, isActive } = req.body;

      const businessUnit = await businessUnitService.updateBusinessUnit(id, {
        name,
        entity,
        buHeadUserId,
        assistantHeadUserId,
        isActive,
      });

      res.status(200).json({
        success: true,
        data: businessUnit,
        message: "Business Unit updated successfully",
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to update business unit",
      });
    }
  }

  /**
   * PUT /api/business-units/:id/bu-head
   * Assign BU Head
   */
  async assignBUHead(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const { buHeadUserId } = req.body;

      const businessUnit = await businessUnitService.assignBUHead(id, buHeadUserId || null);

      res.status(200).json({
        success: true,
        data: businessUnit,
        message: "BU Head assigned successfully",
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to assign BU Head",
      });
    }
  }

  /**
   * PUT /api/business-units/:id/assistant-bu-head
   * Assign Assistant BU Head
   */
  async assignAssistantBUHead(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const { assistantHeadUserId } = req.body;

      const businessUnit = await businessUnitService.assignAssistantBUHead(
        id,
        assistantHeadUserId || null
      );

      res.status(200).json({
        success: true,
        data: businessUnit,
        message: "Assistant BU Head assigned successfully",
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to assign Assistant BU Head",
      });
    }
  }

  /**
   * DELETE /api/business-units/:id
   * Delete business unit
   */
  async deleteBusinessUnit(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params as { id: string };

      const businessUnit = await businessUnitService.deleteBusinessUnit(id);

      res.status(200).json({
        success: true,
        data: businessUnit,
        message: "Business Unit deleted successfully",
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to delete business unit",
      });
    }
  }
}

export const businessUnitController = new BusinessUnitController();
