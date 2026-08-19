import assert from "node:assert/strict";
import {
  applyMlbPropsDisplayProjectionCalibration,
  calibrateMlbPropsDisplayProjection,
  MLB_PROPS_DISPLAY_PROJECTION_CALIBRATION_VERSION,
} from "../lib/mlb/props/displayProjectionCalibration";

const untouched = {
  id: "unselected",
  market: "batter_hits",
  line: 0.5,
  projection: 0.72,
  finalProbability: 0.61,
  side: "over" as const,
  playGrade: "LEAN" as const,
  units: 1,
};
const selected = {
  id: "selected",
  market: "batter_strikeouts",
  line: 5.5,
  projection: 4,
  finalProbability: 0.64,
  side: "under" as const,
  playGrade: "BEST_ANGLE" as const,
  units: 1,
};

const calibrated = applyMlbPropsDisplayProjectionCalibration([untouched, selected]);
assert.strictEqual(calibrated[0], untouched, "unselected markets must retain object identity");
assert.notStrictEqual(calibrated[1], selected, "selected markets should receive a new row");
assert.equal(calibrated[1].id, selected.id);
assert.equal(calibrated[1].finalProbability, selected.finalProbability);
assert.equal(calibrated[1].side, selected.side);
assert.equal(calibrated[1].playGrade, selected.playGrade);
assert.equal(calibrated[1].units, selected.units);
assert.ok(Math.abs(calibrated[1].projection - 4.963692095187934) < 1e-12);

const beforeWithoutProjection = { ...selected, projection: undefined };
const afterWithoutProjection = { ...calibrated[1], projection: undefined };
assert.deepEqual(
  afterWithoutProjection,
  beforeWithoutProjection,
  "post-decision calibration must change projection and nothing else",
);

assert.equal(
  calibrateMlbPropsDisplayProjection({
    market: "pitcher_strikeouts",
    side: "over",
    line: 0,
    projection: -100,
  }),
  0,
  "count projections must be clamped at zero",
);
assert.equal(
  calibrateMlbPropsDisplayProjection({
    market: "pitcher_strikeouts",
    side: "under",
    line: Number.NaN,
    projection: 4.2,
  }),
  4.2,
  "non-finite inputs must fail closed to the original projection",
);
assert.equal(
  calibrateMlbPropsDisplayProjection({
    market: "pitcher_strikeouts",
    side: "over",
    line: 5.5,
    projection: 7,
  }),
  7,
  "a display correction must not introduce a projection/side contradiction",
);
assert.match(MLB_PROPS_DISPLAY_PROJECTION_CALIBRATION_VERSION, /2026_08_19_r1$/);

console.log("MLB props display-projection calibration tests passed.");
