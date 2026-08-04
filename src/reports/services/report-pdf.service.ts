import fs from "fs";
import path from "path";
import Handlebars from "handlebars";
import puppeteer, { Browser } from "puppeteer";
import { reportChartService } from "./report-chart.service";

let browserPromise: Promise<Browser> | null = null;

function getBrowser() {
  if (!browserPromise) {
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
    const noSandbox = process.env.PUPPETEER_NO_SANDBOX === "true";
    browserPromise = puppeteer
      .launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: noSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

export class ReportPdfService {
  private template: Handlebars.TemplateDelegate | null = null;

  async generate(reportData: any): Promise<Buffer> {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      await this.restrictNetwork(page);
      const html = this.render(reportData);
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 15_000 }).catch(() => undefined);
      await page.emulateMediaType("print");
      const bytes = await page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "12mm", right: "10mm", bottom: "15mm", left: "10mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#64748b;padding:0 10mm;display:flex;justify-content:space-between;"><span>V.I.S.I.O.N Project Management Tools</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
      });
      return Buffer.from(bytes);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async closeBrowser() {
    const activeBrowser = browserPromise;
    browserPromise = null;
    if (activeBrowser) {
      const browser = await activeBrowser.catch(() => null);
      await browser?.close().catch(() => undefined);
    }
  }

  private render(data: any) {
    if (!this.template) {
      const templatePath = path.join(
        process.cwd(),
        "src",
        "reports",
        "templates",
        "project-report.hbs"
      );
      this.template = Handlebars.compile(fs.readFileSync(templatePath, "utf8"), {
        strict: false,
        noEscape: false,
      });
    }
    const formatPercent = (value: unknown) =>
      value === null || value === undefined || !Number.isFinite(Number(value))
        ? "N/A"
        : `${Number(value).toFixed(2)}%`;
    const formatDate = (value: unknown) => {
      if (!value) return "N/A";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
        ? new Date(`${value}T00:00:00+08:00`)
        : new Date(String(value));
      return new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date);
    };

    Handlebars.registerHelper("percent", formatPercent);
    Handlebars.registerHelper("date", formatDate);
    Handlebars.registerHelper("upper", (value) => String(value || "").replace(/_/g, " "));
    Handlebars.registerHelper("eq", (left, right) => left === right);
    Handlebars.registerHelper("safe", (value) => new Handlebars.SafeString(String(value || "")));

    return this.template({
      ...data,
      reportTitle: data.report.type === "DAILY" ? "DAILY REPORT" : "WEEKLY REPORT",
      periodLabel:
        data.report.type === "DAILY"
          ? formatDate(data.report.periodEnd)
          : `${formatDate(data.report.periodStart)} – ${formatDate(data.report.periodEnd)}`,
      sCurveSvg: reportChartService.buildSCurveSvg(data.sCurve),
      healthSvg: reportChartService.buildHealthDonutSvg(data.detailedProgress),
    });
  }

  private async restrictNetwork(page: any) {
    const configuredHosts = (process.env.REPORT_IMAGE_ALLOWED_HOSTS || "placehold.co")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    await page.setRequestInterception(true);
    page.on("request", (request: any) => {
      const url = request.url();
      if (url === "about:blank" || url.startsWith("data:")) return request.continue();
      try {
        const host = new URL(url).hostname.toLowerCase();
        const allowed = configuredHosts.some(
          (entry) => host === entry || host.endsWith(`.${entry}`)
        );
        return allowed ? request.continue() : request.abort("blockedbyclient");
      } catch {
        return request.abort("blockedbyclient");
      }
    });
  }
}

export const reportPdfService = new ReportPdfService();
