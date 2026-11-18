import { Request, Response } from "express";
import { dashboardService } from "./dashboard.service";

const ALLOWED_DAYS = [7, 14, 30, 90];
const MAX_RANGE_DAYS = 90;
const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toUtcDay = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

/** Reads ?days=7|14|30|90 or ?from=YYYY-MM-DD&to=YYYY-MM-DD. Throws a readable message on bad input. */
export const parseTrendWindow = (query: Request["query"]) => {
  const { days, from, to } = query;
  if (from !== undefined || to !== undefined) {
    if (typeof from !== "string" || typeof to !== "string" || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new Error("from and to must both be YYYY-MM-DD dates.");
    }
    const start = toUtcDay(from);
    const end = toUtcDay(to);
    if (!start || !end) throw new Error("from and to must be real calendar dates.");
    if (start > end) throw new Error("from must not be after to.");
    if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      throw new Error(`The date range cannot be longer than ${MAX_RANGE_DAYS} days.`);
    }
    return { from, to };
  }
  if (days === undefined) return undefined;
  const count = Number(days);
  if (!ALLOWED_DAYS.includes(count)) throw new Error(`days must be one of ${ALLOWED_DAYS.join(", ")}.`);
  return { days: count };
};

export class DashboardController {
  async get(req: Request, res: Response) {
    try {
      const window = parseTrendWindow(req.query);
      const data = await dashboardService.get((req as any).user.id, new Date(), window);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }
}

export const dashboardController = new DashboardController();
