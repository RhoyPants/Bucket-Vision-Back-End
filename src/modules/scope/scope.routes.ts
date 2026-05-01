import { Router } from "express";
import { ScopeController } from "./scope.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// GET BY PROJECT
router.get(
  "/project/:projectId",
  authenticate,
  authorize("PROJECTS", "READ"),
  ScopeController.getByProject
);

// GET SINGLE SCOPE
router.get(
  "/:id",
  authenticate,
  authorize("PROJECTS", "READ"),
  ScopeController.getById
);

// CREATE
router.post(
  "/",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  ScopeController.create
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  ScopeController.update
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("PROJECTS", "DELETE"),
  ScopeController.delete
);

export default router;
