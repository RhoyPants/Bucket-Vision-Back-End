import { Router, Request, Response } from "express";
import { authenticate } from "../../../middleware/auth.middleware";
import { authorize } from "../../../middleware/rbac.middleware";
import { workScheduleController } from "./work-schedule.controller";

const router = Router();

// ✅ STATIC ROUTES FIRST

// Create work schedule
router.post(
  "/",
  authenticate,
  authorize("ADMIN", "CREATE"),
  (req: Request, res: Response) => workScheduleController.createWorkSchedule(req, res)
);

// Get all work schedules
router.get(
  "/",
  authenticate,
  (req: Request, res: Response) => workScheduleController.getAllWorkSchedules(req, res)
);

// Get default work schedule
router.get(
  "/default",
  authenticate,
  (req: Request, res: Response) => workScheduleController.getDefaultWorkSchedule(req, res)
);

// Add holiday to schedule
router.post(
  "/:scheduleId/holidays",
  authenticate,
  authorize("ADMIN", "UPDATE"),
  (req: Request, res: Response) => workScheduleController.addHolidayToSchedule(req, res)
);

// Remove holiday from schedule
router.delete(
  "/holidays/:holidayId",
  authenticate,
  authorize("ADMIN", "DELETE"),
  (req: Request, res: Response) => workScheduleController.removeHolidayFromSchedule(req, res)
);

// Set as default work schedule
router.patch(
  "/:scheduleId/set-default",
  authenticate,
  authorize("ADMIN", "UPDATE"),
  (req: Request, res: Response) => workScheduleController.setDefaultWorkSchedule(req, res)
);

// ✅ DYNAMIC ROUTES LAST

// Get work schedule by ID
router.get(
  "/:scheduleId",
  authenticate,
  (req: Request, res: Response) => workScheduleController.getWorkScheduleById(req, res)
);

// Update work schedule
router.patch(
  "/:scheduleId",
  authenticate,
  authorize("ADMIN", "UPDATE"),
  (req: Request, res: Response) => workScheduleController.updateWorkSchedule(req, res)
);

// Delete work schedule
router.delete(
  "/:scheduleId",
  authenticate,
  authorize("ADMIN", "DELETE"),
  (req: Request, res: Response) => workScheduleController.deleteWorkSchedule(req, res)
);

export default router;
