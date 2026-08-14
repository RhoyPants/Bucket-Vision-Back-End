import { Router } from "express";
import { TaskController } from "./task.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

router.get(
  "/scope/:scopeId/dropdown",
  authenticate,
  TaskController.getDropdownByScope,
);

// 🔥 GET TASKS BY SCOPE
router.get(
  "/scope/:scopeId",
  authenticate,
  // authorize("projects", "READ"),
  TaskController.getByScope
);

// GET SINGLE TASK (KANBAN VIEW)
router.get(
  "/:id",
//   authenticate,
//   authorize("projects", "READ"),
  TaskController.getById
);

// CREATE
router.post(
  "/",
  authenticate,
  authorize("projects", "CREATE"),
  TaskController.create
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("projects", "UPDATE"),
  TaskController.update
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("projects", "DELETE"),
  TaskController.delete
);

export default router;
