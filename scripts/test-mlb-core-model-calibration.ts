import {
  calibrateMlbTotalProjectionToMarket,
  selectMlbMarketAwareScoreProjection,
} from "../lib/automodel/mlbCoreModelCalibration";

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

check("uses 25% of model edge plus run-environment correction", anchored.calibratedTotal === 8.8);
check("preserves an even projected margin", anchored.calibratedAwayScore === 4.4 && anchored.calibratedHomeScore === 4.4);
check("records model edge", anchored.modelEdgeRuns === 2);
check("records run-environment correction", anchored.runEnvironmentCorrectionRuns === 0.3);

const fallback = calibrateMlbTotalProjectionToMarket({
  marketTotal: null,
  rawProjectedAwayScore: 4.2,
  rawProjectedHomeScore: 3.8,
});

check("does not enable without market total", fallback.enabled === false);
check("returns raw projection plus run-environment correction when market total is missing", fallback.calibratedTotal === 8.3);

const marginPreserved = calibrateMlbTotalProjectionToMarket({
  marketTotal: 8,
  rawProjectedAwayScore: 3,
  rawProjectedHomeScore: 5,
});
check(
  "market-aware total preserves the independent projected margin",
  Math.abs(marginPreserved.calibratedAwayScore - 3.15) < 1e-9 &&
    Math.abs(marginPreserved.calibratedHomeScore - 5.15) < 1e-9 &&
    Math.abs(marginPreserved.calibratedHomeScore - marginPreserved.calibratedAwayScore - 2) < 1e-9,
);
const coherent = selectMlbMarketAwareScoreProjection({
  calibration: marginPreserved,
  selectedTotalSide: "over",
  enabled: true,
});
check(
  "coherent market-aware score projection is selected without changing the winner or margin",
  coherent.applied &&
    coherent.total === 8.3 &&
    Math.abs(coherent.awayScore - 3.15) < 1e-9 &&
    Math.abs(coherent.homeScore - 5.15) < 1e-9,
);
const conflicting = selectMlbMarketAwareScoreProjection({
  calibration: marginPreserved,
  selectedTotalSide: "under",
  enabled: true,
});
check(
  "forecast-conflicting score projection retains the independent score",
  !conflicting.applied &&
    conflicting.reason === "candidate_forecast_conflict" &&
    conflicting.awayScore === 3 &&
    conflicting.homeScore === 5,
);
const invalidCandidate = selectMlbMarketAwareScoreProjection({
  calibration: calibrateMlbTotalProjectionToMarket({
    marketTotal: 1,
    rawProjectedAwayScore: 0.5,
    rawProjectedHomeScore: 8,
  }),
  selectedTotalSide: "over",
  enabled: true,
});
check(
  "invalid negative team-score candidate fails closed to the independent score",
  !invalidCandidate.applied &&
    invalidCandidate.reason === "candidate_invalid_team_score" &&
    invalidCandidate.awayScore === 0.5 &&
    invalidCandidate.homeScore === 8,
);

if (fail > 0) {
  console.error(`mlb core model calibration tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`mlb core model calibration tests: ${pass} passed, ${fail} failed`);
