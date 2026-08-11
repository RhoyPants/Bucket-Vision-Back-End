import assert from "node:assert/strict";
import { calculateProgressPlan, parseDailyPercent, roundProgress, sumProgress } from "./progress-precision";

function expectInvalid(value: unknown, message: RegExp) {
  assert.throws(() => parseDailyPercent(value), message);
}

assert.equal(parseDailyPercent(1), 1);
assert.equal(parseDailyPercent(1.5), 1.5);
assert.equal(parseDailyPercent(1.25), 1.25);
expectInvalid(1.234, /at most 2 decimal places/);
expectInvalid(0, /greater than 0/);
expectInvalid(-1, /greater than 0/);
expectInvalid("abc", /must be a number/);
expectInvalid(100.01, /at most 100/);

assert.equal(roundProgress(99.99900000000004), 100);
assert.equal(sumProgress([3.2, 3.2, 3.2]), 9.6);
assert.equal(sumProgress([99.99, 0.01]), 100);
assert.equal(Number(sumProgress([3.2, 3.2, 3.2]).toFixed(2)), 9.6);

assert.throws(() => calculateProgressPlan([99.99, 0.02], 0), /exceed 100.00/);
assert.throws(() => calculateProgressPlan([40, 60], 2), /Complete all checklist items/);
assert.deepEqual(calculateProgressPlan([40, 60], 0), { cumulativeUnits: [4000, 10000], totalUnits: 10000, status: 2 });
assert.equal(calculateProgressPlan([40, 50], 0).status, 1); // editing a completed log downward
assert.equal(calculateProgressPlan([40], 0).status, 1); // deleting a log from a completed subtask

// The service surrounds this calculation with a per-subtask transaction lock.
// Re-evaluating the second concurrent addition against the committed total must fail.
const firstConcurrentTotal = calculateProgressPlan([60, 40], 0).totalUnits;
assert.equal(firstConcurrentTotal, 10000);
assert.throws(() => calculateProgressPlan([60, 40, 40], 0), /exceed 100.00/);

console.log("progress precision tests passed");
