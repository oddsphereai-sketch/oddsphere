import { predictionRecordFirstInningEdgeToPercentagePoints } from "@/lib/services/dailyEdge/edgeUnits";
import {
  buildRehydratedLockedMarketPayload,
  type RehydratedPredictionRecord,
} from "@/lib/services/aiAuditor/rehydratedLockedPayload";

let failures = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}`);
}

check("positive FI stored decimal becomes percentage points", predictionRecordFirstInningEdgeToPercentagePoints(0.069) === 6.9);
check("negative FI stored decimal becomes percentage points", predictionRecordFirstInningEdgeToPercentagePoints(-0.004) === -0.4);
check("zero remains zero", predictionRecordFirstInningEdgeToPercentagePoints(0) === 0);
check("null remains unavailable", predictionRecordFirstInningEdgeToPercentagePoints(null) === null);
check("non-finite input is unavailable", predictionRecordFirstInningEdgeToPercentagePoints(Number.NaN) === null);

const baseRecord: RehydratedPredictionRecord = {
  id: 1,
  game_id: 1,
  external_id: 1,
  sport: "mlb",
  slate_date: "2026-07-27",
  game_date: "2026-07-27T23:00:00Z",
  matchup: "AWY@HME",
  market: "first_inning",
  pick: "NRFI",
  side: "under",
  line_value: 0.5,
  odds_american: -109,
  model_probability: 0.56,
  market_probability: 0.491,
  edge: 0.069,
  play_grade: "best_angle",
  no_bet: false,
  no_bet_reason: null,
  confidence: 56,
  locked_at: "2026-07-27T22:00:00Z",
  snapshot_json: null,
  prediction_grades: null,
};

check(
  "locked FI evidence converts persisted decimal edge",
  buildRehydratedLockedMarketPayload(baseRecord).edgePct === 6.9,
);
check(
  "locked Moneyline evidence preserves persisted percentage-point edge",
  buildRehydratedLockedMarketPayload({
    ...baseRecord,
    market: "moneyline",
    pick: "home",
    side: "home",
    line_value: null,
    edge: 1.3,
  }).edgePct === 1.3,
);
check(
  "locked Total evidence preserves persisted percentage-point edge",
  buildRehydratedLockedMarketPayload({
    ...baseRecord,
    market: "total",
    pick: "over",
    side: "over",
    line_value: 8.5,
    edge: 4.5,
  }).edgePct === 4.5,
);

if (failures > 0) process.exit(1);
