import { Router } from "express";
import { createUser, deleteUser, getMyMembers, getUsers, getUserById, updateUser, updateUserStatus, getMyManagers, assignManager, removeManager, getOrgChart, getUserMembersById, getUserManagersById } from "./user.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

router.get(
  "/my-members",
  authenticate,
  // authorize("settings_users", "READ"),
  getMyMembers
);

router.get(
  "/my-managers",
  authenticate,
  // authorize("settings_users", "READ"),
  getMyManagers
);

router.post(
  "/assign-manager",
  authenticate,
  authorize("settings_users", "UPDATE"),
  assignManager
);

router.post(
  "/remove-manager",
  authenticate,
  authorize("settings_users", "UPDATE"),
  removeManager
);

router.get(
  "/org-chart/:userId",
  authenticate,
  // authorize("settings_users", "READ"),
  getOrgChart
);

// 🔥 VERY IMPORTANT: these must be BEFORE "/:userId"
router.get(
  "/:userId/members",
  authenticate,
  // authorize("settings_users", "READ"),
  getUserMembersById
);

router.get(
  "/:userId/managers",
  authenticate,
  // authorize("settings_users", "READ"),
  getUserManagersById
);

// =========================
// GENERIC ROUTES LAST
// =========================
router.get(
  "/",
  authenticate,
  // authorize("settings_users", "READ"),
  getUsers
);

router.get(
  "/:userId",
  authenticate,
  // authorize("settings_users", "READ"),
  getUserById
);

router.post(
  "/",
  authenticate,
  authorize("settings_users", "CREATE"),
  createUser
);

router.put(
  "/:userId",
  authenticate,
  authorize("settings_users", "UPDATE"),
  updateUser
);

router.patch(
  "/:userId/status",
  authenticate,
  authorize("settings_users", "UPDATE"),
  updateUserStatus
);

router.delete(
  "/:userId",
  authenticate,
  authorize("settings_users", "DELETE"),
  deleteUser
);
export default router;