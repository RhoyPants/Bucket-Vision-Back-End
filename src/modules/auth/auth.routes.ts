import { Router } from "express";
import {
	login,
	refresh,
	logout,
	getMe,
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
router.get("/sso/microsoft/registrations", authenticate, authorize("USERS", "READ"), getSsoRegistrations);
router.get("/sso/microsoft/registrations/audits", authenticate, authorize("USERS", "READ"), getSsoRegistrationAudits);
router.patch("/sso/microsoft/registrations/:id/approve", authenticate, authorize("USERS", "UPDATE"), approveSsoRegistrationRequest);
router.patch("/sso/microsoft/registrations/:id/reject", authenticate, authorize("USERS", "UPDATE"), rejectSsoRegistrationRequest);
router.post("/refresh", refresh);
router.post("/logout", authenticate, logout);
router.get("/me", authenticate, getMe);

export default router;