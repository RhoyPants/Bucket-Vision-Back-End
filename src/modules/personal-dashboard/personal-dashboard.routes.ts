import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { personalDashboardController } from "./personal-dashboard.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "READ"),
  personalDashboardController.list
);

router.post(
  "/",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "CREATE"),
  personalDashboardController.create
);

router.get(
  "/:id",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "READ"),
  personalDashboardController.getById
);

router.put(
  "/:id",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "UPDATE"),
  personalDashboardController.update
);

router.delete(
  "/:id",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "DELETE"),
  personalDashboardController.delete
);

router.get(
  "/:id/source-options",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "READ"),
  personalDashboardController.getSourceOptions
);

router.get(
  "/:id/source-preview",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "READ"),
  personalDashboardController.previewSource
);

router.post(
  "/:id/kpis",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "CREATE"),
  personalDashboardController.createKpi
);

router.put(
  "/:id/kpis/:kpiId",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "UPDATE"),
  personalDashboardController.updateKpi
);

router.delete(
  "/:id/kpis/:kpiId",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "DELETE"),
  personalDashboardController.deleteKpi
);

router.put(
  "/:id/charts",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "UPDATE"),
  personalDashboardController.updateCharts
);

router.get(
  "/:id/charts/data",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "READ"),
  personalDashboardController.getChartData
);

router.get(
  "/:id/notes",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "READ"),
  personalDashboardController.listNotes
);

router.post(
  "/:id/notes",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "CREATE"),
  personalDashboardController.createNote
);

router.put(
  "/:id/notes/:noteId",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "UPDATE"),
  personalDashboardController.updateNote
);

router.delete(
  "/:id/notes/:noteId",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "DELETE"),
  personalDashboardController.deleteNote
);

router.post(
  "/:id/notes/:noteId/items",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "CREATE"),
  personalDashboardController.addNoteItem
);

router.put(
  "/:id/notes/:noteId/items/:itemId",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "UPDATE"),
  personalDashboardController.updateNoteItem
);

router.delete(
  "/:id/notes/:noteId/items/:itemId",
  authenticate,
  authorize("PERSONAL_DASHBOARDS", "DELETE"),
  personalDashboardController.deleteNoteItem
);

export default router;
