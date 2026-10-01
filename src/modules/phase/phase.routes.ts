import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { PhaseController } from "./phase.controller";

const router = Router();

router.get("/project/:projectId", authenticate, PhaseController.getByProject);
router.post("/", authenticate, authorize("projects", "UPDATE"), PhaseController.create);
router.put("/:id", authenticate, authorize("projects", "UPDATE"), PhaseController.update);
router.delete("/:id", authenticate, authorize("projects", "DELETE"), PhaseController.delete);

export default router;
