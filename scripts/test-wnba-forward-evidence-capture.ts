import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPECTED_WNBA_DISTRIBUTION_VERSION,
  EXPECTED_WNBA_GRADE_POLICY_VERSION,
  EXPECTED_WNBA_MODEL_VERSION,
} from "../lib/automodel/wnbaChampionRuntime";
import {
  computeWnbaPrediction,
  SHARP_BOOKS,
  type ModelState,
  type OddRow,
} from "../lib/services/wnba/buildWnbaDailyEdgePreview";
import {
  WNBA_PREDICTION_RECORD_CONTRACT_VERSION,
} from "../lib/services/wnba/buildWnbaPredictionRecords";
import {
  WNBA_DECISION_TUPLE_CONTRACT_VERSION,
  type WnbaDecisionTuple,
} from "../lib/services/wnba/wnbaDecisionTuple";
import {
  buildWnbaForwardEvidenceCapture,
  readWnbaForwardEvidenceCapture,
  WNBA_FORWARD_EVIDENCE_MAX_BOOKS_PER_MARKET,
  WNBA_FORWARD_EVIDENCE_CURRENT_FRESH_MS,
  WNBA_FORWARD_EVIDENCE_MAX_GAME_BYTES,
  WNBA_FORWARD_EVIDENCE_MAX_MARKET_BYTES,
  WNBA_FORWARD_EVIDENCE_MAX_PAIR_SKEW_MS,
  wnbaForwardEvidenceMarketSlice,
  type WnbaForwardChampionOutput,
  type WnbaForwardEvidenceLineRow,
  type WnbaIndependentModelEvidence,
} from "../lib/services/wnba/wnbaForwardEvidenceCapture";

const capturedAt = "2026-09-02T18:00:00.000Z";
const startsAt = "2026-09-02T23:00:00.000Z";
const openingAt = "2026-09-02T12:00:00.000Z";

const fixtureModel: ModelState = {
  elo: new Map([[10, 1513.37], [30, 1491.19]]),
  games: new Map([[10, 21], [30, 17]]),
  pf: new Map([[10, [81.2, 89.7, 84.1]], [30, [86.8, 83.4, 91.1]]]),
  pa: new Map([[10, [79.3, 82.4, 90.6]], [30, [80.2, 84.8, 86.3]]]),
  margins: new Map([[10, [1.9, 7.3, -6.5]], [30, [6.6, -1.4, 4.8]]]),
  lastGameDate: new Map([[10, "2026-08-30"], [30, "2026-08-31"]]),
  leagueAvgScore: 83.15,
  leagueAvgTotal: 166.3,
  nameById: new Map([[10, "Phoenix Mercury"], [30, "Toronto Tempo"]]),
  mascot: [],
  rawGames: [],
  computedAt: Date.parse(capturedAt),
};

const fixtureOdds: OddRow[] = ["draftkings", "betmgm", "circa"].flatMap((book, index) => [
  { book, sharp: true, mkt: "moneyline", selType: "home", odds: -145 - index, line: null, date: "2026-09-02", h: 30, a: 10 },
  { book, sharp: true, mkt: "moneyline", selType: "away", odds: 125 + index, line: null, date: "2026-09-02", h: 30, a: 10 },
  { book, sharp: true, mkt: "point_spread", selType: "home", odds: -110, line: -3.5, date: "2026-09-02", h: 30, a: 10 },
  { book, sharp: true, mkt: "point_spread", selType: "away", odds: -110, line: 3.5, date: "2026-09-02", h: 30, a: 10 },
  { book, sharp: true, mkt: "total_points", selType: "over", odds: -112, line: 168.5, date: "2026-09-02", h: 30, a: 10 },
  { book, sharp: true, mkt: "total_points", selType: "under", odds: -108, line: 168.5, date: "2026-09-02", h: 30, a: 10 },
]);

const independentBox: { value: WnbaIndependentModelEvidence | null } = { value: null };
const championBaseline = computeWnbaPrediction(
  fixtureModel,
  { id: 77, date: "2026-09-02", h: 30, a: 10 },
  fixtureOdds,
);
const championObserved = computeWnbaPrediction(
  fixtureModel,
  { id: 77, date: "2026-09-02", h: 30, a: 10 },
  fixtureOdds,
  {},
  undefined,
  (value) => { independentBox.value = value; },
);
assert.equal(
  JSON.stringify(championObserved),
  JSON.stringify(championBaseline),
  "the audit observer must leave the complete champion output byte-identical",
);
const championWithFailedObserver = computeWnbaPrediction(
  fixtureModel,
  { id: 77, date: "2026-09-02", h: 30, a: 10 },
  fixtureOdds,
  {},
  undefined,
  () => { throw new Error("capture unavailable"); },
);
assert.equal(
  JSON.stringify(championWithFailedObserver),
  JSON.stringify(championBaseline),
  "capture failure must remain identity-neutral for the complete champion output",
);
assert.ok(independentBox.value, "the synchronous observer receives independent-model evidence");
const independent = independentBox.value as WnbaIndependentModelEvidence;
assert.equal(
  independent.home_win_probability,
  championObserved.model.home_win_prob,
  "capture and champion retain the same full-precision independent probability without quantization",
);

const currentRows: WnbaForwardEvidenceLineRow[] = [
  ...["draftkings", "betmgm", "circa"].flatMap((sportsbook, index) => [
    { market_type: "moneyline", side: "home", sportsbook, line_value: null, odds_american: -145 - index, fetched_at: capturedAt },
    { market_type: "moneyline", side: "away", sportsbook, line_value: null, odds_american: 125 + index, fetched_at: capturedAt },
    { market_type: "spread", side: "home", sportsbook, line_value: -3.5, odds_american: -110, fetched_at: capturedAt },
    { market_type: "spread", side: "away", sportsbook, line_value: 3.5, odds_american: -110, fetched_at: capturedAt },
    { market_type: "total", side: "over", sportsbook, line_value: 168.5, odds_american: -112, fetched_at: capturedAt },
    { market_type: "total", side: "under", sportsbook, line_value: 168.5, odds_american: -108, fetched_at: capturedAt },
  ]),
  // These cannot become synthetic pairs: different books and mismatched lines.
  { market_type: "moneyline", side: "home", sportsbook: "only-home", line_value: null, odds_american: -105, fetched_at: capturedAt },
  { market_type: "moneyline", side: "away", sportsbook: "only-away", line_value: null, odds_american: -105, fetched_at: capturedAt },
  { market_type: "total", side: "over", sportsbook: "mismatch", line_value: 169.5, odds_american: -110, fetched_at: capturedAt },
  { market_type: "total", side: "under", sportsbook: "mismatch", line_value: 168.5, odds_american: -110, fetched_at: capturedAt },
  // The line-only provider fallback is retained as missing, never priced at 50/50.
  { market_type: "total", side: "over", sportsbook: "playbook_consensus", line_value: 168.5, odds_american: null, fetched_at: capturedAt },
  { market_type: "total", side: "under", sportsbook: "playbook_consensus", line_value: 168.5, odds_american: null, fetched_at: capturedAt },
];

const historyRows: WnbaForwardEvidenceLineRow[] = ["draftkings", "betmgm", "circa"].flatMap((sportsbook) => [
  { market_type: "moneyline", side: "home", sportsbook, line_value: null, odds_american: -135, recorded_at: openingAt },
  { market_type: "moneyline", side: "away", sportsbook, line_value: null, odds_american: 115, recorded_at: openingAt },
  { market_type: "spread", side: "home", sportsbook, line_value: -2.5, odds_american: -108, recorded_at: openingAt },
  { market_type: "spread", side: "away", sportsbook, line_value: 2.5, odds_american: -112, recorded_at: openingAt },
  { market_type: "total", side: "over", sportsbook, line_value: 167.5, odds_american: -110, recorded_at: openingAt },
  { market_type: "total", side: "under", sportsbook, line_value: 167.5, odds_american: -110, recorded_at: openingAt },
]);

function tuple(
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
  line: number | null,
): WnbaDecisionTuple {
  return {
    contract_version: WNBA_DECISION_TUPLE_CONTRACT_VERSION,
    market,
    side,
    line,
    model_probability: 0.6123456789,
    market_fair_probability: 0.5912345678,
    market_fair_probability_source: "target_excluded_complete_pairs",
    market_fair_probability_book_count: 4,
    outcome_confidence: 0.61,
    bet_grade: "Lean",
    evaluated_price_american: market === "moneyline" ? -145 : -110,
    evaluated_sportsbook: "draftkings",
    evaluated_at: capturedAt,
    decision_at: capturedAt,
    model_version: EXPECTED_WNBA_MODEL_VERSION,
    distribution_version: EXPECTED_WNBA_DISTRIBUTION_VERSION,
    grade_policy_version: EXPECTED_WNBA_GRADE_POLICY_VERSION,
  };
}

const championOutput: WnbaForwardChampionOutput = {
  projected_score: championObserved.projected_score,
  model: championObserved.model,
  market: championObserved.market,
  trusted: championObserved.trusted,
  sharp: championObserved.sharp,
  consensus_source: championObserved.consensus_source,
  dynamic_market_weight: championObserved.dynamic_market_weight,
  outcomes: {
    moneyline: { side: "home", line: null, confidence: championObserved.moneyline.confidence, grade: championObserved.moneyline.grade },
    spread: { side: "home", line: -3.5, confidence: championObserved.spread.confidence, grade: championObserved.spread.grade },
    total: { side: "over", line: 168.5, confidence: championObserved.total.confidence, grade: championObserved.total.grade },
  },
};

const capture = buildWnbaForwardEvidenceCapture({
  game: { gameId: 77, externalId: 987654, slateDate: "2026-09-02", startsAt },
  capturedAt,
  decisionAt: capturedAt,
  releases: {
    model_version: EXPECTED_WNBA_MODEL_VERSION,
    distribution_version: EXPECTED_WNBA_DISTRIBUTION_VERSION,
    grade_policy_version: EXPECTED_WNBA_GRADE_POLICY_VERSION,
    decision_tuple_contract_version: WNBA_DECISION_TUPLE_CONTRACT_VERSION,
    prediction_record_contract_version: WNBA_PREDICTION_RECORD_CONTRACT_VERSION,
  },
  trustedBooks: SHARP_BOOKS,
  currentRows,
  historyRows,
  historyRowsTruncated: false,
  publicSignalRows: [
    { market_type: "moneyline", side: "home", public_betting_pct: 57, public_money_pct: 63, computed_at: openingAt },
    { market_type: "moneyline", side: "away", public_betting_pct: 43, public_money_pct: 37, computed_at: openingAt },
  ],
  sourceAwareSplitRows: [
    ...["home", "away"].map((side, index) => ({
      canonical_event_id: "987654",
      canonical_market_id: "987654:moneyline",
      market_type: "moneyline",
      selection_key: `987654:moneyline:${side}`,
      provider: "sharpapi",
      source_book: "circa",
      source_type: "sharp_adjacent_book",
      bets_pct: index === 0 ? 0.52 : 0.48,
      money_pct: index === 0 ? 0.58 : 0.42,
      market_line: null,
      market_price: index === 0 ? -145 : 125,
      split_line_basis: "provider_explicit",
      books_used: null,
      provider_event_id: "sharp-1",
      source_observed_at: openingAt,
      fetched_at: openingAt,
      source_timestamp_verified: true,
      minutes_to_start: 660,
      ingestion_run_id: "wnba:2026-09-02:opening",
    })),
    // Future rows are not predecision evidence.
    ...["home", "away"].map((side) => ({
      canonical_event_id: "987654", market_type: "moneyline", selection_key: `987654:moneyline:${side}`,
      provider: "sharpapi", source_book: "circa", source_type: "sharp_adjacent_book",
      bets_pct: 0.5, money_pct: 0.5, source_observed_at: "2026-09-02T19:00:00Z",
      fetched_at: "2026-09-02T19:00:00Z", source_timestamp_verified: true,
    })),
  ],
  sourceAwareRowsTruncated: false,
  sourceAwareUnavailableReason: null,
  decisionTuples: {
    moneyline: tuple("moneyline", "home", null),
    spread: tuple("spread", "home", -3.5),
    total: tuple("total", "over", 168.5),
  },
  independentModel: independent,
  championOutput,
});

assert.ok(readWnbaForwardEvidenceCapture(capture));
assert.equal(capture.production_decision_effect, false);
assert.deepEqual(capture.champion_output, championOutput, "capture copies champion numbers without rewriting them");
assert.equal(capture.markets.moneyline.current_book_pairs.length, 3, "only complete same-book pairs are retained");
assert.equal(capture.markets.total.current_book_pairs.length, 3, "mismatched totals and line-only fallbacks are unavailable");
assert.ok(capture.markets.moneyline.current_book_pairs.some((pair) => pair.sportsbook === "circa" && pair.source_class === "circa"));
assert.ok(capture.markets.moneyline.current_book_pairs.every((pair) =>
  Math.abs(pair.quotes[0].fair_probability + pair.quotes[1].fair_probability - 1) < 1e-12
));
assert.ok(capture.markets.moneyline.current_book_pairs.every((pair) => pair.pair_skew_ms === 0));
assert.ok(capture.markets.moneyline.current_book_pairs.every((pair) => pair.freshness_status === "fresh"));
assert.equal(capture.markets.spread.same_book_movement.find((row) => row.sportsbook === "draftkings")?.line_delta, -1);
assert.equal(capture.markets.total.same_book_movement.find((row) => row.sportsbook === "draftkings")?.line_delta, 1);
assert.ok(capture.markets.moneyline.opening_book_pairs.every((pair) => pair.opening_provenance === "first_observed"));
assert.ok(!capture.markets.moneyline.evaluation.target_excluded_complete_pair_books.includes("draftkings"));
assert.deepEqual(
  capture.markets.moneyline.evaluation.target_excluded_complete_pair_books.sort(),
  ["betmgm", "circa"],
  "the exact evaluated quote is excluded while independent complete alternatives remain",
);
assert.equal(capture.markets.moneyline.champion_public_input[0]?.row_level_provider_provenance, null);
assert.equal(capture.markets.moneyline.source_aware_public_pairs.length, 1);
assert.equal(capture.markets.moneyline.source_aware_public_pairs[0]?.source_book, "circa");
assert.equal(capture.markets.moneyline.source_aware_public_pairs[0]?.source_type, "sharp_adjacent_book");
assert.equal(capture.markets.total.source_aware_public_pairs.length, 0, "missing optional public evidence remains absent");
assert.equal(
  capture.markets.total.coverage.champion_public_input_unavailable_reason,
  "no_champion_public_rows_in_incumbent_result_set",
);
assert.equal(capture.unavailable_independent_inputs.injury_news, null, "unavailable injury/news input is not fabricated");
assert.ok(JSON.stringify(capture).length > 0);
assert.ok(new TextEncoder().encode(JSON.stringify(capture)).byteLength <= WNBA_FORWARD_EVIDENCE_MAX_GAME_BYTES);
assert.equal(
  capture.coverage.payload_bytes,
  new TextEncoder().encode(JSON.stringify(capture)).byteLength,
  "game payload reports its exact self-inclusive byte length",
);

for (const market of ["moneyline", "spread", "total"] as const) {
  const slice = wnbaForwardEvidenceMarketSlice(capture, market);
  assert.ok(slice);
  assert.deepEqual(Object.keys(slice.markets), [market]);
  assert.ok(new TextEncoder().encode(JSON.stringify(slice)).byteLength <= WNBA_FORWARD_EVIDENCE_MAX_MARKET_BYTES);
}

const manyCurrent: WnbaForwardEvidenceLineRow[] = Array.from({ length: 35 }).flatMap((_, index) => {
  const sportsbook = index === 0
    ? "draftkings"
    : index === 34
      ? "circa"
      : `book-${String(index).padStart(2, "0")}`;
  return [
    { market_type: "moneyline", side: "home", sportsbook, line_value: null, odds_american: -110, fetched_at: capturedAt },
    { market_type: "moneyline", side: "away", sportsbook, line_value: null, odds_american: -110, fetched_at: capturedAt },
  ];
});
const bounded = buildWnbaForwardEvidenceCapture({
  game: { gameId: 78, externalId: 987655, slateDate: "2026-09-02", startsAt },
  capturedAt,
  decisionAt: capturedAt,
  releases: capture.releases,
  trustedBooks: SHARP_BOOKS,
  currentRows: manyCurrent,
  historyRows: [],
  historyRowsTruncated: true,
  publicSignalRows: [],
  sourceAwareSplitRows: [],
  sourceAwareRowsTruncated: false,
  sourceAwareUnavailableReason: "not present in incumbent result sets",
  decisionTuples: { moneyline: tuple("moneyline", "home", null) },
  independentModel: independent,
  championOutput,
});
assert.ok(bounded.markets.moneyline.current_book_pairs.length <= WNBA_FORWARD_EVIDENCE_MAX_BOOKS_PER_MARKET);
assert.ok(bounded.markets.moneyline.current_book_pairs.some((pair) => pair.sportsbook === "circa"), "exact Circa survives deterministic cap");
assert.ok(bounded.markets.moneyline.current_book_pairs.some((pair) => pair.sportsbook === "draftkings"), "evaluated book survives deterministic cap");
assert.equal(bounded.markets.moneyline.coverage.payload_truncated, true);
assert.equal(bounded.markets.moneyline.coverage.history_rows_truncated, true);
assert.equal(
  bounded.markets.total.coverage.current_pair_unavailable_reason,
  "no_complete_same_book_current_pair_in_incumbent_result_set",
);
assert.equal(
  bounded.markets.moneyline.coverage.opening_unavailable_reason,
  "incumbent_history_result_set_truncated",
);
assert.equal(
  bounded.markets.moneyline.coverage.source_aware_unavailable_reason,
  "not present in incumbent result sets",
);
assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).byteLength <= WNBA_FORWARD_EVIDENCE_MAX_GAME_BYTES);

const withinHomeAt = "2026-09-02T17:59:40.000Z";
const withinAwayAt = "2026-09-02T17:59:50.000Z";
const staleHomeAt = "2026-09-02T17:30:00.000Z";
const staleAwayAt = "2026-09-02T17:30:05.000Z";
const beyondHomeAt = "2026-09-02T17:58:00.000Z";
const beyondAwayAt = new Date(Date.parse(beyondHomeAt) + WNBA_FORWARD_EVIDENCE_MAX_PAIR_SKEW_MS + 1).toISOString();
const temporal = buildWnbaForwardEvidenceCapture({
  game: { gameId: 79, externalId: 987656, slateDate: "2026-09-02", startsAt },
  capturedAt,
  decisionAt: capturedAt,
  releases: capture.releases,
  trustedBooks: SHARP_BOOKS,
  currentRows: [
    { market_type: "moneyline", side: "home", sportsbook: "within-skew", line_value: null, odds_american: -115, recorded_at: withinHomeAt, fetched_at: "2026-09-02T17:59:52.000Z" },
    { market_type: "moneyline", side: "away", sportsbook: "within-skew", line_value: null, odds_american: 105, recorded_at: withinAwayAt, fetched_at: "2026-09-02T17:59:55.000Z" },
    { market_type: "moneyline", side: "home", sportsbook: "stale-pair", line_value: null, odds_american: -110, fetched_at: staleHomeAt },
    { market_type: "moneyline", side: "away", sportsbook: "stale-pair", line_value: null, odds_american: -110, fetched_at: staleAwayAt },
    { market_type: "moneyline", side: "home", sportsbook: "beyond-skew", line_value: null, odds_american: -110, fetched_at: beyondHomeAt },
    { market_type: "moneyline", side: "away", sportsbook: "beyond-skew", line_value: null, odds_american: -110, fetched_at: beyondAwayAt },
    { market_type: "moneyline", side: "home", sportsbook: "future", line_value: null, odds_american: -110, fetched_at: "2026-09-02T18:00:01.000Z" },
    { market_type: "moneyline", side: "away", sportsbook: "future", line_value: null, odds_american: -110, fetched_at: "2026-09-02T18:00:02.000Z" },
    { market_type: "moneyline", side: "home", sportsbook: "missing-time", line_value: null, odds_american: -110 },
    { market_type: "moneyline", side: "away", sportsbook: "missing-time", line_value: null, odds_american: -110 },
    { market_type: "moneyline", side: "home", sportsbook: "invalid-price", line_value: null, odds_american: 0, fetched_at: withinHomeAt },
    { market_type: "moneyline", side: "away", sportsbook: "invalid-price", line_value: null, odds_american: 0, fetched_at: withinAwayAt },
    { market_type: "total", side: "over", sportsbook: "total-beyond", line_value: 168.5, odds_american: -110, fetched_at: beyondHomeAt },
    { market_type: "total", side: "under", sportsbook: "total-beyond", line_value: 168.5, odds_american: -110, fetched_at: beyondAwayAt },
    { market_type: "spread", side: "home", sportsbook: "line-mismatch", line_value: -3.5, odds_american: -110, fetched_at: withinHomeAt },
    { market_type: "spread", side: "away", sportsbook: "line-mismatch", line_value: 4.5, odds_american: -110, fetched_at: withinAwayAt },
  ],
  historyRows: [],
  historyRowsTruncated: false,
  publicSignalRows: [],
  sourceAwareSplitRows: [],
  sourceAwareRowsTruncated: false,
  sourceAwareUnavailableReason: "not present in incumbent result sets",
  decisionTuples: {},
  independentModel: independent,
  championOutput,
});
const withinPair = temporal.markets.moneyline.current_book_pairs.find((pair) => pair.sportsbook === "within-skew");
assert.ok(withinPair, "complementary same-book sides inside the explicit skew window pair");
assert.equal(withinPair.pair_skew_ms, 10_000);
assert.equal(withinPair.pair_observed_at, withinAwayAt);
assert.equal(withinPair.pair_captured_at, "2026-09-02T17:59:55.000Z");
assert.deepEqual(withinPair.quotes.map((quote) => quote.observed_at), [withinHomeAt, withinAwayAt]);
assert.deepEqual(
  withinPair.quotes.map((quote) => quote.fetched_at),
  ["2026-09-02T17:59:52.000Z", "2026-09-02T17:59:55.000Z"],
);
assert.equal(withinPair.decision_age_ms, 10_000);
assert.equal(withinPair.freshness_status, "fresh");
assert.equal(withinPair.freshness_reason, "within_current_freshness_window");
const stalePair = temporal.markets.moneyline.current_book_pairs.find((pair) => pair.sportsbook === "stale-pair");
assert.ok(stalePair);
assert.ok(stalePair.decision_age_ms > WNBA_FORWARD_EVIDENCE_CURRENT_FRESH_MS);
assert.equal(stalePair.freshness_status, "stale");
assert.equal(stalePair.freshness_reason, "older_than_current_freshness_window");
assert.ok(!temporal.markets.moneyline.current_book_pairs.some((pair) => pair.sportsbook === "beyond-skew"));
assert.ok(!temporal.markets.moneyline.current_book_pairs.some((pair) => pair.sportsbook === "future"));
assert.ok(!temporal.markets.moneyline.current_book_pairs.some((pair) => pair.sportsbook === "missing-time"));
assert.equal(temporal.markets.moneyline.coverage.current_pair_candidates.first_side_rows_beyond_max_skew, 1);
assert.equal(temporal.markets.moneyline.coverage.current_line_rows.rows_future_to_decision, 2);
assert.equal(temporal.markets.moneyline.coverage.current_line_rows.rows_missing_timestamp, 2);
assert.equal(temporal.markets.moneyline.coverage.current_line_rows.rows_invalid, 2);
assert.equal(temporal.markets.moneyline.coverage.fresh_current_books, 1);
assert.equal(temporal.markets.moneyline.coverage.stale_current_books, 1);
assert.equal(temporal.markets.total.current_book_pairs.length, 0);
assert.equal(temporal.markets.total.coverage.current_pair_unavailable_reason, "no_complete_current_pair_within_max_skew");
assert.equal(temporal.markets.spread.current_book_pairs.length, 0, "same-book spread sides at unlike lines cannot pair");
assert.equal(temporal.markets.spread.coverage.current_pair_candidates.first_side_rows_without_complement, 1);

const writerSource = readFileSync("lib/services/wnba/runWnbaModel.ts", "utf8");
const recordSource = readFileSync("lib/services/wnba/buildWnbaPredictionRecords.ts", "utf8");
const captureSource = readFileSync("lib/services/wnba/wnbaForwardEvidenceCapture.ts", "utf8");
assert.match(writerSource, /if \(lockedSet\.has\(g\.id as number\)\) \{ result\.skippedLocked\+\+; continue; \}/);
assert.ok(
  writerSource.indexOf("lockedSet.has") < writerSource.indexOf("buildWnbaForwardEvidenceCapture({"),
  "locked game_predictions are excluded before evidence construction and upsert",
);
assert.match(recordSource, /const toWrite = result\.records\.filter\(\(r\) => !lockedRec\.has/);
assert.ok(recordSource.includes("WNBA_FORWARD_EVIDENCE_CAPTURE_KEY"));
assert.doesNotMatch(writerSource, /production_decision_effect:\s*true/);
assert.equal(
  (writerSource.match(/\.from\("line_history"\)/g) ?? []).length,
  1,
  "capture reuses the incumbent line-history read",
);
assert.equal(
  (writerSource.match(/\.from\(/g) ?? []).length,
  7,
  "natural capture preserves the incumbent seven-query writer surface",
);
assert.equal(
  (writerSource.match(/\.from\("game_predictions"\)/g) ?? []).length,
  2,
  "natural capture preserves one incumbent lock read and one incumbent upsert",
);
assert.equal(
  writerSource.includes("recorded_at, is_opener"),
  false,
  "capture does not widen the incumbent history query for provider-opener metadata",
);
assert.equal(
  writerSource.includes("public_money_pct, computed_at"),
  false,
  "capture does not widen the incumbent public query for provenance metadata",
);
assert.doesNotMatch(
  writerSource,
  /\.from\("market_split_observations_v2"\)/,
  "natural capture adds no source-aware database query",
);
assert.doesNotMatch(
  captureSource,
  /payload_bytes = byteLength\([^\n]+\);\s*\n\s*[^\n]*payload_bytes = byteLength/,
  "payload-byte accounting does not use duplicate corrective assignments",
);

console.log("WNBA forward evidence capture tests: PASS");
