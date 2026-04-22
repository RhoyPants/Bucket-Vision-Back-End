import { Router } from "express";
import { TaskController } from "./task.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// 🔥 CHANGE THIS
router.get(
  "/category/:categoryId",
  authenticate,
  authorize("TASKS", "READ"),
  TaskController.getByCategory
);

// GET SINGLE TASK (KANBAN VIEW)
router.get(
  "/:id",
//   authenticate,
//   authorize("TASKS", "READ"),
  TaskController.getById
);

// CREATE
router.post(
  "/",
  authenticate,
  authorize("TASKS", "CREATE"),
  TaskController.create
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("TASKS", "UPDATE"),
  TaskController.update
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("TASKS", "DELETE"),
  TaskController.delete
);

export default router;