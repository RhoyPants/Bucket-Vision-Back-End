import { Router } from "express";
import { sendAutomateEmail } from "./email.controller";

const router = Router();
router.post("/send", sendAutomateEmail);
export default router;
