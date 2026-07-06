import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { personalDashboardController } from "./personal-dashboard.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  // authorize("personal_dashboard", "READ"),
  personalDashboardController.list
);

router.post(
  "/",
  authenticate,
  authorize("personal_dashboard", "CREATE"),
  personalDashboardController.create
);

router.get(
  "/:id",
  authenticate,
  // authorize("personal_dashboard", "READ"),
  personalDashboardController.getById
);

router.put(
  "/:id",
  authenticate,
  authorize("personal_dashboard", "UPDATE"),
  personalDashboardController.update
);

router.delete(
  "/:id",
  authenticate,
  authorize("personal_dashboard", "DELETE"),
  personalDashboardController.delete
);

router.get(
  "/:id/source-options",
  authenticate,
  // authorize("personal_dashboard", "READ"),
  personalDashboardController.getSourceOptions
);

router.get(
  "/:id/source-preview",
  authenticate,
  // authorize("personal_dashboard", "READ"),
  personalDashboardController.previewSource
);

router.post(
  "/:id/kpis",
  authenticate,
  authorize("personal_dashboard", "CREATE"),
  personalDashboardController.createKpi
);

router.put(
  "/:id/kpis/:kpiId",
  authenticate,
  authorize("personal_dashboard", "UPDATE"),
  personalDashboardController.updateKpi
);

router.delete(
  "/:id/kpis/:kpiId",
  authenticate,
  authorize("personal_dashboard", "DELETE"),
  personalDashboardController.deleteKpi
);

router.put(
  "/:id/charts",
  authenticate,
  authorize("personal_dashboard", "UPDATE"),
  personalDashboardController.updateCharts
);

router.get(
  "/:id/charts/data",
  authenticate,
  // authorize("personal_dashboard", "READ"),
  personalDashboardController.getChartData
);

router.get(
  "/:id/report-table",
  authenticate,
  // authorize("personal_dashboard", "READ"),
  personalDashboardController.getReportTable
);

router.get(
  "/:id/notes",
  authenticate,
  // authorize("personal_dashboard", "READ"),
  personalDashboardController.listNotes
);

router.post(
  "/:id/notes",
  authenticate,
  authorize("personal_dashboard", "CREATE"),
  personalDashboardController.createNote
);

router.put(
  "/:id/notes/:noteId",
  authenticate,
  authorize("personal_dashboard", "UPDATE"),
  personalDashboardController.updateNote
);

router.delete(
  "/:id/notes/:noteId",
  authenticate,
  authorize("personal_dashboard", "DELETE"),
  personalDashboardController.deleteNote
);

router.post(
  "/:id/notes/:noteId/items",
  authenticate,
  authorize("personal_dashboard", "CREATE"),
  personalDashboardController.addNoteItem
);

router.put(
  "/:id/notes/:noteId/items/:itemId",
  authenticate,
  authorize("personal_dashboard", "UPDATE"),
  personalDashboardController.updateNoteItem
);

router.delete(
  "/:id/notes/:noteId/items/:itemId",
  authenticate,
  authorize("personal_dashboard", "DELETE"),
  personalDashboardController.deleteNoteItem
);

export default router;
