import { Router } from "express";
import { createModule, getModules } from "./module.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("MODULES", "CREATE"), // 🔥 protect it
  createModule
);
router.get(
  "/",
  authenticate,
  authorize("MODULES", "READ"),
  getModules
);

export default router;