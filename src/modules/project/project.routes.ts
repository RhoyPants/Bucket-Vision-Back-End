import { Router } from "express";
import { ProjectController, assignProjectMember, getProjectMembers, getProjectTeamOrgChart, removeProjectMember, getProjectEngagedUsers, updateProjectMemberRole, uploadProjectAttachment, getProjectAttachments, deleteProjectAttachment, streamProjectAttachment } from "./project.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import upload from "../../middleware/upload.middleware";

const router = Router();

// GET ALL
router.get(
  "/",
  authenticate,
  // authorize("projects", "READ"),
  ProjectController.getAll,
);

// GET MY APPROVAL QUEUE
router.get(
  "/my-approvals",
  authenticate,
  // authorize("projects", "READ"),
  ProjectController.getMyApprovals,
);

// GET MY REQUESTS (owned, non-draft)
router.get(
  "/my-requests",
  authenticate,
  // authorize("projects", "READ"),
  ProjectController.getMyRequests,
);

// GET MY DRAFTS (owned drafts)
router.get(
  "/my-drafts",
  authenticate,
  // authorize("projects", "READ"),
  ProjectController.getMyDrafts,
);

// GET ACTIVE PROJECTS FOR DROPDOWN
router.get(
  "/active/dropdown",
  authenticate,
  // authorize("projects", "READ"),
  ProjectController.getActiveDropdown,
);

// PAGINATED, LIGHTWEIGHT PROJECT DIRECTORY
router.get(
  "/directory",
  authenticate,
  // authorize("projects", "READ"),
  ProjectController.getDirectory,
);

// GET BY STATUS
router.get(
  "/status/:status",
  authenticate,
  // authorize("projects", "READ"),
  ProjectController.getByStatus,
);

// GET ONE
router.get(
  "/:id",
  authenticate,
  // authorize("projects", "READ"),
  ProjectController.getById,
);

// CREATE
router.post(
  "/",
  authenticate,
  authorize("projects", "CREATE"),
  upload.fields([{ name: "attachments", maxCount: 10 }, { name: "files", maxCount: 10 }]),
  ProjectController.create,
);

// UPDATE
router.put(
  "/:id",
  authenticate,
  authorize("projects", "UPDATE"),
  ProjectController.update,
);

// TAG PROJECT AS COMPLETED (progress must already be 100%)
router.post(
  "/:id/complete",
  authenticate,
  authorize("projects", "UPDATE"),
  ProjectController.complete,
);

// TEMPORARILY CANCEL / RESUME A PROJECT REQUEST
router.post(
  "/:id/cancel",
  authenticate,
  authorize("projects", "UPDATE"),
  ProjectController.cancel,
);

router.post(
  "/:id/resume",
  authenticate,
  authorize("projects", "UPDATE"),
  ProjectController.resume,
);

// DELETE
router.delete(
  "/:id",
  authenticate,
  authorize("projects", "DELETE"),
  ProjectController.delete,
);

//FULL PROJECT TREE
router.get(
  "/:id/full",
  authenticate,
  // authorize("projects", "READ"),
  ProjectController.getFull,
);

// FULL PROJECT FOR APPROVAL VIEW (approvers can see full details)
router.get(
  "/:id/view-for-approval",
  authenticate,
  ProjectController.getFullForApproval,
);

// 🔥 PROJECT MEMBER MANAGEMENT

// Get all project members (grouped by role)
router.get(
  "/:projectId/members",
  authenticate,
  authorize("team_management", "READ"),
  getProjectMembers
);

// Get the project team as a render-ready organization chart
router.get(
  "/:projectId/team-org-chart",
  authenticate,
  authorize("team_management", "READ"),
  getProjectTeamOrgChart
);

// Get all engaged users in project (for subtask assignment dropdown)
router.get(
  "/:projectId/engaged-users",
  authenticate,
  authorize("team_management", "READ"),
  getProjectEngagedUsers
);

// Assign user to project with role (SUB_OWNER or MEMBER)
router.post(
  "/:projectId/assign-member",
  authenticate,
  authorize("team_management", "CREATE"),
  assignProjectMember
);

// 🔥 UPDATE member role (SUB_OWNER ↔ MEMBER) with draft auto-save
router.patch(
  "/:projectId/members/:userId/role",
  authenticate,
  authorize("team_management", "UPDATE"),
  updateProjectMemberRole
);

// Remove user from project
router.post(
  "/:projectId/remove-member",
  authenticate,
  authorize("team_management", "DELETE"),
  removeProjectMember
);

// ========================================
// 📎 PROJECT ATTACHMENTS
// ========================================
router.post(
  "/:id/attachments",
  authenticate,
  authorize("projects", "UPDATE"),
  upload.fields([{ name: "attachments", maxCount: 10 }, { name: "files", maxCount: 10 }]),
  uploadProjectAttachment
);

router.get(
  "/:id/attachments",
  authenticate,
  // authorize("projects", "READ"),
  getProjectAttachments
);

router.delete(
  "/attachments/:attachmentId",
  authenticate,
  authorize("projects", "UPDATE"),
  deleteProjectAttachment
);

router.get(
  "/attachments/:attachmentId/file",
  authenticate,
  // authorize("projects", "READ"),
  streamProjectAttachment
);

export default router;
