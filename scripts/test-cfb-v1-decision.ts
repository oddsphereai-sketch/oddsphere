import assert from "node:assert/strict";
import {
  buildCfbV1DecisionBundle,
  cfbV1LineProbabilities,
  CFB_T60_MAX_CAPTURE_LAG_MINUTES,
  CFB_V1_DECISION_RELEASE,
  CFB_V1_GRADE_POLICY_RELEASE,
  getCfbV1Forecast,
} from "../lib/services/football/cfbV1Decision";
import type { NcaafBookOdds } from "../lib/services/football/balldontlieNcaafSlate";

const forecast = getCfbV1Forecast("457157");
const probabilities = cfbV1LineProbabilities({ forecast, homeSpread: -7.5, totalLine: 47.5 });
assert.ok(Math.abs(probabilities.moneyline.home + probabilities.moneyline.away - 1) < 1e-9);
assert.ok(Math.abs(probabilities.spread.home + probabilities.spread.away - 1) < 1e-9);
assert.ok(Math.abs(probabilities.total.over + probabilities.total.under - 1) < 1e-9);
assert.ok(Math.abs(forecast.expectedHomePoints - forecast.pmf.reduce((sum, row) => sum + row.home * row.probability, 0)) < 1e-9);
assert.ok(Math.abs(forecast.expectedAwayPoints - forecast.pmf.reduce((sum, row) => sum + row.away * row.probability, 0)) < 1e-9);
assert.equal(forecast.representativeScore.home > forecast.representativeScore.away, forecast.homeWinProbability > 0.5);

const observedAt = "2026-08-25T15:50:05.583Z";
const books: NcaafBookOdds[] = [
  book("fanduel", -330, 260, -7.5, -112, -108, 47.5, -105, -115),
  book("draftkings", -310, 250, -7.5, -112, -108, 47.5, -110, -110),
  book("caesars", -325, 255, -7.5, -114, -106, 47.5, -108, -112),
  book("betmgm", -325, 260, -7.5, -115, -105, 47.5, -110, -110),
];
const bundle = buildCfbV1DecisionBundle({ providerGameId: "457157", awayTeam: "UNC", homeTeam: "TCU", gameStartsAt: "2026-08-29T16:00:00Z", comparableCurrentBooks: books });
assert.equal(bundle.evaluatedBets.length, 3);
assert.equal(bundle.heldMarkets.length, 0);
assert.equal(bundle.decisionRelease, CFB_V1_DECISION_RELEASE);
assert.equal(bundle.policyRelease, CFB_V1_GRADE_POLICY_RELEASE);
assert.equal(bundle.evaluatedBets.every((row) => !row.consensus.books.includes(row.evaluatedQuote.sportsbook)), true);
assert.equal(bundle.evaluatedBets.every((row) => row.consensus.books.length >= 2), true);
assert.equal(bundle.evaluatedBets.every((row) => row.modelProbability > 0 && row.modelProbability < 1), true);
for (const decision of bundle.evaluatedBets) {
  const line = cfbV1LineProbabilities({
    forecast,
    homeSpread: decision.market === "spread"
      ? (decision.side.startsWith("TCU ") ? decision.evaluatedQuote.line! : -decision.evaluatedQuote.line!)
      : 0,
    totalLine: decision.market === "total" ? decision.evaluatedQuote.line! : 0,
  });
  if (decision.market === "moneyline") {
    assert.equal(decision.side, line.moneyline.home >= line.moneyline.away ? "TCU" : "UNC", "Moneyline grade side must be selected by the joint PMF");
  } else if (decision.market === "spread") {
    assert.equal(decision.side.startsWith("TCU "), line.spread.home >= line.spread.away, "Spread grade side must be selected by the joint PMF at the exact line");
  } else {
    assert.equal(decision.side.startsWith("Over "), line.total.over >= line.total.under, "Total grade side must be selected by the joint PMF at the exact line");
  }
}

const missing = buildCfbV1DecisionBundle({ providerGameId: "457157", awayTeam: "UNC", homeTeam: "TCU", gameStartsAt: "2026-08-29T16:00:00Z", comparableCurrentBooks: books.slice(0, 2) });
assert.equal(missing.evaluatedBets.length, 0);
assert.equal(missing.heldMarkets.length, 3);
assert.equal(missing.heldMarkets.every((market) => market.reasonCodes?.includes("target_excluded_same_line_consensus_insufficient")), true);

const futureMoneylineBooks = books.map((value) => ({
  ...value,
  marketObservedAt: {
    moneyline: "2026-08-25T16:00:01.000Z",
    spread: observedAt,
    total: observedAt,
  },
}));
const marketScopedClockSkew = buildCfbV1DecisionBundle({
  providerGameId: "457157",
  awayTeam: "UNC",
  homeTeam: "TCU",
  gameStartsAt: "2026-08-29T16:00:00Z",
  comparableCurrentBooks: futureMoneylineBooks,
  evaluatedAt: "2026-08-25T16:00:00.000Z",
});
assert.deepEqual(marketScopedClockSkew.evaluatedBets.map((decision) => decision.market), ["spread", "total"]);
assert.deepEqual(marketScopedClockSkew.heldMarkets.map((market) => market.market), ["moneyline"]);
assert.deepEqual(marketScopedClockSkew.heldMarkets[0]?.reasonCodes, ["quote_observed_after_evaluation"]);

const held = buildCfbV1DecisionBundle({ providerGameId: "457157", awayTeam: "UNC", homeTeam: "TCU", gameStartsAt: "2026-08-29T16:00:00Z", comparableCurrentBooks: books, healthHolds: ["quarterback_status_unverified"] });
assert.equal(held.evaluatedBets.length, 0);
assert.equal(held.heldMarkets.length, 3);
assert.equal(held.heldMarkets.every((market) => market.reasonCodes?.includes("global_health_hold")), true);

assert.equal(CFB_T60_MAX_CAPTURE_LAG_MINUTES, 20);
assert.throws(() => buildCfbV1DecisionBundle({ providerGameId: "457157", awayTeam: "UNC", homeTeam: "TCU", gameStartsAt: "2026-08-29T16:00:00Z", comparableCurrentBooks: books, stage: "t60_locked", evaluatedAt: "2026-08-29T15:30:01Z", lockedAt: "2026-08-29T15:30:01Z" }), /outside the 0-20 minute/);

function book(sportsbook: string, homeMl: number, awayMl: number, homeLine: number, homeSpreadPrice: number, awaySpreadPrice: number, totalLine: number, overPrice: number, underPrice: number): NcaafBookOdds {
  return { providerGameId: "457157", sportsbook, observedAt, moneyline: { homePrice: homeMl, awayPrice: awayMl }, spread: { homeLine, homePrice: homeSpreadPrice, awayLine: -homeLine, awayPrice: awaySpreadPrice }, total: { line: totalLine, overPrice, underPrice } };
}

console.log("CFB v1 exact-price decision tests passed.");
