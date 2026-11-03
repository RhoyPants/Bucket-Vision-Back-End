/// <reference path="../../types/express.d.ts" />
import assert from "node:assert/strict";
import { reportCalculationService as calculator } from "../services/report-calculation.service";
import { parseReportPeriod } from "../validators/report-request.validator";
import { WorkSchedule } from "../../utils/schedule-health";
import { reportDataService } from "../services/report-data.service";
import { reportChartService } from "../services/report-chart.service";
import { REPORT_HEALTH_PRESENTATION, reportHealthLabel } from "../types/report-health";
import { reportExcelService } from "../services/report-excel.service";
import { ReportController } from "../controllers/report.controller";
import { reportPdfService } from "../services/report-pdf.service";
import app from "../../app";
import { AddressInfo } from "node:net";
import JSZip from "jszip";
import prisma from "../../config/prisma";

const now = new Date("2026-07-31T04:00:00.000Z");

const daily = parseReportPeriod(
  { type: "DAILY", date: "2026-07-30", timezone: "Asia/Manila" },
  now
);
assert.equal(daily.startUtc.toISOString(), "2026-07-29T16:00:00.000Z");
assert.equal(daily.endExclusiveUtc.toISOString(), "2026-07-30T16:00:00.000Z");

const weekly = parseReportPeriod(
  {
    type: "WEEKLY",
    dateFrom: "2026-07-20",
    dateTo: "2026-07-26",
    timezone: "Asia/Manila",
  },
  now
);
assert.equal(weekly.startDate, "2026-07-20");
assert.equal(weekly.endDate, "2026-07-26");

assert.throws(
  () =>
    parseReportPeriod(
      {
        type: "WEEKLY",
        dateFrom: "2026-07-21",
        dateTo: "2026-07-27",
        timezone: "Asia/Manila",
      },
      now
    ),
  /Monday through Sunday/
);

const subtask: any = {
  id: "subtask-1",
  budgetPercent: 100,
  budgetAllocated: null,
  projectedStartDate: new Date("2026-07-20T00:00:00.000Z"),
  projectedEndDate: new Date("2026-07-24T00:00:00.000Z"),
  progressLogs: [
    { date: new Date("2026-07-21T00:00:00.000Z"), cumulativePercent: 20 },
    { date: new Date("2026-07-25T00:00:00.000Z"), cumulativePercent: 80 },
  ],
  task: {
    budgetPercent: null,
    budgetAllocated: null,
    scope: { budgetPercent: null, budgetAllocated: null },
  },
};

assert.equal(
  calculator.actualAt(subtask, new Date("2026-07-23T23:59:59.999Z")),
  20
);
assert.equal(
  calculator.actualAt(subtask, new Date("2026-07-26T23:59:59.999Z")),
  80
);
const schedule: WorkSchedule = {
  monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
  saturday: false, sunday: false, includeHolidays: true, holidayKeys: new Set(),
};
const cutoff = new Date("2026-07-23T15:59:59.999Z");
assert.equal(calculator.health(subtask, cutoff, schedule).status, "WARNING");
assert.equal(calculator.health(subtask, new Date("2026-07-24T15:59:59.999Z"), schedule).status, "WARNING");
assert.equal(calculator.health(subtask, new Date("2026-07-25T15:59:59.999Z"), schedule).status, "DANGER");
const laterCompletion = { ...subtask, progressLogs: [
  ...subtask.progressLogs, { date: new Date("2026-07-26T00:00:00.000Z"), cumulativePercent: 100 },
] };
assert.equal(calculator.health(laterCompletion, cutoff, schedule).status, "WARNING");
assert.equal(calculator.health(laterCompletion, new Date("2026-07-25T15:59:59.999Z"), schedule).status, "DANGER");
assert.equal(calculator.health(laterCompletion, new Date("2026-07-26T15:59:59.999Z"), schedule).status, "HEALTHY");
assert.equal(calculator.health({ ...subtask, progressLogs: [] }, new Date("2026-07-19T15:59:59.999Z"), schedule).status, "NOT_STARTED");
assert.equal(calculator.actualAt({ ...subtask, progressLogs: [] }, cutoff), 0);
assert.equal(calculator.actualStartAt(subtask, new Date("2026-07-20T15:59:59.999Z")), null);
assert.equal(calculator.actualStartAt(subtask, cutoff)?.toISOString(), "2026-07-21T00:00:00.000Z");
assert.equal(calculator.actualStartAt({ ...subtask, progressLogs: [], actualStartDate: new Date("2026-08-01") }, cutoff), null);
assert.equal(calculator.actualStartAt({ ...subtask, progressLogs: [], actualStartDate: cutoff }, cutoff)?.getTime(), cutoff.getTime());
for (const cumulativePercent of [null, NaN, Infinity, -1, 101]) {
  const invalid = { ...subtask, isBudgeted: false, progressLogs: [{ date: cutoff, cumulativePercent }] };
  assert.equal(calculator.actualAt(invalid, cutoff), null);
  assert.equal(calculator.health(invalid, cutoff, schedule).status, "UNCLASSIFIED");
  assert.equal(calculator.aggregate([invalid], (item) => calculator.actualAt(item, cutoff), { strict: true }), null);
}
const precisionTask = {
  ...subtask,
  projectedEndDate: new Date("2026-07-22T00:00:00.000Z"),
  progressLogs: [{ date: new Date("2026-07-20T00:00:00.000Z"), cumulativePercent: 33.333 }],
};
assert.ok(Math.abs(calculator.expectedAt(precisionTask, new Date("2026-07-20T15:59:59.999Z"), schedule)! - 100 / 3) < 1e-12);
assert.equal(calculator.health(precisionTask, new Date("2026-07-20T15:59:59.999Z"), schedule).status, "WARNING");
const period = { ...daily, cutoffUtc: cutoff };
const precisionMetrics = (reportDataService as any).metrics([precisionTask], {
  ...period, cutoffUtc: new Date("2026-07-20T15:59:59.999Z"),
}, schedule);
assert.equal(precisionMetrics.actualProgress, 33.33);
assert.equal(precisionMetrics.expectedProgress, 33.33);
assert.ok(precisionMetrics.variance === 0);
assert.equal(precisionMetrics.health, "WARNING", "Display rounding must not erase a negative variance");
const invalidTask = { ...subtask, progressLogs: [{ date: cutoff, cumulativePercent: null }] };
const metrics = (reportDataService as any).metrics([invalidTask], period, schedule);
assert.equal(metrics.actualProgress, null);
assert.equal(metrics.health, "UNCLASSIFIED");
assert.ok(metrics.statusReason);
const completed = { ...subtask, projectedStartDate: null, projectedEndDate: null,
  progressLogs: [{ date: cutoff, cumulativePercent: 100 }] };
assert.equal((reportDataService as any).metrics([completed], period, schedule).health, "HEALTHY");
const holidaySchedule = { ...schedule, holidayKeys: new Set(["2026-07-24"]) };
assert.equal(calculator.expectedAt(subtask, cutoff, holidaySchedule), 100);
const auditTask = {
  ...subtask,
  progressLogs: [{
    id: "log-1", date: cutoff, createdAt: cutoff, updatedAt: cutoff,
    cumulativePercent: 20, dailyPercent: 20, attachments: [], latitude: null, longitude: null,
  }],
};
const audit = (reportDataService as any).buildProgressAudit([auditTask], {
  ...period, startUtc: new Date("2026-07-23T00:00:00+08:00"), endExclusiveUtc: new Date("2026-07-24T00:00:00+08:00"),
}, schedule);
assert.equal(audit.entries[0].healthAfter, "WARNING");
assert.ok(audit.entries[0].statusReason);
assert.equal(audit.entries[0].paceStatus, "BELOW_PLAN");
const statuses = Object.keys(REPORT_HEALTH_PRESENTATION);
const detailedProgress = [{
  tasks: [{ subtasks: statuses.map((health, index) => ({
    id: String(index), title: health, metrics: { health, actualProgress: null },
  })) }],
}];
const svg = reportChartService.buildHealthDonutSvg(detailedProgress);
for (const status of statuses) assert.ok(svg.includes(reportHealthLabel(status)));

async function checkExports() {
  const data = {
    healthRulesVersion: 2,
    report: { type: "DAILY", periodEnd: "2026-07-23", generatedAt: cutoff },
    project: { name: "V2 report", startDate: subtask.projectedStartDate },
    summary: { actualProgress: null, totalProjectProgress: null, expectedProgress: 80, variance: null, health: "UNCLASSIFIED" },
    detailedProgress, sCurve: [], progressAudit: { entries: [] },
  };
  const service = reportExcelService as any;
  const originalContext = service.loadLegacyContext;
  const originalProject = prisma.project.findUniqueOrThrow;
  service.loadLegacyContext = async () => ({ subtasks: [], schedule });
  (prisma.project as any).findUniqueOrThrow = async () => ({ scopes: [], name: data.project.name });
  try {
    const buffer = await service.generate("test", data);
    const zip = await JSZip.loadAsync(buffer);
    const sheetPath = zip.file("xl/worksheets/sheet7.xml") ? "xl/worksheets/sheet2.xml" : "xl/worksheets/sheet4.xml";
    const sheet = await zip.file(sheetPath)!.async("string");
    const styles = await zip.file("xl/styles.xml")!.async("string");
    const fontSection = styles.match(/<(?:x:)?fonts\b[^>]*count="(\d+)"[^>]*>([\s\S]*?)<\/(?:x:)?fonts>/)!;
    assert.equal(Number(fontSection[1]), [...fontSection[2].matchAll(/<(?:x:)?font>/g)].length);
    for (const { label, color } of Object.values(REPORT_HEALTH_PRESENTATION)) {
      assert.ok(sheet.includes(label), `Excel label ${label}`);
      assert.ok(styles.includes(`FF${color.slice(1).toUpperCase()}`), `Excel color ${color}`);
    }
    if (sheetPath.endsWith("sheet4.xml")) {
      assert.match(sheet, /r="B5"[^>]*\/>/, "Unavailable progress is blank, not zero");
      const chart = await zip.file("xl/drawings/charts/chart2.xml")!.async("string");
      for (const { label } of Object.values(REPORT_HEALTH_PRESENTATION)) assert.ok(chart.includes(label));
    }
  } finally {
    service.loadLegacyContext = originalContext;
    prisma.project.findUniqueOrThrow = originalProject;
  }
  const originalPreview = reportDataService.buildPreview;
  const originalPdf = reportPdfService.generate;
  const originalExcel = reportExcelService.generate;
  try {
    const headers: Record<string, unknown> = {};
    let response: any;
    const res: any = {
      setHeader: (name: string, value: unknown) => { headers[name] = value; },
      json: (body: any) => { response = body; }, status: () => res,
      send: (body: any) => { response = body; },
    };
    const req: any = { params: { projectId: "test" }, user: { id: "user" }, query: {} };
    (reportDataService as any).buildPreview = async () => data;
    await ReportController.preview(req, res);
    assert.equal(headers["X-Health-Rules-Version"], "2");
    assert.equal(response.data.healthRulesVersion, 2);
    reportPdfService.generate = async () => Buffer.from("%PDF-test");
    reportExcelService.generate = async () => Buffer.from("PK-test");
    for (const endpoint of [ReportController.pdf, ReportController.excel]) {
      delete headers["X-Health-Rules-Version"];
      await endpoint(req, res);
      assert.equal(headers["X-Health-Rules-Version"], "2");
      assert.ok(Buffer.isBuffer(response));
    }
    reportDataService.buildPreview = async () => { throw Object.assign(new Error("Forbidden"), { statusCode: 403 }); };
    for (const endpoint of [ReportController.preview, ReportController.pdf, ReportController.excel]) {
      delete headers["X-Health-Rules-Version"];
      await endpoint(req, res);
      assert.equal(headers["X-Health-Rules-Version"], undefined);
      assert.equal(response.success, false);
    }
  } finally {
    reportDataService.buildPreview = originalPreview;
    reportPdfService.generate = originalPdf;
    reportExcelService.generate = originalExcel;
  }
  const html = await (reportPdfService as any).render({ ...data, photos: [], incidents: [] });
  for (const { label, color } of Object.values(REPORT_HEALTH_PRESENTATION)) {
    assert.ok(html.includes(label), `PDF label ${label}`);
    assert.ok(html.includes(color), `PDF color ${color}`);
  }
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(response.status, 200);
    const exposed = response.headers.get("access-control-expose-headers")!.toLowerCase();
    assert.ok(exposed.includes("x-health-rules-version"));
    assert.ok(exposed.includes("content-disposition"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

checkExports().then(() => console.log("Report foundation tests passed")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
