import assert from "node:assert/strict";
import {
  assertMlbPropsReleaseDoesNotRegress,
  compareMlbPropsReleaseIds,
  parseMlbPropsReleaseOrder,
} from "../lib/mlb/props/releaseOrdering";

assert.deepEqual(parseMlbPropsReleaseOrder("mlb_props_2026_07_28_r14"), {
  releaseId: "mlb_props_2026_07_28_r14",
  dateRank: 20260728,
  revision: 14,
});
assert.equal(parseMlbPropsReleaseOrder("mlb_props_2026_02_30_r1"), null);
assert.equal(compareMlbPropsReleaseIds("mlb_props_2026_07_28_r14", "mlb_props_2026_07_27_r99"), 1);
assert.equal(compareMlbPropsReleaseIds("mlb_props_2026_07_28_r14", "mlb_props_2026_07_28_r13"), 1);
assert.equal(compareMlbPropsReleaseIds("mlb_props_2026_07_28_r13", "mlb_props_2026_07_28_r14"), -1);

assert.doesNotThrow(() => assertMlbPropsReleaseDoesNotRegress({
  candidateReleaseId: "mlb_props_2026_07_28_r14",
  currentReleaseId: "mlb_props_2026_07_27_r11",
  candidateTimestamp: "2026-07-28T14:17:43.652Z",
  currentTimestamp: "2026-07-28T13:47:43.645Z",
}));
assert.throws(() => assertMlbPropsReleaseDoesNotRegress({
  candidateReleaseId: "mlb_props_2026_07_27_r11",
  currentReleaseId: "mlb_props_2026_07_28_r14",
}), /release downgrade blocked/);
assert.throws(() => assertMlbPropsReleaseDoesNotRegress({
  candidateReleaseId: "mlb_props_2026_07_28_r14",
  currentReleaseId: "mlb_props_2026_07_28_r14",
  candidateTimestamp: "2026-07-28T13:47:43.645Z",
  currentTimestamp: "2026-07-28T14:17:43.652Z",
}), /timestamp regression blocked/);

console.log("PASS MLB props release ordering blocks older releases and stale same-release snapshots");
