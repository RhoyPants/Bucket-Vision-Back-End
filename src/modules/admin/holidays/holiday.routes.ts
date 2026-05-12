import { Router } from "express";
import { HolidayController } from "./holiday.controller";
import { authorize } from "../../../middleware/rbac.middleware";

const router = Router();

/**
 * 🔥 HOLIDAY MANAGEMENT ROUTES (SUPER ADMIN ONLY)
 * All endpoints require ADMIN module authorization
 */

/**
 * GET /admin/holidays
 * List all global holidays
 */
router.get("/", authorize("ADMIN", "READ"), HolidayController.listHolidays);

/**
 * GET /admin/holidays/range
 * Get holidays in a specific date range (for calculations)
 */
router.get("/range", authorize("ADMIN", "READ"), HolidayController.getHolidaysInRange);

/**
 * GET /admin/holidays/:id
 * Get single holiday details
 */
router.get("/:id", authorize("ADMIN", "READ"), HolidayController.getHoliday);

/**
 * POST /admin/holidays
 * Create a new global holiday
 * Body: { date: ISO date string, name: string, description?: string }
 */
router.post("/", authorize("ADMIN", "CREATE"), HolidayController.createHoliday);

/**
 * PUT /admin/holidays/:id
 * Update holiday details
 * Body: { date?: ISO date string, name?: string, description?: string }
 */
router.put("/:id", authorize("ADMIN", "UPDATE"), HolidayController.updateHoliday);

/**
 * DELETE /admin/holidays/:id
 * Delete a global holiday
 */
router.delete("/:id", authorize("ADMIN", "DELETE"), HolidayController.deleteHoliday);

export default router;
