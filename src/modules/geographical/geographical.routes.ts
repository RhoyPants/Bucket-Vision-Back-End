import { Router } from "express";
import { GeographicalController } from "./geographical.controller";

const router = Router();

/**
 * 🔥 GEOGRAPHICAL DATA ROUTES
 * Public endpoints (no authentication required for read operations)
 */

/**
 * GET /api/geographical/regions
 * Get all Philippines regions
 */
router.get("/regions", GeographicalController.getAllRegions);

/**
 * GET /api/geographical/regions/:regCode
 * Get single region with all its provinces
 * Example: /api/geographical/regions/13
 */
router.get("/regions/:regCode", GeographicalController.getRegionByCode);

/**
 * GET /api/geographical/regions/:regCode/provinces
 * Get all provinces in a region
 * Example: /api/geographical/regions/13/provinces
 */
router.get("/regions/:regCode/provinces", GeographicalController.getProvincesByRegion);

/**
 * GET /api/geographical/provinces/:provCode
 * Get single province with all its cities
 * Example: /api/geographical/provinces/13000
 */
router.get("/provinces/:provCode", GeographicalController.getProvinceByCode);

/**
 * GET /api/geographical/provinces/:provCode/cities
 * Get all cities in a province
 * Example: /api/geographical/provinces/13000/cities
 */
router.get("/provinces/:provCode/cities", GeographicalController.getCitiesByProvince);

/**
 * GET /api/geographical/cities/:cityCode
 * Get single city with all its barangays
 * Example: /api/geographical/cities/1380100
 */
router.get("/cities/:cityCode", GeographicalController.getCityByCode);

/**
 * GET /api/geographical/cities/:cityCode/barangays
 * Get all barangays in a city
 * Example: /api/geographical/cities/1380100/barangays
 */
router.get("/cities/:cityCode/barangays", GeographicalController.getBarangaysByCity);

/**
 * GET /api/geographical/barangays/:brgyCode
 * Get single barangay with its complete hierarchy
 * Example: /api/geographical/barangays/1380101
 */
router.get("/barangays/:brgyCode", GeographicalController.getBarangayByCode);

/**
 * GET /api/geographical/search
 * Search geographical data by name
 * Query params:
 *   - query (required): search term
 *   - type (optional): 'region', 'province', 'city', or 'barangay'
 * Example: /api/geographical/search?query=Manila&type=city
 */
router.get("/search", GeographicalController.search);

/**
 * GET /api/geographical/hierarchy/:regCode
 * Get complete hierarchy for a region (all provinces, cities, barangays)
 * Example: /api/geographical/hierarchy/13
 * ⚠️ WARNING: Returns large dataset - may take time for large regions
 */
router.get("/hierarchy/:regCode", GeographicalController.getCompleteHierarchy);

export default router;
