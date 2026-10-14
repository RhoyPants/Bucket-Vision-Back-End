import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { incidentReportController } from "./incident-report.controller";
import { incidentCaseManagementController } from "./case-management/incident-case-management.controller";
import { incidentInboxController } from "./inbox/incident-inbox.controller";

const router = Router();
router.get("/inbox-summary", authenticate, authorize("incident_reports", "READ"), incidentInboxController.summary);
router.get("/my-reports", authenticate, authorize("incident_reports", "READ"), incidentInboxController.myReports);
router.get("/for-my-action", authenticate, authorize("incident_reports", "READ"), incidentInboxController.forMyAction);
router.get("/my-corrective-actions", authenticate, authorize("incident_reports", "READ"), incidentInboxController.myCorrectiveActions);
router.get("/filter-options/projects", authenticate, authorize("incident_reports", "READ"), incidentInboxController.projects);
router.get("/filter-options/incident-types", authenticate, authorize("incident_reports", "READ"), incidentInboxController.incidentTypes);
router.get("/:id/investigation", authenticate, authorize("incident_reports", "READ"), incidentCaseManagementController.getInvestigation);
router.patch("/:id/investigation", authenticate, authorize("incident_reports", "UPDATE"), incidentCaseManagementController.saveInvestigation);
router.get("/:id/actions", authenticate, authorize("incident_reports", "READ"), incidentCaseManagementController.listActions);
router.get("/:id/actions/:actionId", authenticate, authorize("incident_reports", "READ"), incidentCaseManagementController.getAction);
router.post("/:id/actions", authenticate, authorize("incident_reports", "UPDATE"), incidentCaseManagementController.createAction);
router.patch("/:id/actions/:actionId", authenticate, authorize("incident_reports", "UPDATE"), incidentCaseManagementController.updateAction);
router.get("/:id/action-owner-options", authenticate, authorize("incident_reports", "READ"), incidentCaseManagementController.ownerOptions);
router.get("/:id/resolution-readiness", authenticate, authorize("incident_reports", "READ"), incidentCaseManagementController.readiness);
router.get("/:id/history", authenticate, authorize("incident_reports", "READ"), incidentCaseManagementController.history);
router.get("/:id/report.pdf", authenticate, authorize("incident_reports", "READ"), incidentCaseManagementController.report);
router.get("/:id/workflow/history", authenticate, authorize("incident_reports", "READ"), incidentReportController.workflowHistory);
router.get("/:id/notification-escalation/history", authenticate, authorize("incident_reports", "READ"), incidentReportController.notificationEscalationHistory);
router.patch("/:id/workflow/complete-level", authenticate, authorize("incident_reports", "UPDATE"), incidentReportController.completeWorkflowLevel);
router.get(
  "/",
  authenticate,
  authorize("incident_reports", "READ"),
  incidentInboxController.all
);
router.post(
  "/",
  authenticate,
  authorize("incident_reports", "CREATE"),
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
router.patch("/attachments/:attachmentId", authenticate, authorize("incident_reports", "UPDATE"), incidentReportController.updateAttachment);
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
  incidentReportController.uploadAttachments
);

export default router;
