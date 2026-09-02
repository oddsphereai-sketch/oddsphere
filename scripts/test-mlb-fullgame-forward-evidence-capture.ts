import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attachMlbFullGameForwardEvidence,
  mlbFullGameEvidenceAddedBytes,
  MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY,
  MLB_FULLGAME_MARKET_EVIDENCE_MAX_GAME_BYTES,
  MLB_FULLGAME_MARKET_EVIDENCE_MAX_MARKET_BYTES,
  type MlbFullGameCaptureLineRow,
  type MlbFullGameEvidenceArtifact,
} from "../lib/services/mlb/mlbFullGameForwardEvidenceCapture";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";

let assertions = 0;
function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  assertions += 1;
}
function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  assertions += 1;
}
function deepEqual(actual: unknown, expected: unknown, message: string): void {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}
function asObject(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function asArtifact(value: unknown): MlbFullGameEvidenceArtifact {
  return value as MlbFullGameEvidenceArtifact;
}

const cycle = "2026-09-02T16:00:00.000Z";
const baseSnapshot = {
  decision_pipeline: {
    release_id: "mlb_daily_edge_decision_2026_09_01_r76",
    original_side: "home",
    inversion_triggered: false,
    pick_calibration_applied: true,
    market_aware_correction_applied: true,
    raw_side_champion_applied: false,
    board_action: "bet",
  },
  ml_evaluation_price: {
    evaluated_book: "Pinnacle",
    evaluated_observed_at: "2026-09-02T15:59:20.000Z",
    policy_mode: "coherent_best_price",
  },
  odds_source_at_lock_ml: {
    home: { book: "Pinnacle", observedAt: "2026-09-02T15:59:20.000Z", source: "lines" },
    away: { book: "Pinnacle", observedAt: "2026-09-02T15:59:25.000Z", source: "lines" },
  },
  odds_source_at_lock_ou: {
    over: { book: "FanDuel", observedAt: "2026-09-02T15:58:20.000Z", source: "lines" },
    under: { book: "FanDuel", observedAt: "2026-09-02T15:58:24.000Z", source: "lines" },
  },
  pick_calibration: { rule_id: "fixture_pick_calibration" },
  existing_snapshot_key: { retained: true },
};

function record(market: "moneyline" | "total" | "first_inning"): PredictionRecordRow {
  const isMl = market === "moneyline";
  const isTotal = market === "total";
  return {
    game_prediction_id: 91,
    game_id: 22,
    external_id: 990022,
    sport: "mlb",
    slate_date: "2026-09-02",
    game_date: "2026-09-02T23:10:00.000Z",
    matchup: "WSH @ ATL",
    market,
    pick: isMl ? "ATL" : isTotal ? "Over 8.5" : "YRFI",
    side: isMl ? "home" : isTotal ? "over" : "yrfi",
    line_value: isTotal ? 8.5 : isMl ? null : 0.5,
    odds_american: isMl ? -142 : isTotal ? -108 : -115,
    odds_decimal: isMl ? 1.704225 : isTotal ? 1.925926 : 1.869565,
    model_used: "mlb_v2_2",
    model_version: "mlb_daily_edge_decision_2026_09_01_r76",
    prediction_source: "automodel_v2_2",
    confidence: isMl ? 56.8 : isTotal ? 54.1 : 53,
    model_probability: isMl ? 0.568 : isTotal ? 0.541 : 0.53,
    market_probability: isMl ? 0.586 : isTotal ? 0.519 : 0.535,
    edge: isMl ? -0.018 : isTotal ? 0.022 : -0.005,
    expected_value: isMl ? -0.032 : isTotal ? 0.041 : -0.01,
    play_grade: isMl ? "no_play" : isTotal ? "lean" : "no_play",
    prediction_type: "model",
    best_angle: false,
    no_bet: isMl || market === "first_inning",
    no_bet_reason: isMl ? "signed_market_resistance" : market === "first_inning" ? "fixture" : null,
    market_aligned: false,
    data_quality_tier: "high",
    source_quality: "high",
    provisional: false,
    held: false,
    hold_reason: null,
    launch_day: false,
    manual_outcome_expected: false,
    locked_at: null,
    published_at: "2026-09-02T16:00:02.000Z",
    snapshot_json: structuredClone(baseSnapshot),
    calibration_version: "mlb_calibration_v28",
  };
}

const prediction = {
  game_id: 22,
  computed_at: cycle,
  locked_at: null,
  predicted_ml_winner: "away",
  predicted_ou_side: "under",
  ml_confidence: 55.4,
  ou_confidence: 52.8,
  predicted_home_score: 4.21,
  predicted_away_score: 4.83,
  sport_specific: {
    model_layer_versions: {
      schema_version: "mlb_model_layer_schema_v9",
      projection_core: "mlb_projection_core_v2_2",
      coherent_market_price_map: "mlb_coherent_market_price_map_v1",
      ignored_extra: "must_not_bloat_capture",
    },
    v2_2_audit: {
      independent_home_runs: 4.37,
      independent_away_runs: 4.66,
      independent_total: 9.03,
      coherent_market_price_map: {
        release_id: "mlb_coherent_market_price_map_v1",
        moneyline_applied: true,
        total_applied: true,
        moneyline_home: { final_probability: 0.481, source_count: 5 },
        total_over: { final_probability: 0.523, source_count: 5 },
      },
    },
  },
};

const books = [
  ["Pinnacle", -142, 128],
  ["Circa", -138, 124],
  ["DraftKings", -140, 126],
  ["FanDuel", -139, 125],
] as const;
const currentLines: MlbFullGameCaptureLineRow[] = books.flatMap(([sportsbook, home, away], index) => [
  { market_type: "moneyline", side: "home", sportsbook, odds_american: home, line_value: null, fetched_at: `2026-09-02T15:59:${20 + index}.000Z` },
  { market_type: "moneyline", side: "away", sportsbook, odds_american: away, line_value: null, fetched_at: `2026-09-02T15:59:${24 + index}.000Z` },
  { market_type: "total", side: "over", sportsbook, odds_american: -108 - index, line_value: 8.5, fetched_at: `2026-09-02T15:58:${20 + index}.000Z` },
  { market_type: "total", side: "under", sportsbook, odds_american: -112 + index, line_value: 8.5, fetched_at: `2026-09-02T15:58:${24 + index}.000Z` },
  // This other-market pair must never leak into full-game evidence.
  { market_type: "first_inning_total", side: "over", sportsbook, odds_american: -300, line_value: 0.5, fetched_at: `2026-09-02T15:59:${20 + index}.000Z` },
  { market_type: "first_inning_total", side: "under", sportsbook, odds_american: 240, line_value: 0.5, fetched_at: `2026-09-02T15:59:${24 + index}.000Z` },
]);
const openers = books.flatMap(([sportsbook], index) => [
  { game_id: 22, market_type: "moneyline", side: "home", sportsbook, odds_american: -120 - index, line_value: null, recorded_at: `2026-09-02T12:00:0${index}.000Z` },
  { game_id: 22, market_type: "moneyline", side: "away", sportsbook, odds_american: 108 + index, line_value: null, recorded_at: `2026-09-02T12:00:1${index}.000Z` },
  { game_id: 22, market_type: "total", side: "over", sportsbook, odds_american: -105, line_value: 8.5, recorded_at: `2026-09-02T12:01:0${index}.000Z` },
  { game_id: 22, market_type: "total", side: "under", sportsbook, odds_american: -115, line_value: 8.5, recorded_at: `2026-09-02T12:01:1${index}.000Z` },
]);
const records = [record("moneyline"), record("total"), record("first_inning")];
const captured = attachMlbFullGameForwardEvidence({
  records,
  prediction,
  currentLines,
  historyRows: [],
  openerRows: openers,
  signals: [{
    market_type: "moneyline", side: "away", public_money_pct: 61, public_betting_pct: 38,
    has_steam_move: false, has_reverse_line_movement: true, rlm_direction: "away",
    signal_strength: "strong", computed_at: cycle, pinnacle_fair_probability: 0.51,
    is_plus_ev: true, ev_pct: 1.3, steam_detected_at: null, steam_books_count: 0,
  }],
  splitRows: [{
    market_type: "moneyline", selection_key: "ml:away", provider: "playbook",
    source_book: "consensus", source_type: "public", bets_pct: 38, money_pct: 61,
    source_observed_at: "2026-09-02T15:55:00.000Z", fetched_at: "2026-09-02T15:56:00.000Z",
  }],
});

equal(captured.length, records.length, "capture preserves record count");
equal(captured[2], records[2], "non-target FI record retains exact object identity");
for (let index = 0; index < records.length; index += 1) {
  const stripped = structuredClone(captured[index]);
  if (stripped.snapshot_json) delete stripped.snapshot_json[MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY];
  deepEqual(stripped, records[index], `record ${index} is byte/field identical after capture-only key removal`);
}

const mlArtifact = asArtifact(captured[0].snapshot_json?.[MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY]);
const totalArtifact = asArtifact(captured[1].snapshot_json?.[MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY]);
check(mlArtifact, "ML capture exists");
check(totalArtifact, "Total capture exists");
equal(Buffer.byteLength(JSON.stringify(mlArtifact)), mlArtifact.payload_bytes, "ML self-inclusive byte count is exact");
equal(Buffer.byteLength(JSON.stringify(totalArtifact)), totalArtifact.payload_bytes, "Total self-inclusive byte count is exact");
check(mlArtifact.payload_bytes <= MLB_FULLGAME_MARKET_EVIDENCE_MAX_MARKET_BYTES, "ML stays within market cap");
check(totalArtifact.payload_bytes <= MLB_FULLGAME_MARKET_EVIDENCE_MAX_MARKET_BYTES, "Total stays within market cap");
check(
  mlbFullGameEvidenceAddedBytes(mlArtifact) + mlbFullGameEvidenceAddedBytes(totalArtifact) <=
    MLB_FULLGAME_MARKET_EVIDENCE_MAX_GAME_BYTES,
  "combined serialized capture addition stays within game cap",
);
const mlCohort = mlArtifact.target_excluded_cohort;
deepEqual(mlCohort.retained_pair_identities, [
  "moneyline:circa:ml", "moneyline:fanduel:ml", "moneyline:draftkings:ml",
], "evaluated Pinnacle book is excluded from forecast cohort identity");
equal(mlCohort.sharp_book_count, 1, "target-excluded sharp count is truthful");
equal(mlCohort.retail_book_count, 2, "target-excluded retail count is truthful");
equal(mlCohort.incumbent_r76_breadth_eligible, false, "capture reports incumbent breadth without changing it");
const circa = mlArtifact.named_book_pairs.find((pair) => pair.normalized_sportsbook === "circa");
check(circa, "Circa pair is retained");
const circaOpening = asObject(circa.opening);
equal(circaOpening.positive_odds_american, -121, "opener is the same book");
equal(circaOpening.negative_odds_american, 109, "opener complement is the same book");
check(!mlArtifact.named_book_pairs.some((pair) => pair.line === 0.5), "FI rows cannot leak into full-game pair capture");
equal(mlArtifact.publication_correction.score_derived_side, "away", "score-derived winner is frozen");
equal(mlArtifact.publication_correction.published_side, "home", "published correction side is frozen separately");
equal(mlArtifact.publication_correction.published_side_matches_score, false, "legacy publication mismatch is explicit");

const lockedRecords = records.map((item) => ({ ...item, locked_at: cycle }));
const locked = attachMlbFullGameForwardEvidence({
  records: lockedRecords,
  prediction: { ...prediction, locked_at: cycle },
  currentLines,
  historyRows: [],
  openerRows: openers,
  signals: [],
  splitRows: [],
});
equal(locked, lockedRecords, "locked array identity is unchanged");
equal(locked[0], lockedRecords[0], "locked record identity is unchanged");

const observerFailure = attachMlbFullGameForwardEvidence({
  records,
  prediction,
  currentLines,
  historyRows: [],
  openerRows: openers,
  signals: [],
  splitRows: [],
  observer: () => { throw new Error("synthetic observer failure"); },
});
equal(observerFailure, records, "capture exception returns original array byte-identically");

const oversizeFailure = attachMlbFullGameForwardEvidence({
  records,
  prediction,
  currentLines,
  historyRows: [],
  openerRows: openers,
  signals: [],
  splitRows: [],
  limits: { maxMarketBytes: 1, maxGameBytes: 2 },
});
equal(oversizeFailure, records, "oversize capture returns original array byte-identically");

const stressBooks = Array.from({ length: 40 }, (_, index) => `Book ${String(index).padStart(2, "0")}`);
const stressLines: MlbFullGameCaptureLineRow[] = stressBooks.flatMap((sportsbook, index) => [
  { market_type: "moneyline", side: "home", sportsbook, odds_american: -101 - index, fetched_at: "2026-09-02T15:59:00.000Z" },
  { market_type: "moneyline", side: "away", sportsbook, odds_american: 100 + index, fetched_at: "2026-09-02T15:59:10.000Z" },
  { market_type: "total", side: "over", sportsbook, odds_american: -110, line_value: 8.5, fetched_at: "2026-09-02T15:59:00.000Z" },
  { market_type: "total", side: "under", sportsbook, odds_american: -110, line_value: 8.5, fetched_at: "2026-09-02T15:59:10.000Z" },
]);
function stressCapture(lines: MlbFullGameCaptureLineRow[]) {
  return attachMlbFullGameForwardEvidence({
    records,
    prediction,
    currentLines: lines,
    historyRows: [],
    openerRows: [],
    signals: Array.from({ length: 20 }, (_, index) => ({
      market_type: index % 2 === 0 ? "moneyline" : "total", side: index % 4 < 2 ? "home" : "away",
      public_money_pct: 50 + index, public_betting_pct: 40 + index, has_steam_move: false,
      has_reverse_line_movement: false, rlm_direction: null, signal_strength: "x".repeat(400),
      computed_at: cycle, pinnacle_fair_probability: 0.5, is_plus_ev: false, ev_pct: 0,
      steam_detected_at: null, steam_books_count: 0,
    })),
    splitRows: Array.from({ length: 30 }, (_, index) => ({
      market_type: index % 2 === 0 ? "moneyline" : "total", selection_key: `fixture:${index}`,
      provider: "fixture", source_book: `Book ${index}`, source_type: "public", bets_pct: index,
      money_pct: 100 - index, source_observed_at: cycle, fetched_at: cycle,
    })),
  });
}
const stressA = stressCapture(stressLines);
const stressB = stressCapture([...stressLines].reverse());
const stressMlA = asArtifact(stressA[0].snapshot_json?.[MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY]);
const stressMlB = asArtifact(stressB[0].snapshot_json?.[MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY]);
const stressOmitted = stressMlA.omitted_counts;
deepEqual(stressMlA, stressMlB, "stress pruning and ordering are deterministic under reversed input");
check(stressMlA.named_book_pairs.length <= 16, "stress capture obeys named-book count cap");
equal(
  stressMlA.named_book_pairs.length + Number(stressOmitted.named_book_pairs),
  40,
  "stress capture accounts for every retained and omitted pair",
);
check(Number(stressOmitted.named_book_pairs) >= 24, "stress capture reports count/byte-cap pair omissions");
check(Number(stressOmitted.source_aware_splits) > 0, "stress capture reports split omissions");
check(Number(stressOmitted.sharp_signals) > 0, "stress capture reports signal omissions");
check(stressMlA.payload_bytes <= MLB_FULLGAME_MARKET_EVIDENCE_MAX_MARKET_BYTES, "stress artifact obeys byte cap");

const serviceSource = readFileSync(new URL("../lib/services/predictionRecordService.ts", import.meta.url), "utf8");
equal((serviceSource.match(/\.from\(/g) ?? []).length, 16, "capture adds zero DB query paths");
equal((serviceSource.match(/\.upsert\(/g) ?? []).length, 1, "capture adds zero upsert paths");
equal((serviceSource.match(/\.insert\(/g) ?? []).length, 1, "capture adds zero insert paths");
const captureSource = readFileSync(new URL("../lib/services/mlb/mlbFullGameForwardEvidenceCapture.ts", import.meta.url), "utf8");
equal((captureSource.match(/\.from\(/g) ?? []).length, 0, "pure capture has no DB reads");
equal((captureSource.match(/fetch\(/g) ?? []).length, 0, "pure capture has no provider calls");

console.log(`MLB full-game forward evidence capture tests passed: ${assertions}`);
