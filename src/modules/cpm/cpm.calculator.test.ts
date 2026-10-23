import { strict as assert } from "assert";
import { calculateCpm, CpmCycleError } from "./cpm.calculator";
import { calendarFor, durationDaysForRange } from "./cpm.service";

const weekdays = calendarFor({
  monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
  saturday: false, sunday: false, includeHolidays: true,
}, []);
assert.equal(
  durationDaysForRange(new Date("2026-10-20T00:00:00.000Z"), new Date("2026-10-24T00:00:00.000Z"), weekdays),
  4,
);
const weekdaysWithHoliday = calendarFor({
  monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
  saturday: false, sunday: false, includeHolidays: true,
}, [new Date("2026-10-22T00:00:00.000Z")]);
assert.equal(
  durationDaysForRange(new Date("2026-10-20T00:00:00.000Z"), new Date("2026-10-24T00:00:00.000Z"), weekdaysWithHoliday),
  3,
);
assert.equal(durationDaysForRange(null, null, weekdays), null);

const result = calculateCpm(
  [
    { id: "A", duration: 3 },
    { id: "B", duration: 5 },
    { id: "C", duration: 2 },
    { id: "D", duration: 4 },
  ],
  [
    { predecessorId: "A", successorId: "B" },
    { predecessorId: "A", successorId: "C" },
    { predecessorId: "B", successorId: "D" },
    { predecessorId: "C", successorId: "D" },
  ],
);

assert.equal(result.projectDurationDays, 12);
assert.deepEqual(result.values.get("A"), { earlyStart: 0, earlyFinish: 3, lateStart: 0, lateFinish: 3, slackDays: 0, isCritical: true });
assert.deepEqual(result.values.get("B"), { earlyStart: 3, earlyFinish: 8, lateStart: 3, lateFinish: 8, slackDays: 0, isCritical: true });
assert.deepEqual(result.values.get("C"), { earlyStart: 3, earlyFinish: 5, lateStart: 6, lateFinish: 8, slackDays: 3, isCritical: false });
assert.deepEqual(result.values.get("D"), { earlyStart: 8, earlyFinish: 12, lateStart: 8, lateFinish: 12, slackDays: 0, isCritical: true });
assert.deepEqual(result.criticalPaths, [["A", "B", "D"]]);

// Standard forward/backward-pass example: A(3) -> B(4) -> D(5) -> G(4) -> H(3).
const reference = calculateCpm(
  [
    { id: "A", duration: 3 }, { id: "B", duration: 4 },
    { id: "C", duration: 2 }, { id: "D", duration: 5 },
    { id: "E", duration: 1 }, { id: "F", duration: 2 },
    { id: "G", duration: 4 }, { id: "H", duration: 3 },
  ],
  [
    { predecessorId: "A", successorId: "B" }, { predecessorId: "A", successorId: "C" },
    { predecessorId: "B", successorId: "D" }, { predecessorId: "C", successorId: "E" },
    { predecessorId: "C", successorId: "F" }, { predecessorId: "D", successorId: "G" },
    { predecessorId: "E", successorId: "G" }, { predecessorId: "F", successorId: "H" },
    { predecessorId: "G", successorId: "H" },
  ],
);
assert.equal(reference.projectDurationDays, 19);
assert.deepEqual(reference.values.get("A"), { earlyStart: 0, earlyFinish: 3, lateStart: 0, lateFinish: 3, slackDays: 0, isCritical: true });
assert.deepEqual(reference.values.get("H"), { earlyStart: 16, earlyFinish: 19, lateStart: 16, lateFinish: 19, slackDays: 0, isCritical: true });
assert.deepEqual(reference.criticalPaths, [["A", "B", "D", "G", "H"]]);

const emptyGraph = calculateCpm(
  [{ id: "A", duration: 2 }, { id: "B", duration: 5 }],
  [],
);
assert.equal(emptyGraph.projectDurationDays, 0);
assert.equal(emptyGraph.values.size, 0);
assert.deepEqual(emptyGraph.criticalPaths, []);

const disconnectedActivity = calculateCpm(
  [
    { id: "A", duration: 3 },
    { id: "B", duration: 4 },
    { id: "management", duration: 70 },
  ],
  [{ predecessorId: "A", successorId: "B" }],
);
assert.equal(disconnectedActivity.projectDurationDays, 7);
assert.equal(disconnectedActivity.values.has("management"), false);
assert.deepEqual(disconnectedActivity.criticalPaths, [["A", "B"]]);

assert.throws(
  () => calculateCpm(
    [{ id: "A", duration: 1 }, { id: "B", duration: 1 }],
    [{ predecessorId: "A", successorId: "B" }, { predecessorId: "B", successorId: "A" }],
  ),
  (error) => error instanceof CpmCycleError && error.cycle.join(",") === "A,B,A",
);

console.log("CPM calculator tests passed");
