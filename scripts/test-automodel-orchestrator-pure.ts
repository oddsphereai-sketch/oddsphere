/**
 * Phase 4B — pure unit tests for orchestrator projections + tallies.
 *
 * No DB. Tests the internal pure helpers exposed via
 * `__internalForTests` on the orchestrator module — projection
 * functions (AutoModelOutput → ProposedPrediction, PriorAutoRow →
 * PriorPredictionForStale) plus confidence-band, missing-starter,
 * and top-stale-reasons aggregators.
 *
 * Runs via:
 *   npx tsx scripts/test-automodel-orchestrator-pure.ts
 */

import {
  __internalForTests,
  type PriorAutoRow,
} from "../lib/services/automodelOrchestratorService";
import type {
  AutoModelOutput,
  AutoModelSportSpecific,
  StaleReport,
} from "../lib/automodel/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const {
  projectToProposedPrediction,
  projectToPriorSummary,
  projectToPriorPredictionForStale,
  projectToCurrentSnapshotForStale,
  buildConfidenceBands,
  countMissingStarter,
  countMissingMarketLine,
  topStaleReasons,
} = __internalForTests;

// ─── Fixture builders ────────────────────────────────────────────────

function makeSportSpecific(
  partial: Partial<AutoModelSportSpecific> = {}
): AutoModelSportSpecific {
  return {
    model_version: "auto_v1.0_mlb_rules",
    stage: "morning_draft",
    starter_confirmed: true,
    lineup_confirmed: false,
    market_line_available: true,
    opposing_deterministic_warning: false,
    listed_line: 8.5,
    held: false,
    hold_reason: null,
    hold_picks: [],
    stale: false,
    stale_reason: null,
    predicted_nrfi: false,
    nrfi_confidence: 58,
    auto_factors: {
      home_starter_id: 100,
      away_starter_id: 200,
      home_starter_era: 3.5,
      away_starter_era: 3.8,
      home_starter_era_factor: 0.95,
      away_starter_era_factor: 1.0,
      home_lineup_weighted_ops: 0.72,
      away_lineup_weighted_ops: 0.74,
      home_lineup_ops_factor_adjusted: 1.0,
      away_lineup_ops_factor_adjusted: 1.0,
      home_bullpen_factor: 1.0,
      away_bullpen_factor: 1.0,
      park_factor_runs: 1.0,
      weather_total_adjust: 0,
      league_avg_runs_used: 4.5,
      league_avg_era_used: 4.0,
      league_avg_ops_used: 0.73,
      stage_confidence_cap: 60,
      nrfi_expected_runs: 0.4,
      nrfi_used_fallback_era: false,
      nrfi_used_top_of_order_data: true,
    },
    ai_sanity: {
      action: "approve",
      reasoning: "stub",
      applied_confidence_delta: 0,
      applied_score_delta_home: 0,
      applied_score_delta_away: 0,
      warnings: [],
      deterministic_corrections: [],
    },
    ...partial,
  };
}

function makeAutoModelOutput(
  partial: Partial<Omit<AutoModelOutput, "sport_specific">> = {},
  sportSpecificOverride: Partial<AutoModelSportSpecific> = {}
): AutoModelOutput {
  return {
    game_external_id: 18599100,
    prediction_source: "auto_v1_mlb_rules",
    predicted_home_score: 4.6,
    predicted_away_score: 3.8,
    predicted_total: 8.4,
    predicted_ml_winner: "home",
    ml_confidence: 58.0,
    predicted_ou_side: "over",
    ou_confidence: 54.0,
    predicted_nrfi: false,
    nrfi_confidence: 58.0,
    sport_specific: makeSportSpecific(sportSpecificOverride),
    ...partial,
  };
}

function makePriorRow(
  game_external_id: number,
  sportSpecific: Record<string, unknown> = {},
  overrides: Partial<PriorAutoRow> = {}
): PriorAutoRow {
  return {
    game_id: game_external_id * 10,
    game_external_id,
    prediction_source: "auto_v1_mlb_rules",
    source_type: "real_api",
    is_override: false,
    model_version: "auto_v1.0_mlb_rules",
    computed_at: "2026-05-22T13:00:00.000Z",
    predicted_home_score: 4.5,
    predicted_away_score: 3.5,
    predicted_total: 8.0,
    predicted_ml_winner: "home",
    ml_confidence: 56,
    ml_grade: "sharp_confirmed",
    ml_signal_type: "balanced",
    ml_market_signal: "market_confirmed",
    predicted_ou_side: "under",
    ou_confidence: 53,
    ou_grade: "model_only",
    ou_signal_type: "model_only",
    ou_market_signal: "market_neutral",
    predicted_nrfi: true,
    nrfi_confidence: 57,
    nrfi_grade: "model_only",
    nrfi_signal_type: "model_only",
    nrfi_market_signal: "market_neutral",
    sport_specific: {
      stage: "morning_draft",
      starter_confirmed: true,
      lineup_confirmed: false,
      market_line_available: true,
      listed_line: 8.0,
      held: false,
      hold_picks: [],
      auto_factors: {
        home_starter_id: 100,
        away_starter_id: 200,
      },
      ...sportSpecific,
    },
    ...overrides,
  };
}

// ─── projectToProposedPrediction ─────────────────────────────────────
section("projectToProposedPrediction — AutoModelOutput → ProposedPrediction");

const sampleOutput = makeAutoModelOutput();
const proposed = projectToProposedPrediction(sampleOutput);
check(
  "game_external_id passthrough",
  proposed.game_external_id === 18599100
);
check(
  "scores + total passthrough",
  proposed.predicted_home_score === 4.6 &&
    proposed.predicted_away_score === 3.8 &&
    proposed.predicted_total === 8.4
);
check(
  "pick fields passthrough",
  proposed.predicted_ml_winner === "home" &&
    proposed.ml_confidence === 58.0 &&
    proposed.predicted_ou_side === "over" &&
    proposed.ou_confidence === 54.0 &&
    proposed.predicted_nrfi === false &&
    proposed.nrfi_confidence === 58.0
);
check(
  "held / hold_picks / hold_reason / stage from sport_specific",
  proposed.held === false &&
    proposed.hold_picks.length === 0 &&
    proposed.hold_reason === null &&
    proposed.stage === "morning_draft"
);

const heldOutput = makeAutoModelOutput(
  { predicted_ml_winner: null, ml_confidence: null },
  { held: false, hold_picks: ["ml"], hold_reason: "missing_or_scratched_starter" }
);
const heldProposed = projectToProposedPrediction(heldOutput);
check(
  "held=true mirrors through; hold_picks + hold_reason preserved",
  heldProposed.hold_picks.length === 1 &&
    heldProposed.hold_picks[0] === "ml" &&
    heldProposed.hold_reason === "missing_or_scratched_starter"
);

// ─── projectToPriorSummary ───────────────────────────────────────────
section("projectToPriorSummary — PriorAutoRow → PriorPredictionSummary");

const priorRow = makePriorRow(18599100);
const priorSummary = projectToPriorSummary(priorRow);
check(
  "prior_stage extracted from sport_specific.stage",
  priorSummary.prior_stage === "morning_draft"
);
check(
  "is_override + prediction_source passthrough",
  priorSummary.is_override === false &&
    priorSummary.prediction_source === "auto_v1_mlb_rules"
);
check(
  "scores + picks passthrough",
  priorSummary.predicted_home_score === 4.5 &&
    priorSummary.predicted_ml_winner === "home"
);
check(
  "prior_held + prior_hold_picks default to false/[]",
  priorSummary.prior_held === false && priorSummary.prior_hold_picks.length === 0
);

const heldPriorRow = makePriorRow(18599200, {
  held: true,
  hold_picks: ["ml", "ou", "nrfi"],
});
const heldPriorSummary = projectToPriorSummary(heldPriorRow);
check(
  "held=true row → prior_held=true; all 3 picks captured",
  heldPriorSummary.prior_held === true &&
    heldPriorSummary.prior_hold_picks.length === 3
);

const malformedRow = makePriorRow(18599300, {
  hold_picks: ["ml", 42, "garbage", "nrfi"] as unknown[],
});
const malformedSummary = projectToPriorSummary(malformedRow);
check(
  "malformed hold_picks entries filtered (only valid pick names survive)",
  malformedSummary.prior_hold_picks.length === 2 &&
    malformedSummary.prior_hold_picks.includes("ml") &&
    malformedSummary.prior_hold_picks.includes("nrfi")
);

const unknownStageRow = makePriorRow(18599400, { stage: "preseason_fake" });
const unknownStageSummary = projectToPriorSummary(unknownStageRow);
check(
  "unknown stage value → prior_stage=null (defensive)",
  unknownStageSummary.prior_stage === null
);

// ─── projectToPriorPredictionForStale ────────────────────────────────
section("projectToPriorPredictionForStale — sparse fields handled");

const standardPrior = projectToPriorPredictionForStale(priorRow);
check(
  "home_starter_id + away_starter_id pulled from sport_specific.auto_factors",
  standardPrior.home_starter_id === 100 && standardPrior.away_starter_id === 200
);
check(
  "starter_confirmed + lineup_confirmed pulled from sport_specific",
  standardPrior.starter_confirmed === true &&
    standardPrior.lineup_confirmed === false
);
check(
  "listed_total pulled from sport_specific.listed_line",
  standardPrior.listed_total === 8.0
);
check(
  "sharp_grade_direction derived from per-pick grades (sharp_confirmed → support)",
  standardPrior.sharp_grade_direction === "support"
);

// Build sparse row directly — makePriorRow's defaults would bleed through
// the spread merge. Real-world sparse rows have a minimal sport_specific
// (e.g., a pre-Phase-3A row predates many fields).
const sparsePriorRow: PriorAutoRow = {
  game_id: 18599500 * 10,
  game_external_id: 18599500,
  prediction_source: "auto_v1_mlb_rules",
  source_type: "real_api",
  is_override: false,
  model_version: "auto_v1.0_mlb_rules",
  computed_at: "2026-05-22T13:00:00.000Z",
  predicted_home_score: 4.5,
  predicted_away_score: 3.5,
  predicted_total: 8.0,
  predicted_ml_winner: "home",
  ml_confidence: 56,
  ml_grade: null,
  ml_signal_type: null,
  ml_market_signal: null,
  predicted_ou_side: "under",
  ou_confidence: 53,
  ou_grade: null,
  ou_signal_type: null,
  ou_market_signal: null,
  predicted_nrfi: true,
  nrfi_confidence: 57,
  nrfi_grade: null,
  nrfi_signal_type: null,
  nrfi_market_signal: null,
  sport_specific: {
    // Truly sparse — only the bare lifecycle marker
    stage: "morning_draft",
  },
};
const sparseProjection = projectToPriorPredictionForStale(sparsePriorRow);
check(
  "sparse sport_specific → all defensive nulls (no false positives)",
  sparseProjection.starter_confirmed === null &&
    sparseProjection.lineup_confirmed === null &&
    sparseProjection.home_starter_id === null &&
    sparseProjection.away_starter_id === null &&
    sparseProjection.listed_total === null &&
    sparseProjection.sharp_grade_direction === null
);

// ─── projectToCurrentSnapshotForStale ────────────────────────────────
section("projectToCurrentSnapshotForStale — from AutoModelOutput");

const current = projectToCurrentSnapshotForStale(sampleOutput);
check(
  "home_starter_external_id + away_starter_external_id from sport_specific.auto_factors",
  current.home_starter_external_id === 100 &&
    current.away_starter_external_id === 200
);
check(
  "starter_confirmed + lineup_confirmed passthrough",
  current.starter_confirmed === true && current.lineup_confirmed === false
);
check(
  "listed_total from sport_specific.listed_line",
  current.listed_total === 8.5
);
check(
  "Phase 4B intentionally null/zero for snapshot-stash fields (provider data, public splits, etc.)",
  current.pinnacle_ml_fair_prob_home === null &&
    current.pinnacle_ml_ev_pct === null &&
    current.public_betting_pct_home === null &&
    current.public_money_pct_home === null &&
    current.home_top3_hitters_injured_count === 0 &&
    current.away_top3_hitters_injured_count === 0
);
check(
  "provider_data_present defaults to true in 4B (we can't tell from output alone)",
  current.provider_data_present === true
);

// ─── buildConfidenceBands ────────────────────────────────────────────
section("buildConfidenceBands — min/max/mean across array");

const bandsAll = buildConfidenceBands([
  makeAutoModelOutput({ ml_confidence: 55, ou_confidence: 52, nrfi_confidence: 60 }),
  makeAutoModelOutput({ ml_confidence: 58, ou_confidence: 54, nrfi_confidence: 62 }),
  makeAutoModelOutput({ ml_confidence: 60, ou_confidence: 56, nrfi_confidence: 58 }),
]);
check(
  "ml: count=3, min=55, max=60, mean=57.7 (rounded to 1dp)",
  bandsAll.ml.count === 3 &&
    bandsAll.ml.min === 55 &&
    bandsAll.ml.max === 60 &&
    bandsAll.ml.mean === 57.7
);
check(
  "ou: mean=54 exactly",
  bandsAll.ou.count === 3 && bandsAll.ou.mean === 54
);
check(
  "nrfi: count=3 with mixed values",
  bandsAll.nrfi.count === 3 &&
    bandsAll.nrfi.min === 58 &&
    bandsAll.nrfi.max === 62
);

const bandsWithNulls = buildConfidenceBands([
  makeAutoModelOutput({ ml_confidence: null, ou_confidence: 52, nrfi_confidence: null }),
  makeAutoModelOutput({ ml_confidence: 58, ou_confidence: null, nrfi_confidence: 62 }),
]);
check(
  "ml: count=1 (null skipped), min=max=mean=58",
  bandsWithNulls.ml.count === 1 &&
    bandsWithNulls.ml.min === 58 &&
    bandsWithNulls.ml.mean === 58
);
check(
  "ou: count=1 (52), mean=52",
  bandsWithNulls.ou.count === 1 && bandsWithNulls.ou.mean === 52
);

const bandsEmpty = buildConfidenceBands([]);
check(
  "empty array → count=0, min/max/mean=null",
  bandsEmpty.ml.count === 0 &&
    bandsEmpty.ml.min === null &&
    bandsEmpty.ml.max === null &&
    bandsEmpty.ml.mean === null
);

const bandsAllNull = buildConfidenceBands([
  makeAutoModelOutput({ ml_confidence: null, ou_confidence: null, nrfi_confidence: null }),
]);
check(
  "all-null inputs → count=0, min/max/mean=null",
  bandsAllNull.ml.count === 0 && bandsAllNull.ml.mean === null
);

// ─── countMissingStarter ─────────────────────────────────────────────
section("countMissingStarter — heuristic on sport_specific.hold_reason");

const startersMissing = [
  makeAutoModelOutput({}, { hold_reason: "missing_or_scratched_starter" }),
  makeAutoModelOutput({}, { hold_reason: "missing_starter_nrfi" }),
  makeAutoModelOutput({}, { hold_reason: "starter_scratch_nrfi" }),
  makeAutoModelOutput({}, { hold_reason: null }),
  makeAutoModelOutput({}, { hold_reason: "all_picks_below_floor" }),
];
check(
  "counts only games with 'starter' in hold_reason or the canonical sentinel — got 3",
  countMissingStarter(startersMissing) === 3
);

// ─── countMissingMarketLine ──────────────────────────────────────────
section("countMissingMarketLine — sport_specific.listed_line=null");

const linesMissing = [
  makeAutoModelOutput({}, { listed_line: null }),
  makeAutoModelOutput({}, { listed_line: 8.5 }),
  makeAutoModelOutput({}, { listed_line: null }),
];
check(
  "counts games where listed_line is null — got 2",
  countMissingMarketLine(linesMissing) === 2
);

// ─── topStaleReasons ─────────────────────────────────────────────────
section("topStaleReasons — frequency aggregation");

function makeStaleReport(reasons: string[]): StaleReport {
  return {
    is_stale: reasons.length > 0,
    reasons,
    movement_deltas: {
      total_line_delta: null,
      ml_fair_prob_delta: null,
      ev_delta: null,
      public_betting_delta: null,
      public_money_delta: null,
      starter_changed: false,
      lineup_status_changed: false,
      sharp_grade_changed: false,
      provider_data_missing: false,
    },
    starter_change: {
      home_changed: false,
      away_changed: false,
      home_previous: null,
      home_current: null,
      away_previous: null,
      away_current: null,
    },
  };
}

const reports = [
  makeStaleReport(["line moved", "ev flipped"]),
  makeStaleReport(["line moved", "starter changed"]),
  makeStaleReport(["line moved"]),
  makeStaleReport(["ev flipped"]),
  null,
];
const topReasons = topStaleReasons(reports);
check(
  "top 5 default — '(line moved)' is rank 1 with count=3",
  topReasons.length >= 1 &&
    topReasons[0]?.reason === "line moved" &&
    topReasons[0]?.count === 3
);
check(
  "'(ev flipped)' is rank 2 with count=2",
  topReasons[1]?.reason === "ev flipped" && topReasons[1]?.count === 2
);
check(
  "'(starter changed)' is rank 3 with count=1",
  topReasons.find((r) => r.reason === "starter changed")?.count === 1
);

const noStale = topStaleReasons([null, null, makeStaleReport([])]);
check(
  "no stale reasons → empty array",
  noStale.length === 0
);

const topN = topStaleReasons(reports, 1);
check(
  "topN=1 limits the slice",
  topN.length === 1
);

// ─── Summary ──────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All orchestrator-pure tests passed.`);
