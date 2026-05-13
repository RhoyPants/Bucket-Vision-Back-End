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
  (req: Request, res: Response) => businessUnitController.getBusinessUnitsForDropdown(req, res)
);

// GET /dropdown - all business units for dropdown
router.get(
  "/dropdown",
  (req: Request, res: Response) => businessUnitController.getBusinessUnitsForDropdown(req, res)
);

// 📋 GET ALL Business Units
router.get(
  "/",
  authenticate,
  authorize("BUSINESS_UNITS", "READ"),
  (req: Request, res: Response) => businessUnitController.getAllBusinessUnits(req, res)
);

// 📋 GET by Code - STATIC PREFIX BEFORE /:id
router.get(
  "/code/:code",
  authenticate,
  authorize("BUSINESS_UNITS", "READ"),
  (req: Request, res: Response) => businessUnitController.getBusinessUnitByCode(req, res)
);

// 📋 GET by ID - GENERIC PARAMETER ROUTE LAST
router.get(
  "/:id",
  authenticate,
  authorize("BUSINESS_UNITS", "READ"),
  (req: Request, res: Response) => businessUnitController.getBusinessUnitById(req, res)
);

// ➕ CREATE Business Unit
router.post(
  "/",
  authenticate,
  authorize("BUSINESS_UNITS", "CREATE"),
  (req: Request, res: Response) => businessUnitController.createBusinessUnit(req, res)
);

// ✏️ UPDATE - STATIC ROUTES FIRST
router.put(
  "/:id/bu-head",
  authenticate,
  authorize("BUSINESS_UNITS", "UPDATE"),
  (req: Request, res: Response) => businessUnitController.assignBUHead(req, res)
);

router.put(
  "/:id/assistant-bu-head",
  authenticate,
  authorize("BUSINESS_UNITS", "UPDATE"),
  (req: Request, res: Response) => businessUnitController.assignAssistantBUHead(req, res)
);

// ✏️ UPDATE Business Unit - GENERIC PARAM ROUTE LAST
router.put(
  "/:id",
  authenticate,
  authorize("BUSINESS_UNITS", "UPDATE"),
  (req: Request, res: Response) => businessUnitController.updateBusinessUnit(req, res)
);

// 🗑️ DELETE Business Unit
router.delete(
  "/:id",
  authenticate,
  authorize("BUSINESS_UNITS", "DELETE"),
  (req: Request, res: Response) => businessUnitController.deleteBusinessUnit(req, res)
);

export default router;
