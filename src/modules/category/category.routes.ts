import { Router } from "express";
import { CategoryController } from "./category.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// GET BY PROJECT
router.get(
  "/project/:projectId",
  authenticate,
  authorize("PROJECTS", "READ"),
  CategoryController.getByProject
);

// GET SINGLE CATEGORY
router.get(
  "/:id",
  authenticate,
  authorize("PROJECTS", "READ"),
  CategoryController.getById
);

// CREATE
router.post(
  "/",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  CategoryController.create
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  CategoryController.update
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("PROJECTS", "DELETE"),
  CategoryController.delete
);

export default router;