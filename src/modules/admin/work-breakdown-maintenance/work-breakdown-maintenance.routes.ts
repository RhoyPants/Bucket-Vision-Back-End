import { Router } from "express";
import { authenticate } from "../../../middleware/auth.middleware";
import { authorize } from "../../../middleware/rbac.middleware";
import { WorkBreakdownMaintenanceController as Controller } from "./work-breakdown-maintenance.controller";

const router = Router();

router.get("/hierarchy", authenticate, Controller.hierarchy);
router.get("/tables", authenticate, Controller.listTables);
router.get("/scopes", authenticate, Controller.listScopes);
router.get("/tasks", authenticate, Controller.listTasks);
router.get("/subtasks", authenticate, Controller.listSubtasks);

router.post("/scopes", authenticate, authorize("projects", "UPDATE"), Controller.createScope);
router.post("/tables", authenticate, authorize("projects", "UPDATE"), Controller.createTable);
router.post("/tasks", authenticate, authorize("projects", "UPDATE"), Controller.createTask);
router.post("/subtasks", authenticate, authorize("projects", "UPDATE"), Controller.createSubtask);
router.patch("/bulk-status", authenticate, authorize("projects", "UPDATE"), Controller.bulkStatus);
router.patch("/tables/:id", authenticate, authorize("projects", "UPDATE"), Controller.updateTable);
router.patch("/scopes/reorder", authenticate, authorize("projects", "UPDATE"), Controller.reorderScopes);
router.patch("/scopes/:scopeId/tasks/reorder", authenticate, authorize("projects", "UPDATE"), Controller.reorderTasks);
router.patch("/tasks/:taskId/subtasks/reorder", authenticate, authorize("projects", "UPDATE"), Controller.reorderSubtasks);
router.patch("/scopes/:id", authenticate, authorize("projects", "UPDATE"), Controller.updateScope);
router.patch("/tasks/:id", authenticate, authorize("projects", "UPDATE"), Controller.updateTask);
router.patch("/subtasks/:id", authenticate, authorize("projects", "UPDATE"), Controller.updateSubtask);

export default router;
