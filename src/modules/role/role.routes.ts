import { Router } from "express";
import { createRole, deleteRole, getRoles, syncPermissions } from "./role.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { getRolePermissions } from "./role.controller";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("ROLES", "CREATE"), 
  createRole
);

router.put(
  "/:roleId/permissions",
  authenticate,
  authorize("ROLES", "UPDATE"),
  syncPermissions
);

router.delete(
  "/:roleId",
  authenticate,
  authorize("ROLES", "DELETE"),
  deleteRole
);

router.get(
  "/",
  // authenticate,
  // authorize("ROLES", "READ"),
  getRoles
); 


router.get(
  "/:roleId/permissions",
  authenticate,
  authorize("ROLES", "READ"),
  getRolePermissions
);

export default router;