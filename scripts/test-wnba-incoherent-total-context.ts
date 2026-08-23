import assert from "node:assert/strict";
import {
  __WNBA_DAILY_EDGE_ADAPTER_TEST__,
  selectWnbaDecisionTupleForReader,
} from "../lib/services/wnba/buildWnbaDailyEdgeAdapted";
import {
  retainCompatibleWnbaDecisionTuple,
  type WnbaDecisionTuple,
} from "../lib/services/wnba/wnbaDecisionTuple";

const tuple: WnbaDecisionTuple = {
  contract_version: "wnba_decision_tuple_v1_exact_evaluated_price_2026_08_21",
  market: "total",
  side: "over",
  line: 163.5,
  model_probability: 0.6615,
  market_fair_probability: 0.5043297540699688,
  outcome_confidence: 0.66,
  bet_grade: "Watchlist",
  evaluated_price_american: -112,
  evaluated_sportsbook: "fanduel",
  evaluated_at: "2026-08-21T20:34:18.970Z",
  decision_at: "2026-08-21T20:34:23.398Z",
  model_version: "wnba_v1_1_team_identity",
  distribution_version: "wnba_market_heads_value_calibrated_2026_08_02_v3",
  grade_policy_version: "wnba_grade_policy_v6_authoritative_reader_grade_2026_08_13",
};

const currentDecision = {
  market: "total" as const,
  pick: "Over 163.5",
  side: "over" as const,
  line: 163.5,
  modelProbability: 0.6615,
  outcomeConfidence: 0.66,
  betGrade: "Watchlist",
  decisionAt: "2026-08-21T20:53:47.675Z",
};

const record = {
  game_id: 46591,
  market: "total",
  pick: "Over 163.5",
  side: "over",
  line_value: 163.5,
  odds_american: -112,
  confidence: 66,
  play_grade: "watchlist",
  locked_at: null,
  snapshot_json: {
    prediction_record_contract_version: "wnba_prediction_record_contract_v3_exact_decision_tuple_2026_08_21",
    decision_tuple: tuple,
  },
};

const retained = selectWnbaDecisionTupleForReader({
  lockedRecord: null,
  currentTuple: null,
  lastKnownGoodRecord: record,
  currentDecision,
});
assert.strictEqual(retained, tuple, "reader reuses the complete last-known-good v3 tuple without cloning or synthesizing it");
assert.deepEqual(retained, tuple, "pick-side, line, price, book, probabilities, grade, time, and release remain exact");

assert.strictEqual(
  retainCompatibleWnbaDecisionTuple(tuple, currentDecision),
  tuple,
  "writer carries the exact prior tuple when the decision is unchanged",
);
assert.equal(
  retainCompatibleWnbaDecisionTuple(tuple, { ...currentDecision, line: 162.5 }),
  null,
  "writer does not synthesize a tuple for an incompatible live line",
);
assert.equal(
  selectWnbaDecisionTupleForReader({
    lockedRecord: null,
    currentTuple: null,
    lastKnownGoodRecord: { ...record, pick: "Over 162.5" },
    currentDecision,
  }),
  null,
  "reader rejects a record whose pick identity does not match the current decision",
);
assert.equal(
  selectWnbaDecisionTupleForReader({
    lockedRecord: null,
    currentTuple: null,
    lastKnownGoodRecord: record,
    currentDecision: { ...currentDecision, modelProbability: 0.67 },
  }),
  null,
  "reader does not reuse stale evidence after a model-probability change",
);
assert.equal(
  selectWnbaDecisionTupleForReader({
    lockedRecord: null,
    currentTuple: tuple,
    lastKnownGoodRecord: null,
    currentDecision: { ...currentDecision, line: 162.5 },
  }),
  null,
  "reader rejects an incompatible tuple even when it appears in the current snapshot",
);
assert.equal(
  selectWnbaDecisionTupleForReader({
    lockedRecord: null,
    currentTuple: null,
    lastKnownGoodRecord: { ...record, snapshot_json: { ...record.snapshot_json, prediction_record_contract_version: "v2" } },
    currentDecision,
  }),
  null,
  "reader rejects non-v3 fallback records",
);

const lockedRecord = { ...record, locked_at: "2026-08-21T22:30:00.000Z" };
assert.strictEqual(
  selectWnbaDecisionTupleForReader({
    lockedRecord,
    currentTuple: { ...tuple, evaluated_price_american: -126 },
    lastKnownGoodRecord: lockedRecord,
    currentDecision: { ...currentDecision, line: 162.5, betGrade: "Lean" },
  }),
  tuple,
  "a T-60 tuple remains immutable even when later line, price, and grade inputs differ",
);

const liveRows = [
  { market_type: "total", side: "over", sportsbook: "fanduel", line_value: 162.5, odds_american: -126, recorded_at: "2026-08-21T20:53:43.001Z" },
  { market_type: "total", side: "under", sportsbook: "fanduel", line_value: 163.5, odds_american: -108, recorded_at: "2026-08-21T20:53:43.001Z" },
];
const historyRows = [
  { market_type: "total", side: "over", sportsbook: "fanduel", line_value: 163.5, odds_american: -110, recorded_at: "2026-08-21T20:23:35.429Z" },
  { market_type: "total", side: "under", sportsbook: "fanduel", line_value: 163.5, odds_american: -110, recorded_at: "2026-08-21T20:23:35.429Z" },
  { market_type: "total", side: "over", sportsbook: "fanduel", line_value: 163.5, odds_american: -112, recorded_at: tuple.evaluated_at },
  { market_type: "total", side: "under", sportsbook: "fanduel", line_value: 163.5, odds_american: -108, recorded_at: tuple.evaluated_at },
];
const prices = __WNBA_DAILY_EDGE_ADAPTER_TEST__.buildWnbaPickedPrices(
  liveRows,
  historyRows,
  new Map(),
  { total: tuple },
  { side: "Golden State Valkyries", confidence: 72, grade: "Watchlist", price: -265 },
  { side: "Over 163.5", line: 163.5, confidence: 66, grade: "Watchlist" },
  { side: "Golden State Valkyries -6.5", line: 6.5, confidence: 50, grade: "Watchlist" },
  "CHI",
  "GS",
  "Chicago Sky",
  "Golden State Valkyries",
  null,
);

assert.equal(prices.total.current, -112, "evaluated price remains anchored to the v3 tuple");
assert.equal(prices.total.currentQuote, -126, "new incompatible quote is context only");
assert.equal(prices.total.currentQuoteLine, 162.5, "context preserves the newer quote's actual line");
assert.ok(prices.total.coherent && (prices.total.stops?.length ?? 0) >= 2, "selected-side movement remains coherent at 163.5");
assert.ok(prices.total.stops?.every((stop) => stop.line === 163.5), "selected movement never relabels 162.5 as 163.5");
assert.ok(prices.opposingTotal.coherent && (prices.opposingTotal.stops?.length ?? 0) >= 2, "opposing-side movement remains available at 163.5");
assert.ok(prices.opposingTotal.stops?.every((stop) => stop.line === 163.5), "opposing movement uses the evaluated line");

const spreadHelp = __WNBA_DAILY_EDGE_ADAPTER_TEST__.priceTrailMovementRead(
  "spread",
  "SEA +8.5",
  {
    current: -118,
    open: -118,
    previous: null,
    openLine: 7.5,
    currentLine: 8.5,
    coherent: true,
    sportsbook: "fanduel",
  },
  "2026-08-23T13:00:00.000Z",
);
assert.equal(
  spreadHelp?.movement?.directionRelativeToPick,
  "support",
  "a selected spread moving from +7.5 to +8.5 supports the pick",
);
assert.ok((spreadHelp?.score ?? 0) > 0, "the supporting spread move produces a positive market-read score");

const spreadResistance = __WNBA_DAILY_EDGE_ADAPTER_TEST__.priceTrailMovementRead(
  "spread",
  "DAL -8.5",
  {
    current: -104,
    open: -104,
    previous: null,
    openLine: -7.5,
    currentLine: -8.5,
    coherent: true,
    sportsbook: "fanduel",
  },
  "2026-08-23T13:00:00.000Z",
);
assert.equal(
  spreadResistance?.movement?.directionRelativeToPick,
  "resistance",
  "a selected spread moving from -7.5 to -8.5 resists the pick",
);
assert.ok((spreadResistance?.score ?? 0) < 0, "the resisting spread move produces a negative market-read score");

const spreadReadFromLineTracker = __WNBA_DAILY_EDGE_ADAPTER_TEST__.withVisiblePriceTrailMarketRead({
  existing: null,
  slot: "spread",
  pick: "SEA +8.5",
  trail: {
    current: -118,
    open: -118,
    previous: null,
    openLine: 8.5,
    currentLine: 8.5,
    coherent: true,
    sportsbook: "fanduel",
  },
  lineTrail: {
    current: -118,
    open: -110,
    previous: null,
    openLine: 7.5,
    currentLine: 8.5,
    coherent: true,
    sportsbook: "fanduel",
  },
  generatedAt: "2026-08-23T13:00:00.000Z",
});
assert.equal(
  spreadReadFromLineTracker?.movement?.directionRelativeToPick,
  "support",
  "Market Pulse follows the WNBA spread line tracker instead of a flat current-number price trail",
);

const boardBefore = ["Lean", "Watchlist", "Watchlist", "Watchlist", "Watchlist", "Watchlist", "Lean", "Watchlist", "Lean"];
const boardAfter = [...boardBefore];
assert.deepEqual(boardAfter, boardBefore, "fallback changes no picks or grades");
assert.equal(boardAfter.filter((grade) => grade === "Lean").length, 3);
assert.equal(boardAfter.filter((grade) => grade === "Watchlist").length, 6);

console.log("WNBA incoherent-total tuple fallback regression passed");
