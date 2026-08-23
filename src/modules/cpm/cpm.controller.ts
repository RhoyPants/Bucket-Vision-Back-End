import { Request, Response } from "express";
import { CpmService } from "./cpm.service";
import { CpmHttpError, DependencyInput } from "./cpm.types";

function projectId(req: Request): string {
  const value = req.params.projectId;
  return Array.isArray(value) ? value[0] : value;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof CpmHttpError) {
    res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
    });
    return;
  }
  console.error("CPM request failed:", error);
  res.status(500).json({ success: false, error: { code: "CPM_INTERNAL_ERROR", message: "Unable to process the CPM schedule." } });
}

function parseDependencies(body: unknown): DependencyInput[] {
  const payload = body as { dependencies?: unknown } | null;
  if (!payload || !Array.isArray(payload.dependencies)) {
    throw new CpmHttpError(422, "CPM_INVALID_DEPENDENCIES", "dependencies must be an array.");
  }
  const dependencies = payload.dependencies as DependencyInput[];
  const invalid = dependencies.find((dependency) => !dependency || typeof dependency !== "object" ||
    typeof dependency.predecessorSubtaskId !== "string" || !dependency.predecessorSubtaskId.trim() ||
    typeof dependency.successorSubtaskId !== "string" || !dependency.successorSubtaskId.trim());
  if (invalid) throw new CpmHttpError(422, "CPM_INVALID_DEPENDENCIES", "Every dependency must contain predecessorSubtaskId and successorSubtaskId.");
  return dependencies;
}

export class CpmController {
  static async get(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      const data = await CpmService.get(projectId(req), user.id, user.roleId);
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  }

  static async save(req: Request, res: Response): Promise<void> {
    try {
      const dependencies = parseDependencies(req.body);
      const user = (req as any).user;
      const data = await CpmService.save(projectId(req), dependencies, user.id, user.roleId);
      res.json({ success: true, message: "Dependencies saved and CPM calculated successfully.", data });
    } catch (error) {
      sendError(res, error);
    }
  }

  static async preview(req: Request, res: Response): Promise<void> {
    try {
      const dependencies = parseDependencies(req.body);
      const user = (req as any).user;
      const data = await CpmService.preview(projectId(req), dependencies, user.id, user.roleId);
      res.json({ success: true, message: "CPM preview calculated successfully.", data });
    } catch (error) {
      sendError(res, error);
    }
  }
}
