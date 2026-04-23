import { Router } from "express";
import { SubtaskController } from "./subtask.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// GET (Kanban View)
router.get(
  "/task/:taskId",
  authenticate,
  authorize("SUBTASKS", "READ"),
  SubtaskController.getByTask,
);

// CREATE
router.post(
  "/",
  authenticate,
  authorize("SUBTASKS", "CREATE"),
  SubtaskController.create,
);

// UPDATE
router.put(
  "/:id",
  //   authenticate,
  //   authorize("SUBTASKS", "UPDATE"),
  SubtaskController.update,
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("SUBTASKS", "DELETE"),
  SubtaskController.delete,
);

// MOVE (DRAG & DROP) 🔥 ADD THIS
router.patch(
  "/:subtaskId/move",
  authenticate,
  authorize("SUBTASKS", "UPDATE"),
  SubtaskController.move,
);

// CHECKLIST TOGGLE
router.patch(
  "/checklists/:checklistId/toggle",
  authenticate,
  authorize("SUBTASKS", "UPDATE"),
  SubtaskController.toggleChecklist,
);

// CREATE CHECKLIST
router.post(
  "/checklists",
  authenticate,
  authorize("SUBTASKS", "UPDATE"),
  SubtaskController.addChecklist,
);

// DELETE CHECKLIST
router.delete(
  "/checklists/:checklistId",
  authenticate,
  authorize("SUBTASKS", "UPDATE"),
  SubtaskController.deleteChecklist,
);

// ✅ GET SINGLE
router.get(
  "/:id",
//   authenticate,
//   authorize("SUBTASKS", "READ"),
  SubtaskController.getById,
);

// ✅ GET LIST
router.get(
  "/task/:taskId",
//   authenticate,
//   authorize("SUBTASKS", "READ"),
  SubtaskController.getByTask,
);

router.post(
  "/:id/assign",
  authenticate,
  authorize("SUBTASKS", "UPDATE"),
  SubtaskController.assign
);

export default router;
