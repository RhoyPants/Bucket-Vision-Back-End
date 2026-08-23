import { strict as assert } from "assert";
import { calculateCpm, CpmCycleError } from "./cpm.calculator";

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
assert.deepEqual(result.values.get("A"), { earlyStart: 1, earlyFinish: 3, lateStart: 1, lateFinish: 3, slackDays: 0, isCritical: true });
assert.deepEqual(result.values.get("B"), { earlyStart: 4, earlyFinish: 8, lateStart: 4, lateFinish: 8, slackDays: 0, isCritical: true });
assert.deepEqual(result.values.get("C"), { earlyStart: 4, earlyFinish: 5, lateStart: 7, lateFinish: 8, slackDays: 3, isCritical: false });
assert.deepEqual(result.values.get("D"), { earlyStart: 9, earlyFinish: 12, lateStart: 9, lateFinish: 12, slackDays: 0, isCritical: true });
assert.deepEqual(result.criticalPaths, [["A", "B", "D"]]);

const emptyGraph = calculateCpm(
  [{ id: "A", duration: 2 }, { id: "B", duration: 5 }],
  [],
);
assert.equal(emptyGraph.projectDurationDays, 5);
assert.equal(emptyGraph.values.get("A")?.slackDays, 3);
assert.equal(emptyGraph.values.get("B")?.isCritical, true);
assert.deepEqual(emptyGraph.criticalPaths, [["B"]]);

assert.throws(
  () => calculateCpm(
    [{ id: "A", duration: 1 }, { id: "B", duration: 1 }],
    [{ predecessorId: "A", successorId: "B" }, { predecessorId: "B", successorId: "A" }],
  ),
  (error) => error instanceof CpmCycleError && error.cycle.join(",") === "A,B,A",
);

console.log("CPM calculator tests passed");
