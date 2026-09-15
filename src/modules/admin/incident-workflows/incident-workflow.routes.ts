import { Router } from "express";
import { authenticate } from "../../../middleware/auth.middleware";
import { authorize } from "../../../middleware/rbac.middleware";
import { incidentWorkflowController } from "./incident-workflow.controller";

const router = Router();
router.use(authenticate);
router.get("/", authorize("settings_incident_management", "READ"), incidentWorkflowController.list);
router.get("/:id", authorize("settings_incident_management", "READ"), incidentWorkflowController.getById);
router.post("/", authorize("settings_incident_management", "CREATE"), incidentWorkflowController.create);
router.patch("/:id", authorize("settings_incident_management", "UPDATE"), incidentWorkflowController.update);
router.delete("/:id", authorize("settings_incident_management", "DELETE"), incidentWorkflowController.delete);

export default router;
