import { Router } from "express";
import { HolidayController } from "./holiday.controller";
import { authenticate } from "../../../middleware/auth.middleware";
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
router.get(
  "/",
  authenticate,
  authorize("settings_holiday_maintenance", "READ"),
  HolidayController.listHolidays,
);

/**
 * GET /admin/holidays/range
 * Get holidays in a specific date range (for calculations)
 */
router.get(
  "/range",
  authenticate,
  authorize("settings_holiday_maintenance", "READ"),
  HolidayController.getHolidaysInRange,
);

/**
 * GET /admin/holidays/:id
 * Get single holiday details
 */
router.get(
  "/:id",
  authenticate,
  authorize("settings_holiday_maintenance", "READ"),
  HolidayController.getHoliday,
);

/**
 * POST /admin/holidays
 * Create a new global holiday
 * Body: { date: ISO date string, name: string, description?: string }
 */
router.post(
  "/",
  authenticate,
  authorize("settings_holiday_maintenance", "CREATE"),
  HolidayController.createHoliday,
);

/**
 * PUT /admin/holidays/:id
 * Update holiday details
 * Body: { date?: ISO date string, name?: string, description?: string }
 */
router.put(
  "/:id",
  authenticate,
  authorize("settings_holiday_maintenance", "UPDATE"),
  HolidayController.updateHoliday,
);

/**
 * DELETE /admin/holidays/:id
 * Delete a global holiday
 */
router.delete(
  "/:id",
  authenticate,
  authorize("settings_holiday_maintenance", "DELETE"),
  HolidayController.deleteHoliday,
);

export default router;
