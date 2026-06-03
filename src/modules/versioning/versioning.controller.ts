import { Request, Response } from "express";
import { versioningService, VersionAmendments } from "./versioning.service";

export class VersioningController {
  /**
   * POST /api/versioning/:projectId/create
   * Create a new version of an active project
   * Clones all progress, reports, attachments, team
   * Updates timeline/budget according to amendments
   */
  async createNewVersion(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const amendments: VersionAmendments = req.body;
      const userId = req.user?.id;

      if (!projectId || !userId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId and authorization required" });
        return;
      }

      const result = await versioningService.createNewVersion(
        projectId,
        amendments,
        userId
      );

      res.status(201).json({
        success: true,
        data: result,
        message: `Version v${result.newProject.versionNumber} created successfully with all historical data preserved`,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to create version",
      });
    }
  }

  /**
   * GET /api/versioning/:projectId/detail
   * Get full detail of a specific version
   */
  async getVersionDetail(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;

      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId required" });
        return;
      }

      const detail = await versioningService.getVersionDetail(projectId);

      res.status(200).json({
        success: true,
        data: detail,
      });
    } catch (error: any) {
      const status = error.message === "Version not found" ? 404 : 400;
      res.status(status).json({
        error: error.message || "Failed to fetch version detail",
      });
    }
  }

  /**
   * GET /api/versioning/pin/:pin
   * Get all versions of a project (by PIN)
   */
  async getProjectVersions(req: Request, res: Response): Promise<void> {
    try {
      const { pin } = req.params;

      if (!pin || typeof pin !== "string") {
        res.status(400).json({ error: "PIN required" });
        return;
      }

      const versions = await versioningService.getProjectVersions(pin);

      if (versions.length === 0) {
        res.status(404).json({ error: "No versions found for this PIN" });
        return;
      }

      res.status(200).json({
        success: true,
        data: versions,
        count: versions.length,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to fetch versions",
      });
    }
  }

  /**
   * GET /api/versioning/:projectId/history
   * Get version history for a specific project
   */
  async getVersionHistory(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;

      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId required" });
        return;
      }

      const history = await versioningService.getVersionHistory(projectId);

      res.status(200).json({
        success: true,
        data: history,
        count: history.length,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to fetch version history",
      });
    }
  }

  /**
   * GET /api/versioning/compare/:v1/:v2
   * Compare two versions to see what changed
   */
  async compareVersions(req: Request, res: Response): Promise<void> {
    try {
      const { v1, v2 } = req.params;

      if (!v1 || !v2 || typeof v1 !== "string" || typeof v2 !== "string") {
        res.status(400).json({ error: "v1 and v2 project IDs required" });
        return;
      }

      const comparison = await versioningService.compareVersions(v1, v2);

      res.status(200).json({
        success: true,
        message: "Version comparison loaded",
        data: comparison,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to compare versions",
      });
    }
  }

  /**
   * GET /api/versioning/active/pin/:pin
   * Get the active version of a project (by PIN)
   */
  async getActiveVersionByPin(req: Request, res: Response): Promise<void> {
    try {
      const { pin } = req.params;

      if (!pin || typeof pin !== "string") {
        res.status(400).json({ error: "PIN required" });
        return;
      }

      const activeVersion = await versioningService.getActiveVersionByPin(pin);

      if (!activeVersion) {
        res.status(404).json({ error: "No active version found for this PIN" });
        return;
      }

      res.status(200).json({
        success: true,
        data: activeVersion,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to fetch active version",
      });
    }
  }

  /**
   * DELETE /api/versioning/:projectId/delete-draft
   * Delete a draft version (before submission for approval)
   */
  async deleteDraftVersion(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;

      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId required" });
        return;
      }

      const deleted = await versioningService.deleteDraftVersion(projectId);

      res.status(200).json({
        success: true,
        data: deleted,
        message: `Draft version v${deleted.versionNumber} deleted successfully`,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "Failed to delete draft version",
      });
    }
  }
}

export const versioningController = new VersioningController();
