import { Router } from "express";
import { createModule } from "./module.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("MODULES", "CREATE"), // 🔥 protect it
  createModule
);

export default router;