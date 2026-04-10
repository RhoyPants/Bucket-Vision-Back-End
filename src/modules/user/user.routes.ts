import { Router } from "express";
import { createUser, deleteUser, getUsers, updateUser } from "./user.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("USERS", "READ"),
  getUsers
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

router.delete(
  "/:userId",
  authenticate,
  authorize("USERS", "DELETE"),
  deleteUser
);

export default router;