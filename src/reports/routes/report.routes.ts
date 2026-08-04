import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { ReportController } from "../controllers/report.controller";

const router = Router();

router.get("/projects/:projectId/calendar", authenticate, ReportController.calendar);
router.get("/projects/:projectId/preview", authenticate, ReportController.preview);
router.get("/projects/:projectId/pdf", authenticate, ReportController.pdf);
router.get("/projects/:projectId/excel", authenticate, ReportController.excel);

export default router;
