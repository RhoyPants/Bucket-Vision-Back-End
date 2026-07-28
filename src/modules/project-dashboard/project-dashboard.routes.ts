import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { projectDashboardController } from "./project-dashboard.controller";

const router = Router();

router.get("/notes", authenticate, projectDashboardController.listNotes);
router.post("/notes", authenticate, authorize("project_dashboard", "CREATE"), projectDashboardController.createNote);
router.put("/notes/:noteId", authenticate, authorize("project_dashboard", "UPDATE"), projectDashboardController.updateNote);
router.delete("/notes/:noteId", authenticate, authorize("project_dashboard", "DELETE"), projectDashboardController.deleteNote);
router.post("/notes/:noteId/items", authenticate, authorize("project_dashboard", "CREATE"), projectDashboardController.addNoteItem);
router.put("/notes/:noteId/items/:itemId", authenticate, authorize("project_dashboard", "UPDATE"), projectDashboardController.updateNoteItem);
router.delete("/notes/:noteId/items/:itemId", authenticate, authorize("project_dashboard", "DELETE"), projectDashboardController.deleteNoteItem);

router.get("/:projectId", authenticate, projectDashboardController.get);
router.get("/:projectId/source-options", authenticate, projectDashboardController.getSourceOptions);
router.get("/:projectId/source-preview", authenticate, projectDashboardController.previewSource);
router.post("/:projectId/kpis", authenticate, authorize("project_dashboard", "CREATE"), projectDashboardController.createKpi);
router.put("/:projectId/kpis/:kpiId", authenticate, authorize("project_dashboard", "UPDATE"), projectDashboardController.updateKpi);
router.delete("/:projectId/kpis/:kpiId", authenticate, authorize("project_dashboard", "DELETE"), projectDashboardController.deleteKpi);
router.get("/:projectId/charts/data", authenticate, projectDashboardController.getChartData);
router.get("/:projectId/report-table", authenticate, projectDashboardController.getReportTable);
router.get("/:projectId/subtask-kpi", authenticate, projectDashboardController.getSubtaskKpi);
router.get("/:projectId/subtask-kpi/config", authenticate, projectDashboardController.getSubtaskKpiConfig);
router.put(
  "/:projectId/subtask-kpi/config",
  authenticate,
  authorize("project_dashboard", "UPDATE"),
  projectDashboardController.updateSubtaskKpiConfig
);
router.delete(
  "/:projectId/subtask-kpi/config",
  authenticate,
  authorize("project_dashboard", "UPDATE"),
  projectDashboardController.resetSubtaskKpiConfig
);

export default router;
