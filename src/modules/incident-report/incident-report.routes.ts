import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import upload from "../../middleware/upload.middleware";
import { incidentReportController } from "./incident-report.controller";

const router = Router();
const incidentFiles = upload.fields([
  { name: "attachments", maxCount: 10 },
  { name: "files", maxCount: 10 },
]);

router.get(
  "/",
  authenticate,
  authorize("incident_reports", "READ"),
  incidentReportController.list
);
router.post(
  "/",
  authenticate,
  authorize("incident_reports", "CREATE"),
  incidentFiles,
  incidentReportController.create
);
router.get(
  "/attachments/:attachmentId/file",
  authenticate,
  authorize("incident_reports", "READ"),
  incidentReportController.streamAttachment
);
router.delete(
  "/attachments/:attachmentId",
  authenticate,
  authorize("incident_reports", "DELETE"),
  incidentReportController.deleteAttachment
);
router.get(
  "/:id",
  authenticate,
  authorize("incident_reports", "READ"),
  incidentReportController.getById
);
router.put(
  "/:id",
  authenticate,
  authorize("incident_reports", "UPDATE"),
  incidentReportController.update
);
router.patch(
  "/:id/resolve",
  authenticate,
  authorize("incident_reports", "UPDATE"),
  incidentReportController.resolve
);
router.patch(
  "/:id/cancel",
  authenticate,
  authorize("incident_reports", "UPDATE"),
  incidentReportController.cancel
);
router.delete(
  "/:id",
  authenticate,
  authorize("incident_reports", "DELETE"),
  incidentReportController.delete
);
router.get(
  "/:id/attachments",
  authenticate,
  authorize("incident_reports", "READ"),
  incidentReportController.listAttachments
);
router.post(
  "/:id/attachments",
  authenticate,
  authorize("incident_reports", "CREATE"),
  incidentFiles,
  incidentReportController.uploadAttachments
);

export default router;
