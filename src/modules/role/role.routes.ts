import { Router } from "express";
import {
  createRole,
  deleteRole,
  getRoles,
  syncPermissions,
  syncRolePagePermissionsController,
} from "./role.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { getRolePermissions } from "./role.controller";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("settings_roles", "CREATE"), 
  createRole
);

router.put(
  "/:roleId/permissions",
  authenticate,
  authorize("settings_roles", "UPDATE"),
  syncPermissions
);

router.delete(
  "/:roleId",
  authenticate,
  authorize("settings_roles", "DELETE"),
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
  // authorize("ROLES", "READ"),
  getRolePermissions
);

router.put(
  "/:roleId/page-permissions",
  authenticate,
  authorize("settings_roles", "UPDATE"),
  syncRolePagePermissionsController
);

router.get(
  "/:roleId/page-permissions",
  authenticate,
  // authorize("ROLES", "READ"),
  getRolePermissions
);

export default router;