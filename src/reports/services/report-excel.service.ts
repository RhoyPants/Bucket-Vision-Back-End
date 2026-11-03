import fs from "fs";
import path from "path";
import JSZip from "jszip";
import prisma from "../../config/prisma";
import {
  CalculableSubtask,
  reportCalculationService as calculator,
  WorkSchedule,
} from "./report-calculation.service";
import { utcToManilaDateKey } from "../validators/report-request.validator";
import { REPORT_HEALTH_PRESENTATION, reportHealthLabel } from "../types/report-health";

const DEFAULT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "data",
  "Bucket_Vision_Web_Export.xlsx"
);
const DAY_MS = 86_400_000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

type CellValue = string | number | null | undefined;

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let result = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

function cellPattern(address: string) {
  return new RegExp(
    `<(?:x:)?c(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/(?:x:)?c>)`
  );
}

function setCell(xml: string, address: string, value: CellValue) {
  const pattern = cellPattern(address);
  const existing = xml.match(pattern)?.[0];
  if (!existing) return xml;

  const style = existing.match(/\bs="([^"]+)"/)?.[1];
  const styleAttribute = style ? ` s="${style}"` : "";
  const prefix = existing.startsWith("<x:c") ? "x:" : "";
  let replacement: string;

  if (value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))) {
    replacement = `<${prefix}c r="${address}"${styleAttribute}/>`;
  } else if (typeof value === "number") {
    replacement = `<${prefix}c r="${address}"${styleAttribute} t="n"><${prefix}v>${
      value
    }</${prefix}v></${prefix}c>`;
  } else {
    replacement = `<${prefix}c r="${address}"${styleAttribute} t="inlineStr"><${prefix}is><${prefix}t>${xmlEscape(
      value
    )}</${prefix}t></${prefix}is></${prefix}c>`;
  }

  return xml.replace(pattern, replacement);
}

function excelDate(value: unknown): number | null {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(text).getTime();
  return Number.isFinite(date) ? date / 86_400_000 + 25_569 : null;
}

function locationText(location: unknown) {
  if (!location) return "";
  if (typeof location === "string") return location;
  if (typeof location === "object") {
    const values = Object.values(location as Record<string, unknown>).filter(Boolean);
    return values.join(", ");
  }
  return String(location);
}

function progressCell(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value / 100 : null;
}

function replaceTokens(xml: string, values: Record<string, CellValue>) {
  let result = xml;
  for (const [token, value] of Object.entries(values)) {
    result = result.split(xmlEscape(`{{${token}}}`)).join(xmlEscape(value ?? ""));
    result = result.split(`{{${token}}}`).join(xmlEscape(value ?? ""));
  }
  return result;
}

function formatDate(value: unknown) {
  if (!value) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00+08:00`)
    : new Date(String(value));
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export class ReportExcelService {
  async generate(projectId: string, data: any): Promise<Buffer> {
    const templatePath = path.resolve(
      process.env.REPORT_EXCEL_TEMPLATE_PATH || DEFAULT_TEMPLATE_PATH
    );
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Excel template was not found at ${templatePath}`);
    }

    const zip = await JSZip.loadAsync(fs.readFileSync(templatePath));
    if (!zip.file("xl/worksheets/sheet7.xml")) {
      return this.generateLegacyTemplate(zip, projectId, data);
    }
    const activeAtCutoff = this.activeAtCutoff(this.endOfManilaDate(data.report.periodEnd));
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        scopes: {
          where: activeAtCutoff,
          orderBy: { order: "asc" },
          include: {
            tasks: {
              where: activeAtCutoff,
              orderBy: { order: "asc" },
              include: {
                subtasks: {
                  where: activeAtCutoff,
                  orderBy: { order: "asc" },
                  include: { creator: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });

    await this.updateSheet(zip, 2, (xml) =>
      this.populateProjectData(xml, data, project)
    );
    await this.updateSheet(zip, 3, (xml) =>
      this.populateTimelineData(xml, data, project)
    );
    await this.updateSheet(zip, 5, (xml) => this.populateSCurveData(xml, data));
    await this.updateSheet(zip, 7, (xml) =>
      this.populateProgressLogs(xml, data)
    );
    await this.applyHealthPresentation(zip, data);
    await this.forceRecalculation(zip);

    return zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  private async updateSheet(
    zip: JSZip,
    sheetNumber: number,
    populate: (xml: string) => string
  ) {
    const name = `xl/worksheets/sheet${sheetNumber}.xml`;
    const entry = zip.file(name);
    if (!entry) throw new Error(`Updated Excel template is missing ${name}`);
    zip.file(name, populate(await entry.async("string")));
  }

  private async generateLegacyTemplate(zip: JSZip, projectId: string, data: any) {
    const context = await this.loadLegacyContext(projectId, data.sCurve || [], this.endOfManilaDate(data.report.periodEnd));
    const tokens = this.legacyTokens(data);

    for (let sheetNumber = 1; sheetNumber <= 5; sheetNumber++) {
      const name = `xl/worksheets/sheet${sheetNumber}.xml`;
      const entry = zip.file(name);
      if (!entry) continue;
      let xml = replaceTokens(await entry.async("string"), tokens);
      if (sheetNumber === 2) xml = this.populateLegacyTimeline(xml, data, context);
      if (sheetNumber === 3) xml = this.populateLegacyReport(xml, data);
      if (sheetNumber === 4) xml = this.populateLegacyDashboard(xml, data);
      xml = xml.replace(/\{\{[#/]?[^{}]+\}\}/g, "");
      zip.file(name, xml);
    }

    await this.updateLegacyChartRanges(zip, data.sCurve?.length || 0);
    await this.applyHealthPresentation(zip, data);
    await this.forceRecalculation(zip);
    return zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  private legacyTokens(data: any): Record<string, CellValue> {
    const counts = this.rawHealthCounts(data);
    return {
      "report.title": `${data.report.type} PROJECT PROGRESS REPORT`,
      "report.generated_at": formatDate(data.report.generatedAt),
      "report.period_label": data.report.type === "DAILY"
        ? formatDate(data.report.periodEnd)
        : `${formatDate(data.report.periodStart)} - ${formatDate(data.report.periodEnd)}`,
      "project.name": data.project.name,
      "project.start_date": formatDate(data.project.startDate),
      "project.total_budget": Number(data.project.totalBudget || 0).toFixed(2),
      "summary.expected_progress": progressCell(data.summary.expectedProgress),
      "summary.actual_progress": progressCell(data.summary.totalProjectProgress),
      "summary.variance": progressCell(data.summary.variance),
      "summary.project_status": reportHealthLabel(data.summary.health),
      "health.healthy_count": counts.HEALTHY,
      "health.in_progress_count": counts.WARNING,
      "health.delayed_count": counts.DANGER,
      "health.not_started_count": counts.NOT_STARTED,
      "health.unclassified_count": counts.UNCLASSIFIED,
      "timeline.month_header": (data.sCurve || []).length
        ? `${formatDate(data.sCurve[0].date)} - ${formatDate(data.sCurve[data.sCurve.length - 1].date)}`
        : "",
    };
  }

  private populateLegacyDashboard(xml: string, data: any) {
    xml = setCell(xml, "E4", progressCell(data.summary.expectedProgress));
    xml = setCell(xml, "B5", progressCell(data.summary.totalProjectProgress));
    xml = setCell(xml, "C5", progressCell(data.summary.variance));
    xml = setCell(xml, "D5", reportHealthLabel(data.summary.health));

    for (let index = 0; index < 90; index++) {
      const row = 11 + index;
      const point = data.sCurve?.[index];
      xml = setCell(xml, `A${row}`, point?.date || null);
      xml = setCell(xml, `B${row}`, point ? Number(point.planned || 0) / 100 : null);
      xml = setCell(xml, `C${row}`, progressCell(point?.actual));
      xml = setCell(xml, `D${row}`, point?.forecast == null ? null : Number(point.forecast) / 100);
    }

    const counts = this.rawHealthCounts(data);
    Object.entries(REPORT_HEALTH_PRESENTATION).forEach(([status, presentation], index) => {
      xml = setCell(xml, `F${10 + index}`, presentation.label);
      xml = setCell(xml, `G${10 + index}`, counts[status as keyof typeof counts]);
    });
    const contributors = new Map<string, { name: string; entries: number }>();
    for (const entry of data.progressAudit?.entries || []) {
      const key = entry.submittedBy?.id || entry.submittedBy?.name || "unknown";
      const value = contributors.get(key) || { name: entry.submittedBy?.name || "Unknown", entries: 0 };
      value.entries++;
      contributors.set(key, value);
    }
    const rows = [...contributors.values()].slice(0, 20);
    for (let index = 0; index < 20; index++) {
      xml = setCell(xml, `H${11 + index}`, rows[index]?.name || null);
      xml = setCell(xml, `J${11 + index}`, rows[index]?.entries ?? null);
    }
    return xml;
  }

  private populateLegacyReport(xml: string, data: any) {
    xml = setCell(xml, "E4", progressCell(data.summary.expectedProgress));
    xml = setCell(xml, "B5", progressCell(data.summary.totalProjectProgress));
    xml = setCell(xml, "C5", progressCell(data.summary.variance));
    xml = setCell(xml, "D5", reportHealthLabel(data.summary.health));
    const history = (data.sCurve || []).filter((point: any) => point.date <= data.report.periodEnd);
    const points = history.slice(-20);
    const baseline = history.length > 20 ? history[history.length - 21] : null;
    let previousPlanned = baseline ? progressCell(baseline.planned)! : 0;
    let previousActual: number | null = baseline ? progressCell(baseline.actual) : 0;
    const periodColumns = ["B", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V"];
    for (let index = 0; index < periodColumns.length; index++) {
      const column = periodColumns[index];
      const point = points[index];
      const planned = point ? Number(point.planned || 0) / 100 : 0;
      const actual = progressCell(point?.actual);
      xml = setCell(xml, `${column}9`, point?.date.slice(5) || null);
      xml = setCell(xml, `${column}15`, point ? planned - previousPlanned : null);
      xml = setCell(xml, `${column}16`, point && actual !== null && previousActual !== null ? actual - previousActual : null);
      xml = setCell(xml, `${column}17`, point ? planned : null);
      xml = setCell(xml, `${column}18`, point ? actual : null);
      xml = setCell(xml, `${column}19`, point && actual !== null ? actual - planned : null);
      xml = setCell(xml, `${column}20`, null);
      if (point) { previousPlanned = planned; previousActual = actual; }
    }
    return xml;
  }

  private populateLegacyTimeline(xml: string, data: any, context: any) {
    const dates = (data.sCurve || []).slice(0, 35).map((point: any) => point.date);
    for (let index = 0; index < 35; index++) {
      xml = setCell(xml, `${columnName(7 + index)}4`, dates[index]?.slice(5) || null);
    }
    const subtasks = context.subtasks.slice(0, 46);
    for (let index = 0; index < 46; index++) {
      const projectedRow = 6 + index * 2;
      const actualRow = projectedRow + 1;
      const subtask = subtasks[index];
      const values: CellValue[] = subtask ? [
        index + 1,
        `${subtask.task.scope.name} / ${subtask.task.title} / ${subtask.title}`,
        progressCell(calculator.actualAt(subtask, this.endOfManilaDate(data.report.periodEnd))),
        Number(subtask.budgetAllocated || 0),
        Number(subtask.budgetPercent || 0) / 100,
        "PROJECTED",
      ] : [];
      for (let columnIndex = 0; columnIndex < 6; columnIndex++) {
        const column = columnName(columnIndex + 1);
        xml = setCell(xml, `${column}${projectedRow}`, values[columnIndex] ?? null);
        xml = setCell(xml, `${column}${actualRow}`, values[columnIndex] ?? null);
      }
      xml = setCell(xml, `F${actualRow}`, subtask ? "ACTUAL" : null);
      dates.forEach((date: string, dateIndex: number) => {
        const column = columnName(7 + dateIndex);
        const cutoff = this.endOfManilaDate(date);
        const projected = subtask
          ? calculator.expectedAt(subtask, cutoff, context.schedule)
          : null;
        const actual = subtask && date <= data.report.periodEnd ? calculator.actualAt(subtask, cutoff) : null;
        xml = setCell(xml, `${column}${projectedRow}`, projected === null ? null : projected / 100);
        xml = setCell(xml, `${column}${actualRow}`, actual === null ? null : actual / 100);
      });
    }
    return xml;
  }

  private populateProjectData(xml: string, data: any, project: any) {
    const values: CellValue[] = [
      `${data.report.type} PROJECT PROGRESS REPORT`,
      data.project.name,
      data.project.pin || "",
      locationText(data.project.location),
      project.businessUnit || "",
      project.entity || "",
      excelDate(data.project.startDate),
      excelDate(data.project.expectedEndDate),
      excelDate(data.report.periodEnd),
      excelDate(data.report.generatedAt),
      Number(data.project.totalBudget || 0),
      progressCell(data.summary.expectedProgress),
      progressCell(data.summary.totalProjectProgress),
      null,
      progressCell(data.summary.variance),
      null,
    ];
    values.forEach((value, index) => {
      xml = setCell(xml, `B${index + 2}`, value);
    });
    const counts = this.rawHealthCounts(data);
    Object.entries(REPORT_HEALTH_PRESENTATION).forEach(([status, presentation], index) => {
      xml = setCell(xml, `A${18 + index}`, presentation.label);
      xml = setCell(xml, `B${18 + index}`, counts[status as keyof typeof counts]);
    });
    return xml;
  }

  private populateTimelineData(xml: string, data: any, project: any) {
    const detailById = new Map<string, any>();
    for (const scope of data.detailedProgress || []) {
      detailById.set(scope.id, scope);
      for (const task of scope.tasks || []) {
        detailById.set(task.id, task);
        for (const subtask of task.subtasks || []) detailById.set(subtask.id, subtask);
      }
    }

    const rows: CellValue[][] = [];
    for (const scope of project.scopes) {
      const scopeDetail = detailById.get(scope.id);
      rows.push([
        rows.length + 1, scope.name, "", "", "SCOPE",
        progressCell(scopeDetail?.metrics?.actualProgress),
        Number(scope.budgetAllocated || 0), Number(scope.budgetPercent || 0) / 100,
        null, null, null, null, reportHealthLabel(scopeDetail?.metrics?.health), "", scope.description || "",
      ]);
      for (const task of scope.tasks) {
        const taskDetail = detailById.get(task.id);
        rows.push([
          rows.length + 1, scope.name, task.title, "", "TASK",
          progressCell(taskDetail?.metrics?.actualProgress),
          Number(task.budgetAllocated || 0), Number(task.budgetPercent || 0) / 100,
          null, null, null, null, reportHealthLabel(taskDetail?.metrics?.health), "", task.description || "",
        ]);
        for (const subtask of task.subtasks) {
          const subtaskDetail = detailById.get(subtask.id);
          rows.push([
            rows.length + 1, scope.name, task.title, subtask.title, "SUBTASK",
            progressCell(subtaskDetail?.metrics?.actualProgress),
            Number(subtask.budgetAllocated || 0), Number(subtask.budgetPercent || 0) / 100,
            excelDate(subtask.projectedStartDate), excelDate(subtask.projectedEndDate),
            excelDate(subtask.actualStartDate), excelDate(subtask.actualEndDate),
            reportHealthLabel(subtaskDetail?.metrics?.health), subtask.creator?.name || "", subtask.remarks || "",
          ]);
        }
      }
    }
    return this.populateGrid(xml, rows.slice(0, 250), 250, 15);
  }

  private populateSCurveData(xml: string, data: any) {
    const rows = (data.sCurve || []).slice(0, 366).map((point: any) => [
      excelDate(point.date),
      Number(point.planned || 0) / 100,
      progressCell(point.actual),
      point.forecast === null || point.forecast === undefined
        ? null
        : Number(point.forecast) / 100,
    ]);
    return this.populateGrid(xml, rows, 366, 4);
  }

  private populateProgressLogs(xml: string, data: any) {
    const rows = (data.progressAudit?.entries || []).slice(0, 1000).map((entry: any) => [
      excelDate(entry.date),
      data.project.name,
      entry.scope?.name || "",
      entry.task?.title || "",
      entry.subtask?.title || "",
      progressCell(entry.dailyProgress),
      progressCell(entry.progressAfter),
      entry.subtaskStatusAfter || "",
      entry.remarks || "",
      entry.submittedBy?.name || "",
      "",
      entry.coordinates?.latitude ?? null,
      entry.coordinates?.longitude ?? null,
    ]);
    return this.populateGrid(xml, rows, 1000, 13);
  }

  private populateGrid(
    xml: string,
    rows: CellValue[][],
    maximumRows: number,
    columns: number
  ) {
    for (let rowIndex = 0; rowIndex < maximumRows; rowIndex++) {
      for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
        xml = setCell(
          xml,
          `${columnName(columnIndex + 1)}${rowIndex + 2}`,
          rows[rowIndex]?.[columnIndex] ?? null
        );
      }
    }
    return xml;
  }

  private rawHealthCounts(data: any) {
    const counts = { DANGER: 0, WARNING: 0, HEALTHY: 0, NOT_STARTED: 0, UNCLASSIFIED: 0 };
    for (const scope of data.detailedProgress || []) {
      for (const task of scope.tasks || []) {
        for (const subtask of task.subtasks || []) {
          const health = subtask.metrics?.health as keyof typeof counts;
          if (health in counts) counts[health]++;
          else counts.UNCLASSIFIED++;
        }
      }
    }
    return counts;
  }

  private async applyHealthPresentation(zip: JSZip, data: any) {
    const presentations = Object.entries(REPORT_HEALTH_PRESENTATION);
    const counts = this.rawHealthCounts(data);
    const stylesEntry = zip.file("xl/styles.xml");
    const styleByLabel = new Map<string, number>();
    if (stylesEntry) {
      let styles = await stylesEntry.async("string");
      const prefix = styles.includes("<x:styleSheet") ? "x:" : "";
      const fontCount = Number(styles.match(/<(?:x:)?fonts\b[^>]*count="(\d+)"/)?.[1]);
      const xfCount = Number(styles.match(/<(?:x:)?cellXfs\b[^>]*count="(\d+)"/)?.[1]);
      if (Number.isFinite(fontCount) && Number.isFinite(xfCount)) {
        const fonts = presentations.map(([, item]) =>
          `<${prefix}font><${prefix}b/><${prefix}color rgb="FF${item.color.slice(1).toUpperCase()}"/><${prefix}sz val="11"/><${prefix}name val="Calibri"/></${prefix}font>`
        ).join("");
        const xfs = presentations.map(([, item], index) => {
          styleByLabel.set(item.label, xfCount + index);
          return `<${prefix}xf numFmtId="0" fontId="${fontCount + index}" fillId="0" borderId="0" xfId="0" applyFont="1"/>`;
        }).join("");
        styles = styles
          .replace(/(<(?:x:)?fonts\b[^>]*count=")\d+(")/, (_match, before, after) => `${before}${fontCount + presentations.length}${after}`)
          .replace(`</${prefix}fonts>`, `${fonts}</${prefix}fonts>`)
          .replace(/(<(?:x:)?cellXfs\b[^>]*count=")\d+(")/, (_match, before, after) => `${before}${xfCount + presentations.length}${after}`)
          .replace(`</${prefix}cellXfs>`, `${xfs}</${prefix}cellXfs>`);
        zip.file("xl/styles.xml", styles);
      }
    }

    for (const name of Object.keys(zip.files)) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        let xml = await zip.file(name)!.async("string");
        xml = xml.replace(/<(?:x:)?c\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:x:)?c>)/g, (cell) => {
          const label = cell.match(/<(?:x:)?(?:t|v)>([^<]*)<\/(?:x:)?(?:t|v)>/)?.[1];
          const style = label ? styleByLabel.get(label) : undefined;
          if (style === undefined) return cell;
          return cell.replace(/^(<(?:x:)?c\b)([^>]*)>/, (_match, tag, attributes) =>
            `${tag}${attributes.replace(/\s+s="[^"]*"/, "")} s="${style}">`
          );
        });
        zip.file(name, xml);
      } else if (/^xl\/(?:drawings\/)?charts\/chart\d+\.xml$/.test(name)) {
        let xml = await zip.file(name)!.async("string");
        if (!/health/i.test(xml)) continue;
        const labels = presentations.map(([, item], index) =>
          `<c:pt idx="${index}"><c:v>${xmlEscape(item.label)}</c:v></c:pt>`
        ).join("");
        const values = presentations.map(([status], index) =>
          `<c:pt idx="${index}"><c:v>${counts[status as keyof typeof counts]}</c:v></c:pt>`
        ).join("");
        const colors = presentations.map(([, item], index) =>
          `<c:dPt><c:idx val="${index}"/><c:spPr><a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:srgbClr val="${item.color.slice(1).toUpperCase()}"/></a:solidFill></c:spPr></c:dPt>`
        ).join("");
        xml = xml
          .replace(/<c:cat>[\s\S]*?<\/c:cat>/g, `<c:cat><c:strLit><c:ptCount val="5"/>${labels}</c:strLit></c:cat>`)
          .replace(/<c:val>[\s\S]*?<\/c:val>/g, `<c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="5"/>${values}</c:numLit></c:val>`)
          .replace(/<c:dPt>[\s\S]*?<\/c:dPt>/g, "")
          .replace(/<c:cat>/g, `${colors}<c:cat>`);
        zip.file(name, xml);
      }
    }
  }

  private async loadLegacyContext(projectId: string, curve: any[], cutoff: Date) {
    const start = curve[0]?.date ? this.startOfManilaDate(curve[0].date) : new Date();
    const end = curve[curve.length - 1]?.date
      ? this.endOfManilaDate(curve[curve.length - 1].date)
      : new Date();
    const activeAtCutoff = this.activeAtCutoff(cutoff);
    const [project, holidays, subtasks] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.holiday.findMany({ where: { date: { gte: start, lte: end } } }),
      prisma.subtask.findMany({
        where: {
          ...activeAtCutoff,
          task: { ...activeAtCutoff, scope: { projectId, ...activeAtCutoff } },
        },
        include: {
          progressLogs: { where: { date: { lte: cutoff } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
          task: { include: { scope: true } },
        },
        orderBy: [{ task: { order: "asc" } }, { order: "asc" }],
      }),
    ]);
    const schedule: WorkSchedule = {
      monday: project.monday,
      tuesday: project.tuesday,
      wednesday: project.wednesday,
      thursday: project.thursday,
      friday: project.friday,
      saturday: project.saturday,
      sunday: project.sunday,
      includeHolidays: project.includeHolidays,
      holidayKeys: new Set(holidays.map((holiday) => utcToManilaDateKey(holiday.date))),
    };
    return { subtasks: subtasks as unknown as CalculableSubtask[], schedule };
  }

  private startOfManilaDate(date: string) {
    return new Date(new Date(`${date}T00:00:00.000Z`).getTime() - MANILA_OFFSET_MS);
  }

  private activeAtCutoff(cutoff: Date) {
    return { createdAt: { lte: cutoff }, OR: [{ deletedAt: null }, { deletedAt: { gt: cutoff } }] };
  }

  private endOfManilaDate(date: string) {
    return new Date(
      new Date(`${date}T00:00:00.000Z`).getTime() + DAY_MS - MANILA_OFFSET_MS - 1
    );
  }

  private async updateLegacyChartRanges(zip: JSZip, pointCount: number) {
    for (const name of ["xl/drawings/charts/chart1.xml", "xl/charts/chart1.xml"]) {
      const entry = zip.file(name);
      if (!entry) continue;
      let xml = await entry.async("string");
      const lastRow = 9 + Math.max(1, Math.min(90, pointCount));
      for (const column of ["A", "B", "C", "D"]) {
        const pattern = new RegExp(`\\$${column}\\$10:\\$${column}\\$\\d+`, "g");
        xml = xml.replace(pattern, `$${column}$10:$${column}$${lastRow}`);
      }
      zip.file(name, xml);
    }
  }

  private async forceRecalculation(zip: JSZip) {
    const entry = zip.file("xl/workbook.xml");
    if (!entry) return;
    let xml = await entry.async("string");
    const prefixed = xml.includes("<x:workbook");
    const prefix = prefixed ? "x:" : "";
    if (/<(?:x:)?calcPr\b/.test(xml)) {
      xml = xml.replace(
        /<(?:x:)?calcPr\b[^>]*\/?>/,
        `<${prefix}calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>`
      );
    } else {
      xml = xml.replace(
        `</${prefix}workbook>`,
        `<${prefix}calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></${prefix}workbook>`
      );
    }
    zip.file("xl/workbook.xml", xml);
  }
}

export const reportExcelService = new ReportExcelService();
