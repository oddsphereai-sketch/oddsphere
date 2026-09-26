import assert from "node:assert/strict";
import {
  buildCfbV1DecisionBundle,
  cfbV1CalibratedSelection,
  cfbV1LineProbabilities,
  CFB_SPREAD_COUNTER_SIGNAL_MAX_INCLUSIVE,
  CFB_SPREAD_COUNTER_SIGNAL_MIN_EXCLUSIVE,
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
    const calibrated = cfbV1CalibratedSelection({
      probabilities: line,
      market: "spread",
      homeSpread: decision.side.startsWith("TCU ") ? decision.evaluatedQuote.line! : -decision.evaluatedQuote.line!,
    });
    assert.equal(decision.side.startsWith("TCU "), calibrated.side === "home", "Spread grade side must follow the released calibration contract at the exact line");
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

const boundaryProbabilities = (home: number) => ({
  moneyline: { home, away: 1 - home },
  spread: { home, away: 1 - home, push: 0 },
  total: { over: home, under: 1 - home, push: 0 },
});
assert.equal(cfbV1CalibratedSelection({
  probabilities: boundaryProbabilities(CFB_SPREAD_COUNTER_SIGNAL_MIN_EXCLUSIVE),
  market: "spread",
  homeSpread: -3.5,
  calibrationContract: "authoritative_pmf_spread_counter_signal",
}).counterSignalApplied, false, "the lower boundary is exclusive");
assert.equal(cfbV1CalibratedSelection({
  probabilities: boundaryProbabilities(CFB_SPREAD_COUNTER_SIGNAL_MIN_EXCLUSIVE + 0.0001),
  market: "spread",
  homeSpread: -3.5,
  calibrationContract: "authoritative_pmf_spread_counter_signal",
}).side, "away", "a qualified spread signal flips sides");
assert.equal(cfbV1CalibratedSelection({
  probabilities: boundaryProbabilities(CFB_SPREAD_COUNTER_SIGNAL_MAX_INCLUSIVE),
  market: "spread",
  homeSpread: -3.5,
  calibrationContract: "authoritative_pmf_spread_counter_signal",
}).counterSignalApplied, true, "the upper boundary is inclusive");
assert.equal(cfbV1CalibratedSelection({
  probabilities: boundaryProbabilities(CFB_SPREAD_COUNTER_SIGNAL_MAX_INCLUSIVE + 0.0001),
  market: "spread",
  homeSpread: -3.5,
  calibrationContract: "authoritative_pmf_spread_counter_signal",
}).counterSignalApplied, false, "confidence above the qualified band is unchanged");
assert.equal(cfbV1CalibratedSelection({
  probabilities: boundaryProbabilities(0.54),
  market: "total",
  calibrationContract: "authoritative_pmf_spread_counter_signal",
}).side, "over", "the spread-only calibration cannot alter totals");
assert.equal(cfbV1CalibratedSelection({
  probabilities: boundaryProbabilities(0.54),
  market: "moneyline",
  calibrationContract: "authoritative_pmf_spread_counter_signal",
}).side, "home", "the spread-only calibration cannot alter moneylines");

const containedFavorite = cfbV1CalibratedSelection({
  probabilities: {
    moneyline: { home: 0.5263, away: 0.4737 },
    spread: { home: 0.46, away: 0.54, push: 0.032 },
    total: { over: 0.5, under: 0.5, push: 0 },
  },
  market: "spread",
  homeSpread: -3,
  calibrationContract: "authoritative_pmf_spread_counter_signal",
});
assert.equal(containedFavorite.side, "home");
assert.ok(Math.abs(containedFavorite.calibratedProbability - (0.5263 - 0.016)) < 1e-12, "favorite cover probability is capped by the same-PMF win event");

const containmentPreventsInvalidFlip = cfbV1CalibratedSelection({
  probabilities: {
    moneyline: { home: 0.51, away: 0.49 },
    spread: { home: 0.54, away: 0.46, push: 0.02 },
    total: { over: 0.5, under: 0.5, push: 0 },
  },
  market: "spread",
  homeSpread: 1.5,
  calibrationContract: "authoritative_pmf_spread_counter_signal",
});
assert.equal(containmentPreventsInvalidFlip.side, "home", "identity remains when containment cannot leave the counter-signal above 50%");
assert.equal(containmentPreventsInvalidFlip.counterSignalApplied, false);
assert.equal(containmentPreventsInvalidFlip.calibratedProbability, 0.54);
assert.throws(() => cfbV1CalibratedSelection({
  probabilities: boundaryProbabilities(0.54),
  market: "spread",
  calibrationContract: "authoritative_pmf_spread_counter_signal",
}), /exact home spread/, "spread calibration fails closed without its exact line");

const counterSignalForecast = {
  providerGameId: "counter-signal-test",
  awayTeam: "AWY",
  homeTeam: "HME",
  gameStartsAt: "2026-09-20T16:00:00Z",
  expectedAwayPoints: 24.22,
  expectedHomePoints: 24.78,
  expectedMarginHome: 0.56,
  expectedTotal: 49,
  homeWinProbability: 0.54,
  representativeScore: { away: 21, home: 28 },
  interval80: { away: [21, 28] as [number, number], home: [21, 28] as [number, number], marginHome: [-7, 7] as [number, number], total: [49, 49] as [number, number] },
  pmf: [
    { home: 28, away: 21, probability: 0.54 },
    { home: 21, away: 28, probability: 0.46 },
  ],
};
const counterSignalBooks = ["fanduel", "draftkings", "caesars", "betmgm"].map((sportsbook): NcaafBookOdds => ({
  providerGameId: "counter-signal-test",
  sportsbook,
  observedAt: "2026-09-19T12:00:00Z",
  moneyline: { homePrice: -110, awayPrice: -110 },
  spread: { homeLine: -3.5, homePrice: -110, awayLine: 3.5, awayPrice: -110 },
  total: { line: 48.5, overPrice: -110, underPrice: -110 },
}));
const counterSignalBundle = buildCfbV1DecisionBundle({
  providerGameId: "counter-signal-test",
  awayTeam: "AWY",
  homeTeam: "HME",
  gameStartsAt: "2026-09-20T16:00:00Z",
  comparableCurrentBooks: counterSignalBooks,
  forecast: counterSignalForecast,
});
const coherentSpread = counterSignalBundle.evaluatedBets.find((decision) => decision.market === "spread");
assert.equal(coherentSpread?.side, "HME -3.5", "the production default stays on the authoritative PMF side");
assert.equal(coherentSpread?.independentProbability, 0.54);
assert.equal(coherentSpread?.forecastProbability, 0.54);
assert.equal(coherentSpread?.calibratedProbability, 0.54);
assert.equal(coherentSpread?.modelProbability, 0.54);
assert.equal(coherentSpread?.calibrationFamily, "authoritative_market_sharp_pmf_identity");
const diagnosticCounterSignal = buildCfbV1DecisionBundle({
  providerGameId: "counter-signal-test",
  awayTeam: "AWY",
  homeTeam: "HME",
  gameStartsAt: "2026-09-20T16:00:00Z",
  comparableCurrentBooks: counterSignalBooks,
  forecast: counterSignalForecast,
  calibrationContract: "authoritative_pmf_spread_counter_signal",
}).evaluatedBets.find((decision) => decision.market === "spread");
assert.equal(diagnosticCounterSignal?.side, "AWY +3.5", "the counter-signal remains available for explicit diagnostic replay");
assert.equal(diagnosticCounterSignal?.modelProbability, 0.54);

const toledoCoherenceForecast = {
  ...counterSignalForecast,
  providerGameId: "sdsu-toledo-coherence",
  awayTeam: "SDSU",
  homeTeam: "TOL",
  expectedAwayPoints: 23.3,
  expectedHomePoints: 27.6,
  expectedMarginHome: 4.3,
  expectedTotal: 50.9,
  homeWinProbability: 0.603,
  representativeScore: { away: 23, home: 28 },
  pmf: [
    { home: 28, away: 23, probability: 0.603 },
    { home: 23, away: 28, probability: 0.397 },
  ],
};
const toledoBooks = counterSignalBooks.map((book) => ({
  ...book,
  providerGameId: "sdsu-toledo-coherence",
  spread: { homeLine: -2.5, homePrice: -110, awayLine: 2.5, awayPrice: -110 },
}));
const toledoSpread = buildCfbV1DecisionBundle({
  providerGameId: "sdsu-toledo-coherence",
  awayTeam: "SDSU",
  homeTeam: "TOL",
  gameStartsAt: "2026-09-20T16:00:00Z",
  comparableCurrentBooks: toledoBooks,
  forecast: toledoCoherenceForecast,
}).evaluatedBets.find((decision) => decision.market === "spread");
assert.equal(toledoSpread?.side, "TOL -2.5", "a Toledo 27.6-23.3 forecast cannot publish SDSU +2.5");
assert.equal(toledoSpread?.calibrationFamily, "authoritative_market_sharp_pmf_identity");

function book(sportsbook: string, homeMl: number, awayMl: number, homeLine: number, homeSpreadPrice: number, awaySpreadPrice: number, totalLine: number, overPrice: number, underPrice: number): NcaafBookOdds {
  return { providerGameId: "457157", sportsbook, observedAt, moneyline: { homePrice: homeMl, awayPrice: awayMl }, spread: { homeLine, homePrice: homeSpreadPrice, awayLine: -homeLine, awayPrice: awaySpreadPrice }, total: { line: totalLine, overPrice, underPrice } };
}

console.log("CFB v1 exact-price decision tests passed.");
