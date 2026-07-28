import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { dashboardController } from "./dashboard.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("dashboard", "READ"),
  dashboardController.get
);

export default router;

