import assert from "node:assert/strict";
import { reportCalculationService as calculator } from "../services/report-calculation.service";
import { parseReportPeriod } from "../validators/report-request.validator";

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
assert.equal(
  calculator.health(70, 80, { criticalBelow: -15, healthyAtOrAbove: -5 }),
  "AT_RISK"
);
assert.equal(
  calculator.health(60, 80, { criticalBelow: -15, healthyAtOrAbove: -5 }),
  "DELAYED"
);

console.log("Report foundation tests passed");
