const escapeXml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export class ReportChartService {
  buildSCurveSvg(
    points: Array<{ date: string; planned: number; actual: number | null }>,
    periodStart?: string,
    periodEnd?: string
  ) {
    const width = 820;
    const height = 330;
    const margin = { top: 25, right: 24, bottom: 48, left: 55 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    if (!points.length) {
      return `<svg viewBox="0 0 ${width} ${height}" role="img"><text x="50%" y="50%" text-anchor="middle" fill="#64748b">No S-curve data available</text></svg>`;
    }

    const x = (index: number) =>
      margin.left + (points.length === 1 ? 0 : (index / (points.length - 1)) * plotWidth);
    const y = (value: number) =>
      margin.top + plotHeight - (Math.max(0, Math.min(100, value)) / 100) * plotHeight;
    const path = (key: "planned" | "actual") => {
      let started = false;
      return points
        .map((point, index) => {
          const value = point[key];
          if (value === null) {
            started = false;
            return "";
          }
          const command = started ? "L" : "M";
          started = true;
          return `${command}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
        })
        .filter(Boolean)
        .join(" ");
    };
    const tickIndexes = Array.from(
      new Set(
        Array.from({ length: Math.min(16, points.length) }, (_, index) =>
          Math.round((index / Math.max(1, Math.min(16, points.length) - 1)) * (points.length - 1))
        )
      )
    );
    const marker = (date: string | undefined, label: string) => {
      if (!date) return "";
      const index = points.findIndex((point) => point.date === date.slice(0, 10));
      if (index < 0) return "";
      const markerX = x(index);
      return `<g>
        <line x1="${markerX}" y1="${margin.top}" x2="${markerX}" y2="${margin.top + plotHeight}" stroke="#ef4444" stroke-width="2"/>
        <text x="${markerX - 5}" y="${margin.top + 13}" text-anchor="end" font-size="10" fill="#dc2626">${escapeXml(label)}</text>
      </g>`;
    };
    const dots = (key: "planned" | "actual", color: string) =>
      points
        .map((point, index) => {
          const value = point[key];
          if (value === null) return "";
          return `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="2.2" fill="#fff" stroke="${color}" stroke-width="1.5"/>`;
        })
        .join("");

    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Planned versus actual S-curve">
        <rect width="${width}" height="${height}" fill="#fff"/>
        ${[0, 25, 50, 75, 100]
          .map(
            (value) => `
              <line x1="${margin.left}" y1="${y(value)}" x2="${width - margin.right}" y2="${y(value)}" stroke="#dbe5f1" stroke-dasharray="3 4"/>
              <text x="${margin.left - 9}" y="${y(value) + 4}" text-anchor="end" font-size="11" fill="#64748b">${value}%</text>`
          )
          .join("")}
        ${tickIndexes
          .map(
            (index) => `
              <line x1="${x(index)}" y1="${margin.top}" x2="${x(index)}" y2="${margin.top + plotHeight}" stroke="#eef3f8"/>
              <text x="${x(index)}" y="${height - 20}" text-anchor="middle" font-size="9" fill="#64748b">${escapeXml(points[index].date.slice(5))}</text>`
          )
          .join("")}
        <path d="${path("planned")}" fill="none" stroke="#2563eb" stroke-width="3"/>
        <path d="${path("actual")}" fill="none" stroke="#16a34a" stroke-width="3"/>
        ${dots("planned", "#2563eb")}
        ${dots("actual", "#16a34a")}
        ${periodStart === periodEnd
          ? marker(periodStart, "Report Date")
          : `${marker(periodStart, "Week Start")}${marker(periodEnd, "Week End")}`}
        <g transform="translate(${margin.left + plotWidth / 2 - 145},${height - 4})">
          <line x1="0" y1="0" x2="22" y2="0" stroke="#16a34a" stroke-width="3"/>
          <text x="28" y="4" font-size="11" fill="#334155">Actual Progress</text>
          <line x1="140" y1="0" x2="162" y2="0" stroke="#2563eb" stroke-width="3"/>
          <text x="168" y="4" font-size="11" fill="#334155">Planned Progress</text>
        </g>
      </svg>`;
  }

  buildHealthDonutSvg(detailedProgress: any[]) {
    const health = { HEALTHY: 0, AT_RISK: 0, DELAYED: 0, UNCLASSIFIED: 0 };
    for (const scope of detailedProgress || []) {
      for (const task of scope.tasks || []) {
        for (const subtask of task.subtasks || []) {
          const key = subtask.metrics?.health as keyof typeof health;
          if (key in health) health[key]++;
        }
      }
    }
    const total = Object.values(health).reduce((sum, value) => sum + value, 0);
    const colors = {
      HEALTHY: "#16a34a",
      AT_RISK: "#f59e0b",
      DELAYED: "#dc2626",
      UNCLASSIFIED: "#94a3b8",
    };
    const radius = 63;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const circles = Object.entries(health)
      .map(([key, value]) => {
        const length = total ? (value / total) * circumference : 0;
        const circle = `<circle cx="200" cy="92" r="${radius}" fill="none" stroke="${colors[key as keyof typeof colors]}" stroke-width="22" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 200 92)"/>`;
        offset += length;
        return circle;
      })
      .join("");

    const labels = [
      ["HEALTHY", "Healthy"],
      ["AT_RISK", "At Risk"],
      ["DELAYED", "Delayed"],
      ["UNCLASSIFIED", "Unclassified"],
    ]
      .map(([key, label], index) => {
        const value = health[key as keyof typeof health];
        const percentage = total ? Math.round((value / total) * 100) : 0;
        const barWidth = total ? (value / total) * 135 : 0;
        return `<g transform="translate(22,${205 + index * 27})">
          <circle cx="6" cy="6" r="6" fill="${colors[key as keyof typeof colors]}"/>
          <text x="20" y="10" font-size="12" fill="#334155">${label}</text>
          <rect x="105" y="0" width="135" height="10" rx="5" fill="#e8edf3"/>
          <rect x="105" y="0" width="${barWidth}" height="10" rx="5" fill="${colors[key as keyof typeof colors]}"/>
          <text x="350" y="10" text-anchor="end" font-size="12" font-weight="700" fill="#0f172a">${value} (${percentage}%)</text>
        </g>`;
      })
      .join("");

    return `<svg viewBox="0 0 400 325" role="img" aria-label="Work health distribution">
      ${circles}
      <text x="200" y="89" text-anchor="middle" font-size="28" font-weight="700" fill="#0f172a">${total}</text>
      <text x="200" y="108" text-anchor="middle" font-size="10" fill="#64748b">SUBTASKS</text>
      ${labels}
    </svg>`;
  }
}

export const reportChartService = new ReportChartService();
