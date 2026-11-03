import assert from "node:assert/strict";
import {
  evaluateScheduleHealth, expectedProgressAt, rollupHealth, summarizeHealth,
  validateWarningBelow, WorkSchedule,
} from "./schedule-health";

const schedule: WorkSchedule = {
  monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
  saturday: false, sunday: false, includeHolidays: true, holidayKeys: new Set(),
};
const date = (day: string) => new Date(`${day}T09:00:00+08:00`);
const base = {
  actualProgress: 90, startDate: date("2026-10-20"), endDate: date("2026-10-29"),
  asOf: date("2026-10-28"), schedule,
};
const evaluate = (input: Partial<Parameters<typeof evaluateScheduleHealth>[0]> = {}) =>
  evaluateScheduleHealth({ ...base, ...input });

assert.equal(evaluate({ actualProgress: 50 }).status, "WARNING");
assert.equal(evaluate({ asOf: date("2026-10-29"), actualProgress: 99 }).status, "WARNING");
for (const actualProgress of [0, 90, 99]) {
  assert.equal(evaluate({ asOf: date("2026-10-30"), actualProgress }).status, "DANGER");
}
assert.equal(evaluate({ actualProgress: 0, asOf: date("2026-10-19") }).status, "NOT_STARTED");
assert.equal(evaluate({ actualProgress: 0, asOf: date("2026-10-21") }).status, "WARNING");
assert.equal(evaluate({
  actualProgress: 0, asOf: date("2026-10-19"), actualStartDate: date("2026-10-18"),
}).status, "HEALTHY");
assert.equal(evaluate({ actualProgress: 100, asOf: date("2026-11-01") }).status, "HEALTHY");
assert.equal(evaluate({ actualProgress: 100, startDate: null, endDate: null }).status, "HEALTHY");
for (const actualProgress of [null, NaN, Infinity, -1, 100.01]) {
  const result = evaluate({ actualProgress });
  assert.equal(result.status, "UNCLASSIFIED");
  assert.equal(result.actualProgress, null);
  assert.equal(result.variance, null);
}
for (const input of [
  { startDate: null }, { endDate: null }, { startDate: new Date("invalid") },
  { startDate: date("2026-10-30") },
]) assert.equal(evaluate(input).status, "UNCLASSIFIED");
assert.equal(evaluate({ forecastEndDate: date("2026-10-30") }).status, "WARNING");
assert.equal(evaluate({ forecastEndDate: new Date("invalid") }).status, "HEALTHY");
assert.equal(evaluate({ asOf: new Date("2026-10-29T15:59:59.999Z") }).status, "WARNING");
assert.equal(evaluate({ asOf: new Date("2026-10-29T16:00:00.000Z") }).status, "DANGER");
assert.throws(() => evaluate({ asOf: new Date("invalid") }), /evaluation date/);

const milestone = { startDate: date("2026-10-29"), endDate: date("2026-10-29"), actualProgress: 0 };
assert.equal(evaluate({ ...milestone, asOf: date("2026-10-28") }).status, "NOT_STARTED");
assert.equal(evaluate({ ...milestone, asOf: date("2026-10-29") }).status, "WARNING");
assert.equal(evaluate({ ...milestone, asOf: date("2026-10-30") }).status, "DANGER");

assert.equal(expectedProgressAt(date("2026-09-15"), date("2026-09-14"), date("2026-09-18"), schedule), 40);
const holidays = { ...schedule, holidayKeys: new Set(["2026-09-14"]) };
assert.equal(expectedProgressAt(date("2026-09-15"), date("2026-09-14"), date("2026-09-18"), holidays), 25);
assert.equal(expectedProgressAt(date("2026-09-15"), date("2026-09-14"), date("2026-09-18"), { ...holidays, includeHolidays: false }), 40);
assert.equal(expectedProgressAt(date("2026-09-19"), date("2026-09-18"), date("2026-09-21"), schedule), 50);
const tinyDelay = evaluate({
  startDate: date("2026-10-26"), endDate: date("2026-10-28"),
  asOf: date("2026-10-26"), actualProgress: 33.333,
});
assert.equal(tinyDelay.status, "WARNING");
assert.ok(tinyDelay.variance! < 0 && tinyDelay.variance! > -0.001);
const summary = summarizeHealth([
  { status: "DANGER" }, { status: "WARNING" }, { status: "HEALTHY" },
  { status: "NOT_STARTED" }, { status: "UNCLASSIFIED" },
]);
assert.deepEqual(summary, { total: 5, danger: 1, warning: 1, healthy: 1, notStarted: 1, unclassified: 1 });
assert.equal(rollupHealth(summary), "DANGER");
assert.equal(rollupHealth(summarizeHealth([])), "UNCLASSIFIED");
assert.equal(rollupHealth(summarizeHealth([{ status: "NOT_STARTED" }])), "NOT_STARTED");
assert.equal(rollupHealth(summarizeHealth([{ status: "WARNING" }, { status: "HEALTHY" }])), "WARNING");
assert.equal(rollupHealth(summarizeHealth([{ status: "HEALTHY" }, { status: "UNCLASSIFIED" }, { status: "NOT_STARTED" }])), "HEALTHY");
assert.equal(rollupHealth(summarizeHealth([{ status: "UNCLASSIFIED" }])), "UNCLASSIFIED");
for (const input of [1, -1, "0", null, NaN, Infinity]) assert.throws(() => validateWarningBelow(input), /not supported/);
assert.throws(() => validateWarningBelow(undefined, true), /not supported/);
validateWarningBelow(undefined);
validateWarningBelow(0, true);
console.log("Schedule health V2 evaluator tests passed");
