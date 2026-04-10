import { Router } from "express";
import { ProjectController } from "./project.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// GET ALL
router.get(
  "/",
  authenticate,
  authorize("PROJECTS", "READ"),
  ProjectController.getAll
);

// GET ONE
router.get(
  "/:id",
  authenticate,
  authorize("PROJECTS", "READ"),
  ProjectController.getById
);

// CREATE
router.post(
  "/",
  authenticate,
  authorize("PROJECTS", "CREATE"),
  ProjectController.create
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  ProjectController.update
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("PROJECTS", "DELETE"),
  ProjectController.delete
);

export default router;