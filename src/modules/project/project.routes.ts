import { Router } from "express";
import { ProjectController, assignProjectMember, getProjectMembers, removeProjectMember, getProjectEngagedUsers, updateProjectMemberRole } from "./project.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

// GET ALL
router.get(
  "/",
  authenticate,
  authorize("PROJECTS", "READ"),
  ProjectController.getAll,
);

// GET ONE
router.get(
  "/:id",
  authenticate,
  authorize("PROJECTS", "READ"),
  ProjectController.getById,
);

// CREATE
router.post(
  "/",
  authenticate,
  authorize("PROJECTS", "CREATE"),
  ProjectController.create,
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  ProjectController.update,
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("PROJECTS", "DELETE"),
  ProjectController.delete,
);

//FULL PROJECT TREE
router.get(
  "/:id/full",
  authenticate,
  authorize("PROJECTS", "READ"),
  ProjectController.getFull,
);

// FULL PROJECT FOR APPROVAL VIEW (approvers can see full details)
router.get(
  "/:id/view-for-approval",
  authenticate,
  ProjectController.getFullForApproval,
);

// PROJECT DASHBOARD
router.get(
  "/:id/dashboard",
  authenticate,
  authorize("PROJECTS", "READ"),
  ProjectController.getDashboard,
);

// 🔥 PROJECT MEMBER MANAGEMENT

// Get all project members (grouped by role)
router.get(
  "/:projectId/members",
  authenticate,
  authorize("PROJECTS", "READ"),
  getProjectMembers
);

// Get all engaged users in project (for subtask assignment dropdown)
router.get(
  "/:projectId/engaged-users",
  authenticate,
  authorize("PROJECTS", "READ"),
  getProjectEngagedUsers
);

// Assign user to project with role (SUB_OWNER or MEMBER)
router.post(
  "/:projectId/assign-member",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  assignProjectMember
);

// 🔥 UPDATE member role (SUB_OWNER ↔ MEMBER) with draft auto-save
router.patch(
  "/:projectId/members/:userId/role",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  updateProjectMemberRole
);

// Remove user from project
router.post(
  "/:projectId/remove-member",
  authenticate,
  authorize("PROJECTS", "UPDATE"),
  removeProjectMember
);

export default router;
