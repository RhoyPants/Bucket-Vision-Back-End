import { Router } from "express";
import { createModule, getModules, syncModules, updateModule } from "./module.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("settings_modules", "CREATE"), // 🔥 protect it
  createModule
);
router.post(
  "/sync",
  authenticate,
  authorize("settings_modules", "CREATE"),
  syncModules
);
router.get(
  "/",
  authenticate,
  // authorize("settings_modules", "READ"),
  getModules
);

router.patch(
  "/:moduleId",
  authenticate,
  authorize("settings_modules", "UPDATE"),
  updateModule
);

export default router;