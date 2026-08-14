import { Router } from "express";
import { ScopeController } from "./scope.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

router.get(
  "/project/:projectId/dropdown",
  authenticate,
  ScopeController.getDropdownByProject,
);

// GET BY PROJECT
router.get(
  "/project/:projectId",
  authenticate,
  // authorize("projects", "READ"),
  ScopeController.getByProject
);

// GET SINGLE SCOPE
router.get(
  "/:id",
  authenticate,
  // authorize("projects", "READ"),
  ScopeController.getById
);

// CREATE
router.post(
  "/",
  authenticate,
  authorize("projects", "UPDATE"),
  ScopeController.create
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("projects", "UPDATE"),
  ScopeController.update
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("projects", "DELETE"),
  ScopeController.delete
);

export default router;
