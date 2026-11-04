import assert from "node:assert/strict";
import { NHL_REGULAR_MODEL_RELEASE, NHL_REGULAR_CALIBRATION_RELEASE, NHL_REGULAR_DECISION_RELEASE,
  NHL_REGULAR_TRANSITION_MODEL_RELEASES, resolveNhlPriceAwareVerdict, type NhlModelOutput, type NhlFeatureSnapshot } from "../lib/automodel/nhlRegularModelV1";
import { buildReaderReceiptForWrite } from "../lib/services/nhl/buildNhlPredictionRecords";
import { resolveNhlMoneylineBestVerdict, priceNhlModelWithReaderReceipt } from "../lib/services/nhl/nhlMoneylineBestConfirmation";
import { buildNhlReaderReceipt, decodeNhlReaderReceipt, NHL_LEGACY_READER_RECEIPT_RELEASE, type NhlReaderReceipt } from "../lib/services/nhl/nhlReaderReceipt";
import type { NhlSelectedPriceQuote } from "../lib/services/nhl/nhlLineBoard";

const at = "2026-11-04T18:30:00.000Z", observed = "2026-11-04T18:20:00.000Z";
const expected = { gameId: 123, externalId: 2026020123, slateDate: "2026-11-04", gameStartAt: "2026-11-05T00:00:00.000Z",
  homeAbbr: "NJD", awayAbbr: "NYR", lockBoundaryAt: "2026-11-05T00:00:00.000Z",
  modelVersion: NHL_REGULAR_MODEL_RELEASE, calibrationVersion: NHL_REGULAR_CALIBRATION_RELEASE, decisionVersion: NHL_REGULAR_DECISION_RELEASE };

function fixture(side: "home" | "away" = "home", price = -150, probability = .66) {
  const sign = side === "home" ? 1 : -1;
  const homePrice = side === "home" ? -200 : 180, awayPrice = side === "home" ? 180 : -200;
  const implied = (p: number) => p > 0 ? 100 / (100 + p) : -p / (100 - p);
  const current = implied(homePrice) / (implied(homePrice) + implied(awayPrice));
  const path = { market: "moneyline", sportsbook: "Pinnacle", sportsbookFamily: "pinnacle", sourceClass: "named", contractKey: "full_game_ml",
    complete: true, state: "stable", openingValue: current - .03 * sign, currentValue: current,
    openingObservedAt: "2026-11-04T17:50:00.000Z", firstMaterialMoveAt: "2026-11-04T18:10:00.000Z", currentObservedAt: observed,
    observations: [{ at: "2026-11-04T17:50:00.000Z", value: current - .03 * sign }, { at: "2026-11-04T18:10:00.000Z", value: current - .01 * sign }, { at: observed, value: current }] } as const;
  const episode = { market: "moneyline", author: path, state: "confirmation", direction: side, innovation: .03 * sign,
    selectedMoveAt: "2026-11-04T18:10:00.000Z", rejectedPaths: [], reason: "qualified_split_response", rejectedPressure: null,
    pressure: { source: "identified_professional_split", sourceBook: "circa", sourceClass: "sharp" } };
  const model = { model_version: NHL_REGULAR_MODEL_RELEASE, calibration_version: NHL_REGULAR_CALIBRATION_RELEASE, decision_version: NHL_REGULAR_DECISION_RELEASE,
    projected_home_goals: side === "home" ? 3.5 : 2.5, projected_away_goals: side === "home" ? 2.5 : 3.5, expected_total_goals: 6,
    moneyline: { pick: `${side === "home" ? "NJD" : "NYR"} ML`, probability, verdict: "best_angle" },
    total: { pick: "OVER 5.5", probability: .64, verdict: "best_angle" },
    puck_line: { pick: "NJD +1.5", probability: .6, verdict: "lean" },
    layers: { moneyline_market_read: "confirmation", moneyline_market_side: side, moneyline_market_pressure_basis: "money_differential",
      puck_line_market_read: "unavailable", puck_line_market_side: null, puck_line_market_pressure_basis: null,
      total_market_read: "unavailable", total_market_side: null, total_market_pressure_basis: null,
      side_market_authority: "moneyline", joint_market_projection_status: "projected", joint_market_projection_reason: "converged",
      total_market_authority_source: "none" } } as unknown as NhlModelOutput;
  const seed = structuredClone(model); seed.moneyline.probability -= .03;
  const snapshot = { market: { market_decision_at: at, market_total_line: 5.5, market_home_puck_line: 1.5, market_away_puck_line: -1.5,
    moneyline_market_episode: episode, market_episode_paths: [path] } } as unknown as NhlFeatureSnapshot;
  const quote: NhlSelectedPriceQuote = { market_type: "moneyline", sportsbook: "draftkings", side, line_value: null, odds_american: price, observed_at: observed };
  const rows = [{ market_type: "moneyline", sportsbook: "Pinnacle", side: "home", line_value: null, odds_american: homePrice, observed_at: observed },
    { market_type: "moneyline", sportsbook: "Pinnacle", side: "away", line_value: null, odds_american: awayPrice, observed_at: observed }];
  const quotes = { moneyline: quote, total: null, spread: null };
  const professionalSplits = [{ market: "moneyline", sourceBook: "circa", observedAt: "2026-11-04T17:59:00.000Z", receivedAt: "2026-11-04T18:00:00.000Z",
    awayOrOverMoneyPct: side === "away" ? 75 : 25, awayOrOverBetsPct: side === "away" ? 55 : 45,
    homeOrUnderMoneyPct: side === "home" ? 75 : 25, homeOrUnderBetsPct: side === "home" ? 55 : 45 }];
  const receipt = buildReaderReceiptForWrite({ ...expected, snapshot, seedModel: seed, finalModel: model, currentRows: rows,
    historyRows: [], evaluatedQuotes: quotes, split: null, professionalSplits: professionalSplits as never, capturedAt: at });
  return { quote, receipt, model, quotes };
}
const evaluate = (f: ReturnType<typeof fixture>) => resolveNhlMoneylineBestVerdict({ verdict: "best_angle", probability: f.model.moneyline.probability,
  quote: f.quote, receipt: f.receipt, expected });
function rehash(receipt: NhlReaderReceipt): NhlReaderReceipt { const { receiptHash: _hash, ...body } = receipt; return buildNhlReaderReceipt(body); }
for (const side of ["home", "away"] as const) {
  const f = fixture(side);
  assert.equal(resolveNhlPriceAwareVerdict("moneyline", "best_angle", -150, .66), "lean");
  assert.equal(evaluate(f), "best_angle", "actual author pair and causal professional pressure qualify below70%");
  const first = priceNhlModelWithReaderReceipt({ model: f.model, receipt: f.receipt, expected, quotes: f.quotes });
  const second = resolveNhlMoneylineBestVerdict({ verdict: f.model.moneyline.verdict, probability: f.model.moneyline.probability,
    quote: f.quote, receipt: first.receipt, expected });
  assert.equal(first.model.moneyline.verdict, second);
  assert.equal(first.receipt.markets.moneyline.after.verdict, second);
  assert.equal(first.model.moneyline.probability, f.model.moneyline.probability);
  assert.deepEqual(first.receipt.finalDecision, f.receipt.finalDecision);
  assert.equal(decodeNhlReaderReceipt(first.receipt, expected).status, "valid");
  assert.equal(first.model.total.verdict, "pass", "non-ML exact-price behavior stays unchanged");
}
const short = fixture("home", -250, .78);
short.receipt.markets.moneyline.confirmationQuotePair!.home.american = -400;
short.receipt.markets.moneyline.confirmationQuotePair!.away.american = 350;
short.receipt.markets.moneyline.consideredPaths[0].currentCoordinate = .8 / (.8 + 1 / 4.5);
short.receipt.markets.moneyline.consideredPaths[0].openingCoordinate = short.receipt.markets.moneyline.consideredPaths[0].currentCoordinate! - .03;
const shortPath = short.receipt.markets.moneyline.confirmationSourcePaths![0], shift = short.receipt.markets.moneyline.consideredPaths[0].currentCoordinate! - shortPath.currentValue;
shortPath.openingValue += shift; shortPath.currentValue += shift; shortPath.observations.forEach(point => { point.value += shift; });
short.receipt = rehash(short.receipt);
assert.equal(evaluate(short), "best_angle", "strong exact source economics can qualify beyond-200");
const boundary = structuredClone(short); boundary.quote.odds_american = -200; boundary.receipt.markets.moneyline.evaluatedQuote!.american = -200; boundary.receipt = rehash(boundary.receipt);
assert.equal(evaluate(boundary), "best_angle", "-200 boundary requires the same current-source economic proof");
assert.equal(evaluate(fixture("home", -150, .65)), "best_angle", "existing5pp exact-edge boundary remains inclusive");
assert.equal(evaluate(fixture("home", -150, .65 - 1e-8)), "lean");
assert.equal(evaluate(fixture("home", -900, .99)), "pass");
assert.equal(evaluate(fixture("home", -901, .99)), "pass");
const laterDecision = fixture();
laterDecision.receipt.cutoffAt = "2026-11-04T18:31:00.000Z";
laterDecision.receipt = rehash(laterDecision.receipt);
assert.equal(evaluate(laterDecision), "best_angle", "a later decision is valid when every evidence availability bound precedes it");
for (const mutate of [
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.interpretation.state = "resistance"; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.interpretation.state = "discovery"; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.interpretation.authoritySource = "independent"; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.consideredPaths[0].sourceClass = "broad"; },
  (f: ReturnType<typeof fixture>) => {
    const opposed = structuredClone(f.receipt.markets.moneyline.confirmationSourcePaths![0]);
    opposed.sportsbook = "Bookmaker"; opposed.sportsbookFamily = "bookmaker";
    opposed.currentValue = opposed.openingValue - .03;
    opposed.observations[1].value = opposed.openingValue - .02; opposed.observations[2].value = opposed.currentValue;
    f.receipt.markets.moneyline.confirmationSourcePaths!.push(opposed);
  },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.consideredPaths[0].sportsbook = "DraftKings"; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.confirmationQuotePair = null; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.confirmationQuotePair!.away.american = 100; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.splits.professionalBooks[0].rejectionReason = "professional_conflict"; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.splits.professionalBooks[0].clock.receivedAt = observed; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.splits.professionalBooks[0].sourceBook = "draftkings"; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.splits.professionalBooks = []; },
  (f: ReturnType<typeof fixture>) => { f.receipt.identity.gameId++; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.evaluatedQuote!.american = -140; },
  (f: ReturnType<typeof fixture>) => { f.receipt.markets.moneyline.evaluatedQuote!.clock.sourceObservedAt = "2026-11-04T14:00:00.000Z"; },
]) { const f = fixture(); mutate(f); f.receipt = rehash(f.receipt); assert.equal(evaluate(f), "lean"); }
// A directionally confirming move may still price the target as negative EV.
const badEconomics = fixture("home", -200, .75);
assert.equal(evaluate(badEconomics), "lean", "current source fair must clear the exact executed payout independently");
// The native full-window reversal is not the causal post-pressure response.
for (const side of ["home", "away"] as const) {
  const f = fixture(side), sign = side === "home" ? 1 : -1, m = f.receipt.markets.moneyline, path = m.confirmationSourcePaths![0];
  path.openingValue = path.currentValue + .05 * sign;
  path.state = "reversal";
  path.observations = [
    { at: path.openingObservedAt, value: path.openingValue },
    { at: "2026-11-04T17:55:00.000Z", value: path.currentValue - .08 * sign },
    { at: "2026-11-04T17:59:30.000Z", value: path.currentValue - .03 * sign },
    { at: "2026-11-04T18:10:00.000Z", value: path.currentValue - .01 * sign },
    { at: observed, value: path.currentValue },
  ];
  Object.assign(m.consideredPaths[0], { state: "reversal", direction: side === "home" ? "away" : "home", rejectionReason: "reversal",
    openingCoordinate: path.openingValue, netMove: path.currentValue - path.openingValue });
  f.receipt = rehash(f.receipt);
  assert.equal(evaluate(f), "best_angle", "clean selected causal leg survives old pre-pressure reversal and opposite full-window net");
  for (const kind of ["buyback", "reversal"] as const) {
    const bad = structuredClone(f), p = bad.receipt.markets.moneyline.confirmationSourcePaths![0];
    p.observations.splice(3, 0, { at: "2026-11-04T18:05:00.000Z", value: p.currentValue + (kind === "buyback" ? .04 : -.06) * sign });
    bad.receipt = rehash(bad.receipt);
    assert.equal(evaluate(bad), "lean", "actual post-pressure buyback/reversal cannot qualify even when summary flags claim confirmation");
  }
}
const changed = fixture(); changed.receipt.markets.moneyline.after.probability += .01;
assert.equal(evaluate(changed), "lean", "hash mutation cannot qualify");
for (const destination of ["execution", "author", "pair"] as const) {
  const f = fixture(), m = f.receipt.markets.moneyline;
  // Native quote times remain before cutoff, but local availability is later.
  // Rehash the complete envelope so this tests semantics rather than hashing.
  f.receipt.capturedAt = "2026-11-04T18:32:00.000Z";
  for (const market of Object.values(f.receipt.markets)) {
    const clocks = [market.evaluatedQuote, market.opposingQuote, ...market.selectedTrail, ...market.opposingTrail,
      ...market.lineTrail, ...market.consideredPaths, ...market.splits.professionalBooks,
      ...(market.confirmationQuotePair ? Object.values(market.confirmationQuotePair) : [])];
    for (const item of clocks) if (item) item.clock.capturedAt = f.receipt.capturedAt;
  }
  const afterCutoff = "2026-11-04T18:31:00.000Z";
  if (destination === "execution") m.evaluatedQuote!.clock.receivedAt = afterCutoff;
  if (destination === "author") m.consideredPaths[0].clock.receivedAt = afterCutoff;
  if (destination === "pair") m.confirmationQuotePair!.home.clock.receivedAt = afterCutoff;
  f.receipt = rehash(f.receipt);
  assert.equal(decodeNhlReaderReceipt(f.receipt, expected).status, "valid");
  assert.equal(evaluate(f), "lean", `${destination} receipt arriving after cutoff cannot qualify, even with an earlier native observation`);
}
const legacy = fixture(); legacy.receipt.release = NHL_LEGACY_READER_RECEIPT_RELEASE;
legacy.receipt.modelRelease = { modelVersion: "nhl_regular_2026_r27_external_audited_sharp_reader", calibrationVersion: "nhl_regular_calibration_2026_r27_external_audited_sharp_reader", decisionVersion: "nhl_regular_decision_2026_r27_external_audited_sharp_reader" };
delete legacy.receipt.markets.moneyline.confirmationQuotePair; delete legacy.receipt.markets.moneyline.confirmationSourcePaths; legacy.receipt = rehash(legacy.receipt);
const bytes = JSON.stringify(legacy.receipt);
assert.equal(decodeNhlReaderReceipt(legacy.receipt, { ...expected, ...legacy.receipt.modelRelease }).status, "valid", "r27 lock receipt still decodes exactly");
assert.equal(evaluate(legacy), "lean", "new evidence semantics never certify an old lock");
assert.equal(JSON.stringify(legacy.receipt), bytes);
assert.ok(NHL_REGULAR_TRANSITION_MODEL_RELEASES.includes("nhl_regular_2026_r27_external_audited_sharp_reader"));
console.log("PASS NHL exact-price professional ML Best: actual source pair, causal/hash/fixture/quote binding, both writer passes, mirrored sides, economic/price boundaries and immutable r27 receipts.");
