import { Router } from "express";
import {
  login,
  refresh,
  logout,
  getMe,
  getMyPermissions,
  exchangeMicrosoft,
  registerMicrosoftSso,
  getSsoRegistrations,
  getSsoRegistrationAudits,
  approveSsoRegistrationRequest,
  rejectSsoRegistrationRequest,
} from "./auth.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";

const router = Router();

router.post("/login", login);
router.post("/sso/microsoft/exchange", exchangeMicrosoft);
router.post("/sso/microsoft/register", registerMicrosoftSso);
router.get(
  "/sso/microsoft/registrations",
  authenticate,
  /* authorize("settings_user_requests", "READ"), */ getSsoRegistrations,
);
router.get(
  "/sso/microsoft/registrations/audits",
  authenticate,
  /* authorize("settings_user_requests", "READ"), */ getSsoRegistrationAudits,
);
router.patch(
  "/sso/microsoft/registrations/:id/approve",
  authenticate,
  authorize("settings_user_requests", "UPDATE"),
  approveSsoRegistrationRequest,
);
router.patch(
  "/sso/microsoft/registrations/:id/reject",
  authenticate,
  authorize("settings_user_requests", "UPDATE"),
  rejectSsoRegistrationRequest,
);
router.post("/refresh", refresh);
router.post("/logout", authenticate, logout);
router.get("/me", authenticate, getMe);
router.get("/me/permissions", authenticate, getMyPermissions);

export default router;
