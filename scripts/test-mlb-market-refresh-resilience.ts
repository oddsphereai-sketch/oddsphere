import { shouldFailClosedForStaleLines } from "../lib/services/automationGate";
import { shouldPreserveLastCompleteMarketRecord } from "../lib/services/predictionRecordService";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";

const proposed = {
  sport: "mlb",
  market: "moneyline",
  odds_american: null,
} as PredictionRecordRow;

if (!shouldFailClosedForStaleLines(8, 15)) throw new Error("majority-stale slate must fail closed");
if (shouldFailClosedForStaleLines(2, 15)) throw new Error("isolated stale games must not block whole slate");
if (!shouldPreserveLastCompleteMarketRecord({
  sport: "mlb",
  proposed,
  existing: { odds_american: -112, play_grade: "best_angle", no_bet: false },
})) throw new Error("incomplete refresh must preserve last complete actionable MLB record");
if (shouldPreserveLastCompleteMarketRecord({
  sport: "mlb",
  proposed: { ...proposed, odds_american: -108 },
  existing: { odds_american: -112, play_grade: "best_angle", no_bet: false },
})) throw new Error("fresh priced recommendation must replace the previous record");
if (shouldPreserveLastCompleteMarketRecord({
  sport: "mlb",
  proposed,
  existing: { odds_american: -112, play_grade: null, no_bet: true },
})) throw new Error("non-actionable prior record is not last-known-good");

console.log("mlb market refresh resilience tests passed");
