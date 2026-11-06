import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { sendAutomateEmail } from "./email.controller";

const router = Router();
router.post("/send", authenticate, sendAutomateEmail);
export default router;
