import { Router } from "express";
import { createUser, deleteUser, getMyMembers, getUsers, getUserById, updateUser, updateUserStatus, getMyManagers, assignManager, removeManager, getOrgChart, getUserMembersById, getUserManagersById } from "./user.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

router.get(
  "/my-members",
  authenticate,
  authorize("USERS", "READ"),
  getMyMembers
);

router.get(
  "/my-managers",
  authenticate,
  authorize("USERS", "READ"),
  getMyManagers
);

router.post(
  "/assign-manager",
  authenticate,
  authorize("USERS", "UPDATE"),
  assignManager
);

router.post(
  "/remove-manager",
  authenticate,
  authorize("USERS", "UPDATE"),
  removeManager
);

router.get(
  "/org-chart/:userId",
  authenticate,
  authorize("USERS", "READ"),
  getOrgChart
);

// 🔥 VERY IMPORTANT: these must be BEFORE "/:userId"
router.get(
  "/:userId/members",
  authenticate,
  authorize("USERS", "READ"),
  getUserMembersById
);

router.get(
  "/:userId/managers",
  authenticate,
  authorize("USERS", "READ"),
  getUserManagersById
);

// =========================
// GENERIC ROUTES LAST
// =========================
router.get(
  "/",
  authenticate,
  authorize("USERS", "READ"),
  getUsers
);

router.get(
  "/:userId",
  authenticate,
  authorize("USERS", "READ"),
  getUserById
);

router.post(
  "/",
  authenticate,
  authorize("USERS", "CREATE"),
  createUser
);

router.put(
  "/:userId",
  authenticate,
  authorize("USERS", "UPDATE"),
  updateUser
);

router.patch(
  "/:userId/status",
  authenticate,
  authorize("USERS", "UPDATE"),
  updateUserStatus
);

router.delete(
  "/:userId",
  authenticate,
  authorize("USERS", "DELETE"),
  deleteUser
);
export default router;