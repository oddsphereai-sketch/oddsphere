import { calibrateMlbTotalProjectionToMarket } from "../lib/automodel/mlbCoreModelCalibration";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`not ok - ${name}`);
  }
}

const anchored = calibrateMlbTotalProjectionToMarket({
  marketTotal: 8,
  rawProjectedAwayScore: 5,
  rawProjectedHomeScore: 5,
});

check("uses 25% of model edge over market", anchored.calibratedTotal === 8.5);
check("preserves team run share", anchored.calibratedAwayScore === 4.3 && anchored.calibratedHomeScore === 4.3);
check("records model edge", anchored.modelEdgeRuns === 2);

const fallback = calibrateMlbTotalProjectionToMarket({
  marketTotal: null,
  rawProjectedAwayScore: 4.2,
  rawProjectedHomeScore: 3.8,
});

check("does not enable without market total", fallback.enabled === false);
check("returns raw projection when market total is missing", fallback.calibratedTotal === 8);

if (fail > 0) {
  console.error(`mlb core model calibration tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`mlb core model calibration tests: ${pass} passed, ${fail} failed`);
