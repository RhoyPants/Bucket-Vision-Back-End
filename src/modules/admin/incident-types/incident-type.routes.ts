import { Router } from "express";
import { authenticate } from "../../../middleware/auth.middleware";
import { authorize } from "../../../middleware/rbac.middleware";
import { incidentTypeController } from "./incident-type.controller";

const router = Router();
router.use(authenticate);
router.get("/", authorize("settings_incident_types", "READ"), incidentTypeController.list);
router.get("/:id", authorize("settings_incident_types", "READ"), incidentTypeController.getById);
router.post("/", authorize("settings_incident_types", "CREATE"), incidentTypeController.create);
router.patch("/:id", authorize("settings_incident_types", "UPDATE"), incidentTypeController.update);
router.delete("/:id", authorize("settings_incident_types", "DELETE"), incidentTypeController.delete);

export const incidentTypeLookupRouter = Router();
incidentTypeLookupRouter.get("/", authenticate, authorize("incident_reports", "CREATE"), incidentTypeController.lookup);

export default router;
