import { Request, Response } from "express";
import { GeographicalService } from "./geographical.service";

export class GeographicalController {
  /**
   * 🔥 GET ALL REGIONS
   * GET /api/geographical/regions
   */
  static async getAllRegions(req: Request, res: Response) {
    try {
      const regions = await GeographicalService.getAllRegions();
      return res.status(200).json({
        success: true,
        data: regions,
        count: regions.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET REGION BY CODE
   * GET /api/geographical/regions/:regCode
   */
  static async getRegionByCode(req: Request, res: Response) {
    try {
      const { regCode } = req.params as { regCode: string };

      const region = await GeographicalService.getRegionByCode(regCode);
      if (!region) {
        return res.status(404).json({
          success: false,
          error: "Region not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: region,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET PROVINCES BY REGION
   * GET /api/geographical/regions/:regCode/provinces
   */
  static async getProvincesByRegion(req: Request, res: Response) {
    try {
      const { regCode } = req.params as { regCode: string };

      const provinces = await GeographicalService.getProvincesByRegion(regCode);
      return res.status(200).json({
        success: true,
        data: provinces,
        count: provinces.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET PROVINCE BY CODE
   * GET /api/geographical/provinces/:provCode
   */
  static async getProvinceByCode(req: Request, res: Response) {
    try {
      const { provCode } = req.params as { provCode: string };

      const province = await GeographicalService.getProvinceByCode(provCode);
      if (!province) {
        return res.status(404).json({
          success: false,
          error: "Province not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: province,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET CITIES BY PROVINCE
   * GET /api/geographical/provinces/:provCode/cities
   */
  static async getCitiesByProvince(req: Request, res: Response) {
    try {
      const { provCode } = req.params as { provCode: string };

      const cities = await GeographicalService.getCitiesByProvince(provCode);
      return res.status(200).json({
        success: true,
        data: cities,
        count: cities.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET CITY BY CODE
   * GET /api/geographical/cities/:cityCode
   */
  static async getCityByCode(req: Request, res: Response) {
    try {
      const { cityCode } = req.params as { cityCode: string };

      const city = await GeographicalService.getCityByCode(cityCode);
      if (!city) {
        return res.status(404).json({
          success: false,
          error: "City not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: city,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET BARANGAYS BY CITY
   * GET /api/geographical/cities/:cityCode/barangays
   */
  static async getBarangaysByCity(req: Request, res: Response) {
    try {
      const { cityCode } = req.params as { cityCode: string };

      const barangays = await GeographicalService.getBarangaysByCity(cityCode);
      return res.status(200).json({
        success: true,
        data: barangays,
        count: barangays.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET BARANGAY BY CODE
   * GET /api/geographical/barangays/:brgyCode
   */
  static async getBarangayByCode(req: Request, res: Response) {
    try {
      const { brgyCode } = req.params as { brgyCode: string };

      const barangay = await GeographicalService.getBarangayByCode(brgyCode);
      if (!barangay) {
        return res.status(404).json({
          success: false,
          error: "Barangay not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: barangay,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 SEARCH GEOGRAPHICAL DATA
   * GET /api/geographical/search?query=Manila&type=city
   * Types: region, province, city, barangay (optional for all)
   */
  static async search(req: Request, res: Response) {
    try {
      const { query, type } = req.query;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: "query parameter is required",
        });
      }

      const results = await GeographicalService.search(
        query as string,
        type as "region" | "province" | "city" | "barangay" | undefined
      );

      return res.status(200).json({
        success: true,
        data: results,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 🔥 GET COMPLETE HIERARCHY
   * GET /api/geographical/hierarchy/:regCode
   * Returns entire region with all provinces, cities, and barangays
   */
  static async getCompleteHierarchy(req: Request, res: Response) {
    try {
      const { regCode } = req.params as { regCode: string };

      const hierarchy = await GeographicalService.getCompleteHierarchy(regCode);
      if (!hierarchy) {
        return res.status(404).json({
          success: false,
          error: "Region not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: hierarchy,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}
