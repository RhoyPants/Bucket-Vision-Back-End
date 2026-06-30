import { Router } from "express";
import { SubtaskController, getMyBoardItem, getMyTaskBoard } from "./subtask.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// 🔥 MY TASK BOARD (with optional filters)
router.get(
  "/board/my",
  authenticate,
  authorize("SUBTASKS", "READ"),
  getMyTaskBoard
);

router.get(
  "/board/item/:itemId",
  authenticate,
  authorize("SUBTASKS", "READ"),
  getMyBoardItem
);

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

// MOVE CHECKLIST (DRAG & DROP)
router.patch(
  "/checklists/:checklistId/move",
  authenticate,
  authorize("SUBTASKS", "UPDATE"),
  SubtaskController.moveChecklist,
);

// EDIT CHECKLIST
router.patch(
  "/checklists/:checklistId",
  authenticate,
  authorize("SUBTASKS", "UPDATE"),
  SubtaskController.editChecklist,
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

export default router;
