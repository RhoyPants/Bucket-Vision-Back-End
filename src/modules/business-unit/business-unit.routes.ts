import { Router, Request, Response } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { businessUnitController } from "./business-unit.controller";

const router = Router();

/**
 * ✅ BUSINESS UNIT ROUTES
 * Base path: /api/business-units
 * NOTE: Static routes MUST come before parameter routes
 */

// 📋 GET DROPDOWN (no auth - frontend dropdowns) - STATIC ROUTE FIRST
// GET /dropdown/:entity - with entity filter
router.get(
  "/dropdown/:entity",
  authenticate,
  (req: Request, res: Response) => businessUnitController.getBusinessUnitsForDropdown(req, res)
);

// GET /dropdown - all business units for dropdown
router.get(
  "/dropdown",
  authenticate,
  (req: Request, res: Response) => businessUnitController.getBusinessUnitsForDropdown(req, res)
);

// 📋 GET ALL Business Units
router.get(
  "/",
  authenticate,
  // authorize("settings_business_units", "READ"),
  (req: Request, res: Response) => businessUnitController.getAllBusinessUnits(req, res)
);

// 📋 GET by Code - STATIC PREFIX BEFORE /:id
router.get(
  "/code/:code",
  authenticate,
  // authorize("settings_business_units", "READ"),
  (req: Request, res: Response) => businessUnitController.getBusinessUnitByCode(req, res)
);

// 📋 GET by ID - GENERIC PARAMETER ROUTE LAST
router.get(
  "/:id",
  authenticate,
  // authorize("settings_business_units", "READ"),
  (req: Request, res: Response) => businessUnitController.getBusinessUnitById(req, res)
);

// ➕ CREATE Business Unit
router.post(
  "/",
  authenticate,
  authorize("settings_business_units", "CREATE"),
  (req: Request, res: Response) => businessUnitController.createBusinessUnit(req, res)
);

// ✏️ UPDATE Business Unit (combined fields including assigned BU users)
router.put(
  "/:id",
  authenticate,
  authorize("settings_business_units", "UPDATE"),
  (req: Request, res: Response) => businessUnitController.updateBusinessUnit(req, res)
);

// 🗑️ DELETE Business Unit
router.delete(
  "/:id",
  authenticate,
  authorize("settings_business_units", "DELETE"),
  (req: Request, res: Response) => businessUnitController.deleteBusinessUnit(req, res)
);

export default router;
