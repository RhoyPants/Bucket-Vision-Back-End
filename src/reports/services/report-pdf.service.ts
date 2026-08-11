import fs from "fs";
import path from "path";
import Handlebars from "handlebars";
import puppeteer, { Browser } from "puppeteer";
import { fetchSharePointFile } from "../../services/sharepoint-upload.service";
import { reportChartService } from "./report-chart.service";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser() {
  if (browserPromise) {
    const cached = await browserPromise.catch(() => null);
    if (cached?.connected) return cached;
    browserPromise = null;
  }

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  const noSandbox = process.env.PUPPETEER_NO_SANDBOX === "true";
  const launching = puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: noSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });
  browserPromise = launching;

  try {
    const browser = await launching;
    browser.once("disconnected", () => {
      if (browserPromise === launching) browserPromise = null;
    });
    return browser;
  } catch (error) {
    if (browserPromise === launching) browserPromise = null;
    throw error;
  }
}

const isBrowserConnectionError = (error: unknown) => {
  const candidate = error as { name?: string; message?: string };
  return (
    candidate?.name === "ConnectionClosedError" ||
    candidate?.name === "TargetCloseError" ||
    /connection closed|target closed|session closed/i.test(candidate?.message || "")
  );
};

export class ReportPdfService {
  private template: Handlebars.TemplateDelegate | null = null;

  async generate(reportData: any): Promise<Buffer> {
    try {
      return await this.generateWithBrowser(reportData);
    } catch (error) {
      if (!isBrowserConnectionError(error)) throw error;
      browserPromise = null;
      return this.generateWithBrowser(reportData);
    }
  }

  private async generateWithBrowser(reportData: any): Promise<Buffer> {
    const browser = await getBrowser();
    let page: Awaited<ReturnType<Browser["newPage"]>> | null = null;
    try {
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      await this.restrictNetwork(page);
      const html = await this.render(reportData);
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
      await page?.close().catch(() => undefined);
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

  private async render(data: any) {
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

    const logoPath = path.join(process.cwd(), "uploads", "GVI_LOGO_DARK.png");
    const logoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
    const photos = await Promise.all(
      (data.photos || []).map(async (photo: any) => {
        if (!photo.url) return { ...photo, embeddedUrl: null };
        if (String(photo.url).startsWith("data:image/")) {
          return { ...photo, embeddedUrl: photo.url };
        }
        try {
          const file = await fetchSharePointFile(photo.url);
          const contentType = file.contentType.split(";", 1)[0].trim().toLowerCase();
          if (!contentType.startsWith("image/")) {
            throw new Error(`Unsupported photo content type: ${contentType}`);
          }
          return {
            ...photo,
            embeddedUrl: `data:${contentType};base64,${file.buffer.toString("base64")}`,
          };
        } catch (error) {
          console.warn(
            `Unable to embed report photo ${photo.progressLogId || "unknown"}:`,
            error instanceof Error ? error.message : String(error)
          );
          return { ...photo, embeddedUrl: null };
        }
      })
    );

    return this.template({
      ...data,
      photos,
      logoDataUri,
      reportTitle: data.report.type === "DAILY" ? "DAILY REPORT" : "WEEKLY REPORT",
      periodLabel:
        data.report.type === "DAILY"
          ? formatDate(data.report.periodEnd)
          : `${formatDate(data.report.periodStart)} – ${formatDate(data.report.periodEnd)}`,
      sCurveSvg: reportChartService.buildSCurveSvg(
        data.sCurve,
        data.report.periodStart,
        data.report.periodEnd
      ),
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
