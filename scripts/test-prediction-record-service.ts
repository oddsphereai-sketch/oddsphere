/**
 * Push 4 — tests for the pure record-building portion of
 * predictionRecordService.
 *
 * Tests the synthesis logic that splits one game_predictions row
 * into ML/total/FI prediction_records. Pure / fixture-only — no DB.
 */

import { readFileSync } from "node:fs";
import {
  buildPredictionRecordsFromSlate,
  applyMlbMarketLedMovementLean,
  applyMlbNeutralConsensusGrades,
  applyMlbSharpPortfolioLean,
  americanToImpliedProb,
  buildPublicSplitsSnapshot,
  buildLineMovementSnapshot,
  buildDataIntegritySnapshot,
  applyPlayGradeGate,
  GATE_TOTAL_LEAN_MARKET_FRICTION_MAX_EDGE_PCT,
  FI_VALIDATED_BEST_ANGLE_RULE_ID,
  FI_LEAN_SIGNED_EDGE_PRICE_BEST_ANGLE_PROMOTION_RULE_ID,
  FI_PROVISIONAL_BEST_ANGLE_BLOCK_RULE_ID,
  FI_NRFI_MIDBAND_BEST_ANGLE_DEMOTION_RULE_ID,
  FI_PLUS_MONEY_LEAN_BEST_ANGLE_PROMOTION_RULE_ID,
  FI_CALIBRATED_MODEL_LEAN_PATH_ID,
  TOTAL_VALIDATED_LEAN_RULE_ID,
  TOTAL_UNDER_LOW_TICKET_RESISTANCE_LEAN_RULE_ID,
  TOTAL_SHARPAPI_SUPPORT_LEAN_RULE_ID,
  TOTAL_REJECTED_CORRECTION_ORIGINAL_SIDE_RULE_ID,
  TOTAL_CALIBRATED_MODEL_LEAN_PATH_ID,
  GATE_TOTAL_UNDER_BEST_ANGLE_MIN_MODEL_PROB,
  GATE_TOTAL_OVER_BEST_ANGLE_MIN_MODEL_PROB,
  MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID,
  ML_CALIBRATED_MODEL_LEAN_PATH_ID,
  ML_MARKET_DIVERGENCE_LEAN_RULE_ID,
  ML_MARKET_DIVERGENCE_MIN_MODEL_PROB,
  ML_SIGNED_MARKET_RESISTANCE_RULE_ID,
  ML_SHARP_PORTFOLIO_LEAN_RULE_ID,
  ML_MARKET_LED_MOVEMENT_LEAN_RULE_ID,
  ML_NEUTRAL_CONSENSUS_RULE_ID,
  ML_CONSENSUS_SUPPORT_CONTINUITY_LEAN_RULE_ID,
  ML_MID_PRICE_ESTABLISHED_PRICE_BEST_ANGLE_RULE_ID,
  ML_MID_PRICE_NEAR_MARKET_LEAN_RULE_ID,
  ML_TIGHT_MARKET_PRICE_BEST_ANGLE_RULE_ID,
  resolveMlMidPriceEstablishedPriceBestAngle,
  resolveMlMidPriceNearMarketLean,
  resolveMlMarketDivergenceLean,
  resolveMlSignedMarketResistance,
  resolveMlTightMarketPriceBestAngle,
  resolveMlbMarketAwareSideCorrection,
} from "../lib/services/predictionRecordService";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";
import {
  MLB_DAILY_EDGE_DECISION_RELEASE_ID,
  MLB_MODEL_LAYER_VERSION_SCHEMA,
} from "../lib/automodel/mlbModelLayerVersions";
import { TOTALS_MARKET_OPPOSED_FLIP_RULE_ID } from "../lib/services/totalsMeanFlip";

// Self-consistent expected-grade helper: apply the production gate to a record's
// own fields (fixtures don't set posterior_home_diff → run-gap null, so the
// ML-conviction branch is inert here; EV + low-total-line branches still apply).
function expectGate(raw: string | null, rec: { model_probability: number | null; odds_american: number | null; market: string; line_value: number | null }): string | null {
  return applyPlayGradeGate(raw, {
    modelProb: rec.model_probability, americanOdds: rec.odds_american,
    market: rec.market as "moneyline" | "total" | "first_inning",
    runGapAbs: null, totalLine: rec.market === "total" ? rec.line_value : null,
  });
}
function expectTotalGrade(raw: string | null, rec: { model_probability: number | null; odds_american: number | null; market: string; line_value: number | null; side: string | null }): string | null {
  let publicGrade = raw;
  const minProb =
    rec.side === "over"
      ? GATE_TOTAL_OVER_BEST_ANGLE_MIN_MODEL_PROB
      : rec.side === "under"
        ? GATE_TOTAL_UNDER_BEST_ANGLE_MIN_MODEL_PROB
        : null;
  if (raw === "best_angle" && minProb !== null && rec.model_probability !== null && rec.model_probability < minProb) {
    publicGrade = "lean";
  }
  const gapCap = (rec as any).snapshot_json?.total_lean_projection_gap_cap;
  if (publicGrade === "lean" && gapCap?.action === "cap_to_watchlist") return "market_aligned";
  const frictionCap = (rec as any).snapshot_json?.total_lean_market_friction_cap;
  if (publicGrade === "lean" && frictionCap?.action === "cap_to_watchlist") return "market_aligned";
  const unvalidatedCap = (rec as any).snapshot_json?.total_lean_recalibration_cap;
  if (publicGrade === "lean" && unvalidatedCap?.action === "cap_to_watchlist") return "market_aligned";
  return expectGate(publicGrade, rec);
}

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("━━━ MLB tight market-price Best Angle resolver ━━━");
const tightMarketPriceBase = {
  blocked: false,
  side: "home",
  edgePct: 0.5,
  oddsAmerican: -145,
  lineDirection: "neutral" as const,
  publicSplitConflict: false,
};
check("clean -131..-160 moneyline within 1pp promotes", resolveMlTightMarketPriceBestAngle(tightMarketPriceBase).bestAngle === true);
check("-160 price boundary promotes", resolveMlTightMarketPriceBestAngle({ ...tightMarketPriceBase, oddsAmerican: -160 }).bestAngle === true);
check("-131 price boundary promotes", resolveMlTightMarketPriceBestAngle({ ...tightMarketPriceBase, oddsAmerican: -131 }).bestAngle === true);
check("edge -1 boundary promotes", resolveMlTightMarketPriceBestAngle({ ...tightMarketPriceBase, edgePct: -1 }).bestAngle === true);
check("edge +1 upper boundary does not promote", resolveMlTightMarketPriceBestAngle({ ...tightMarketPriceBase, edgePct: 1 }).bestAngle === false);
check("movement against pick blocks promotion", resolveMlTightMarketPriceBestAngle({ ...tightMarketPriceBase, lineDirection: "against_pick" }).bestAngle === false);
check("opposing split conflict blocks promotion", resolveMlTightMarketPriceBestAngle({ ...tightMarketPriceBase, publicSplitConflict: true }).bestAngle === false);
check("corrected/blocked row cannot promote", resolveMlTightMarketPriceBestAngle({ ...tightMarketPriceBase, blocked: true }).bestAngle === false);

console.log("\n━━━ MLB mid-price Best Angle / Lean tier resolver ━━━");
const midPriceLeanBase = {
  blocked: false,
  side: "home",
  edgePct: 1.1,
  oddsAmerican: -141,
  sameSideProjectionGap: 0.5,
  lineDirection: "neutral" as const,
  publicSplitConflict: false,
  dataStatus: "provisional_starters_pending",
};
check("clean -145..-131 established-price moneyline promotes to Best Angle", resolveMlMidPriceEstablishedPriceBestAngle(midPriceLeanBase).bestAngle === true);
check("-145 Best Angle price boundary promotes", resolveMlMidPriceEstablishedPriceBestAngle({ ...midPriceLeanBase, oddsAmerican: -145 }).bestAngle === true);
check("-131 Best Angle price boundary promotes", resolveMlMidPriceEstablishedPriceBestAngle({ ...midPriceLeanBase, oddsAmerican: -131 }).bestAngle === true);
check("-146 does not enter the Best Angle tier", resolveMlMidPriceEstablishedPriceBestAngle({ ...midPriceLeanBase, oddsAmerican: -146 }).bestAngle === false);
check("-130 does not enter the Best Angle tier", resolveMlMidPriceEstablishedPriceBestAngle({ ...midPriceLeanBase, oddsAmerican: -130 }).bestAngle === false);
check("projection opposition blocks Best Angle promotion", resolveMlMidPriceEstablishedPriceBestAngle({ ...midPriceLeanBase, sameSideProjectionGap: -0.1 }).bestAngle === false);
check("incomplete required data blocks Best Angle promotion", resolveMlMidPriceEstablishedPriceBestAngle({ ...midPriceLeanBase, dataStatus: "incomplete_missing_required_data" }).bestAngle === false);
check("clean -130..-121 near-market moneyline promotes to Lean", resolveMlMidPriceNearMarketLean({ ...midPriceLeanBase, oddsAmerican: -125 }).lean === true);
check("-130 Lean price boundary promotes", resolveMlMidPriceNearMarketLean({ ...midPriceLeanBase, oddsAmerican: -130 }).lean === true);
check("-121 Lean price boundary promotes", resolveMlMidPriceNearMarketLean({ ...midPriceLeanBase, oddsAmerican: -121 }).lean === true);
check("-131 does not enter the Lean tier", resolveMlMidPriceNearMarketLean({ ...midPriceLeanBase, oddsAmerican: -131 }).lean === false);
check("-120 does not enter the Lean cohort", resolveMlMidPriceNearMarketLean({ ...midPriceLeanBase, oddsAmerican: -120 }).lean === false);
check("edge +2 upper boundary does not promote", resolveMlMidPriceNearMarketLean({ ...midPriceLeanBase, edgePct: 2 }).lean === false);
check("projection opposition blocks Lean promotion", resolveMlMidPriceNearMarketLean({ ...midPriceLeanBase, sameSideProjectionGap: -0.1 }).lean === false);
check("incomplete required data blocks Lean promotion", resolveMlMidPriceNearMarketLean({ ...midPriceLeanBase, dataStatus: "incomplete_missing_required_data" }).lean === false);

console.log("\n━━━ MLB market-divergence Lean resolver ━━━");
const marketDivergenceLeanBase = {
  blocked: false,
  side: "home",
  oddsAmerican: -118,
  modelProb: 0.54,
  pickedBetsPct: 47,
  pickedMoneyPct: 57,
  lineDirection: "neutral" as const,
  publicSplitConflict: false,
};
const marketDivergenceLean = resolveMlMarketDivergenceLean(marketDivergenceLeanBase);
check(
  "10-point money-over-ticket gap promotes to Lean",
  marketDivergenceLean.lean === true &&
    marketDivergenceLean.reason === ML_MARKET_DIVERGENCE_LEAN_RULE_ID &&
    marketDivergenceLean.moneyOverTicketsGap === 10,
);
check(
  "gap below 10 does not promote",
  resolveMlMarketDivergenceLean({ ...marketDivergenceLeanBase, pickedMoneyPct: 56.9 }).lean === false,
);
check(
  "model probability below the guarded 54% boundary does not promote",
  resolveMlMarketDivergenceLean({
    ...marketDivergenceLeanBase,
    modelProb: ML_MARKET_DIVERGENCE_MIN_MODEL_PROB - 0.001,
  }).lean === false,
);
check(
  "movement against the pick blocks promotion",
  resolveMlMarketDivergenceLean({ ...marketDivergenceLeanBase, lineDirection: "against_pick" }).lean === false,
);
check(
  "missing real picked-side price blocks promotion",
  resolveMlMarketDivergenceLean({ ...marketDivergenceLeanBase, oddsAmerican: null }).lean === false,
);
check(
  "explicit data-quality/prior-correction block is preserved",
  resolveMlMarketDivergenceLean({ ...marketDivergenceLeanBase, blocked: true }).lean === false,
);
const signedResistance = resolveMlSignedMarketResistance({
  blocked: false,
  side: "home",
  pickedBetsPct: 60,
  pickedMoneyPct: 50,
});
check(
  "signed 10-point money-below-tickets resistance stands down without selecting an opposite side",
  signedResistance.standDown === true &&
    signedResistance.reason === ML_SIGNED_MARKET_RESISTANCE_RULE_ID &&
    signedResistance.moneyOverTicketsGap === -10,
);
check(
  "signed resistance cannot override an existing inversion, calibration, or side correction",
  resolveMlSignedMarketResistance({
    blocked: true,
    side: "home",
    pickedBetsPct: 60,
    pickedMoneyPct: 40,
  }).standDown === false,
);

console.log("\n━━━ MLB Total split-signal correction precedence ━━━");
const totalSplitCorrectionBase = {
  market: "total" as const,
  side: "over",
  modelProb: 0.56,
  marketProb: 0.5,
  originalConfidence: 56,
  lineDirection: "neutral" as const,
  publicSplitSupport: false,
  publicSplitConflict: false,
  distanceCapApplied: false,
  homeOdds: null,
  awayOdds: null,
  overOdds: -112,
  underOdds: 105,
};
check(
  "supporting split does not manufacture an opposite-side correction",
  resolveMlbMarketAwareSideCorrection({
    ...totalSplitCorrectionBase,
    publicSplitSupport: true,
  }).applied === false,
);
const opposingTotalCorrection = resolveMlbMarketAwareSideCorrection({
  ...totalSplitCorrectionBase,
  publicSplitConflict: true,
});
check(
  "opposing split conflict retains the established correction trigger",
  opposingTotalCorrection.applied === true &&
    opposingTotalCorrection.correctedSide === "under" &&
    opposingTotalCorrection.reasons.includes("total_split_conflict_fade"),
);

// ── Game + prediction fixtures ────────────────────────────────────
const baseGame = {
  id: 14771,
  external_id: 5058728,
  game_date: "2026-06-06T18:20:00Z",
  slate_status: "published",
  home_team_id: 771,
  away_team_id: 780,
};

const freshFiLines = [
  { game_id: 14771, market_type: "first_inning_total", side: "under", sportsbook: "pinnacle", odds_american: -120, line_value: 0.5, fetched_at: "2026-06-06T16:10:00Z" },
  { game_id: 14771, market_type: "first_inning_total", side: "over", sportsbook: "pinnacle", odds_american: 105, line_value: 0.5, fetched_at: "2026-06-06T16:10:00Z" },
];
const freshFiLinesByGameId = new Map([[14771, freshFiLines]]);

const v21SportSpecific = {
  model_used: "v2_1",
  model_version: "auto_v2.1_mlb_prediction_integrity",
  hold_picks: ["nrfi"], // NRFI is held, ML+OU populated
  ml_play_grade: "lean",
  ou_play_grade: "best_angle",
  ml_prediction_type: "lean",
  ou_prediction_type: "best_angle",
  ml_best_angle_eligible: false,
  ou_best_angle_eligible: true,
  v2_data_quality_tier: "high",
  v2_provisional: false,
  v2_1_audit: { market_total: 7.5, market_home_win_prob: 0.5, market_away_win_prob: 0.5 },
};

const basePrediction = {
  id: 11936,
  game_id: 14771,
  predicted_ml_winner: "home",
  ml_confidence: 54.0,
  predicted_ou_side: "over",
  ou_confidence: 62.7,
  predicted_nrfi: null,
  nrfi_confidence: 52,
  prediction_source: "auto_v1_mlb_rules",
  is_override: false,
  locked_at: "2026-06-06T16:16:11.491Z",
  computed_at: "2026-06-06T16:09:00.000Z",
  sport_specific: v21SportSpecific,
  // Phase 6B.28 — fixtures for the lock substrate. Tests below override
  // these per-case when asserting the captured shape.
  predicted_home_score: 4.2,
  predicted_away_score: 3.8,
  ml_grade: "market_watch",
  ou_grade: "market_watch",
  nrfi_grade: null,
  ml_signal_type: null,
  ou_signal_type: null,
  nrfi_signal_type: null,
  ml_market_signal: null,
  ou_market_signal: null,
  nrfi_market_signal: null,
};

const abbrevByTeamId = new Map<number, string>([[771, "CHC"], [780, "SF"]]);
const predictionByGameId = new Map<number, typeof basePrediction>([[14771, basePrediction]]);

console.log("\n━━━ MLB sharp portfolio top-one Lean integration ━━━");
{
  const portfolioRecord = (
    gameId: number,
    matchup: string,
    odds: number,
    probability: number,
    bets: number,
    money: number,
    movementDirection: "neutral" | "toward_pick" | "against_pick",
    splitProvider = "sharpapi",
    movementMagnitude = movementDirection === "neutral" ? 0 : 1,
  ): PredictionRecordRow => ({
    game_prediction_id: gameId,
    game_id: gameId,
    external_id: gameId,
    sport: "mlb",
    slate_date: "2026-08-11",
    game_date: "2026-08-11T23:10:00Z",
    matchup,
    market: "moneyline",
    pick: "away",
    side: "away",
    line_value: null,
    odds_american: odds,
    odds_decimal: odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds),
    model_used: "v2_2",
    model_version: "auto_v2.2_mlb_full_game_projection",
    prediction_source: "auto_v2.2",
    confidence: probability * 100,
    model_probability: probability,
    market_probability: americanToImpliedProb(odds),
    edge: null,
    expected_value: null,
    play_grade: "market_aligned",
    prediction_type: null,
    best_angle: false,
    no_bet: false,
    no_bet_reason: null,
    market_aligned: true,
    data_quality_tier: "high",
    source_quality: "sharpapi_splits",
    provisional: false,
    held: false,
    hold_reason: null,
    launch_day: false,
    manual_outcome_expected: false,
    locked_at: null,
    published_at: null,
    snapshot_json: {
      public_splits: {
        picked_bets_pct: 50,
        picked_money_pct: 50,
      },
      source_aware_split_rows_at_lock: [
        {
          canonical_event_id: String(gameId),
          market_type: "moneyline",
          selection_key: `${gameId}:moneyline:away`,
          provider: splitProvider,
          source_book: splitProvider === "sharpapi" ? "sharp_adjacent" : "consensus",
          source_type: splitProvider === "sharpapi" ? "sharp_adjacent_book" : "multi_book_consensus",
          bets_pct: bets,
          money_pct: money,
          source_observed_at: "2026-08-11T16:00:00Z",
          fetched_at: "2026-08-11T16:00:00Z",
        },
        {
          canonical_event_id: String(gameId),
          market_type: "moneyline",
          selection_key: `${gameId}:moneyline:home`,
          provider: splitProvider,
          source_book: splitProvider === "sharpapi" ? "sharp_adjacent" : "consensus",
          source_type: splitProvider === "sharpapi" ? "sharp_adjacent_book" : "multi_book_consensus",
          bets_pct: 100 - bets,
          money_pct: 100 - money,
          source_observed_at: "2026-08-11T16:00:00Z",
          fetched_at: "2026-08-11T16:00:00Z",
        },
      ],
      line_movement: {
        direction: movementDirection,
        magnitude_pp: movementMagnitude,
        has_reverse_line_movement: false,
        has_steam_move: false,
      },
      data_integrity: {
        stale: "no",
        market_baseline_valid: "yes",
      },
      decision_pipeline: {
        board_action: "no_play",
        actionable_grade: null,
        action_rule_id: null,
      },
    },
  });
  const ranked = applyMlbSharpPortfolioLean([
    portfolioRecord(1, "CIN@CWS", 135, 0.60, 17, 61, "neutral"),
    portfolioRecord(2, "SEA@BAL", 108, 0.58, 30, 45, "neutral"),
    portfolioRecord(3, "LAA@LAD", 150, 0.65, 10, 80, "against_pick"),
  ]);
  const promoted = ranked.filter((record) => record.play_grade === "lean");
  check("sharp portfolio promotes at most one qualifying Moneyline", promoted.length === 1);
  check("sharp portfolio ranks the stronger qualified slate candidate first", promoted[0]?.matchup === "CIN@CWS");
  check(
    "sharp portfolio stamps its immutable action rule",
    (promoted[0]?.snapshot_json as any)?.decision_pipeline?.action_rule_id ===
      ML_SHARP_PORTFOLIO_LEAN_RULE_ID,
  );
  check(
    "movement against the pick remains ineligible despite strong other inputs",
    ranked.find((record) => record.matchup === "LAA@LAD")?.play_grade === "market_aligned",
  );
  const selectedSideFloor = applyMlbSharpPortfolioLean([
    portfolioRecord(4, "LOW@FLOOR", 150, 0.51, 20, 65, "neutral"),
  ]);
  check(
    "50%-plus model side can qualify when the joint market score clears price",
    selectedSideFloor[0]?.play_grade === "lean" &&
      (selectedSideFloor[0]?.snapshot_json as any)?.decision_pipeline?.action_rule_id ===
      ML_SHARP_PORTFOLIO_LEAN_RULE_ID,
  );
  const playbookOnly = applyMlbSharpPortfolioLean([
    portfolioRecord(5, "NO@SHARP", 150, 0.65, 10, 80, "neutral", "playbook"),
  ]);
  check(
    "portfolio ranker fails closed when its validated SharpAPI split is absent",
    playbookOnly[0]?.play_grade === "market_aligned",
  );
  const marketLed = applyMlbMarketLedMovementLean([
    portfolioRecord(6, "MARKET@LED", -165, 0.51, 60, 65, "toward_pick", "sharpapi", 1.5),
    portfolioRecord(7, "PILE@ON", -110, 0.60, 50, 60, "toward_pick", "sharpapi", 1.5),
    portfolioRecord(8, "NO@MOVE", 105, 0.60, 40, 45, "neutral"),
    portfolioRecord(9, "OUT@OF_SAMPLE", 105, 0.49, 40, 45, "toward_pick", "sharpapi", 1.5),
  ]);
  check(
    "market-led movement sleeve promotes a qualifying unchanged side without a 53/54/55% cutoff",
    marketLed[0]?.play_grade === "lean" &&
      (marketLed[0]?.snapshot_json as any)?.decision_pipeline?.action_rule_id ===
        ML_MARKET_LED_MOVEMENT_LEAN_RULE_ID,
  );
  check(
    "market-led movement sleeve rejects a 10-point SharpAPI money-ticket pile-on",
    marketLed[1]?.play_grade === "market_aligned",
  );
  check(
    "market-led movement sleeve requires a captured move toward the pick",
    marketLed[2]?.play_grade === "market_aligned",
  );
  check(
    "market-led movement sleeve does not extrapolate below its observed probability range",
    marketLed[3]?.play_grade === "market_aligned",
  );
  const neutralConsensus = applyMlbNeutralConsensusGrades([
    portfolioRecord(10, "STRONG@CONSENSUS", -185, 0.51, 90, 97, "neutral"),
    portfolioRecord(11, "LOWER@CONSENSUS", -130, 0.51, 60, 58, "neutral"),
    portfolioRecord(12, "BELOW@CONSENSUS", -130, 0.60, 54, 90, "neutral"),
    portfolioRecord(13, "MOVING@CONSENSUS", -130, 0.60, 90, 90, "toward_pick", "sharpapi", 2),
  ]);
  check(
    "70/70 neutral SharpAPI consensus promotes to Best Angle",
    neutralConsensus[0]?.play_grade === "best_angle" && neutralConsensus[0]?.best_angle === true &&
      (neutralConsensus[0]?.snapshot_json as any)?.decision_pipeline?.action_rule_id === ML_NEUTRAL_CONSENSUS_RULE_ID,
  );
  check("lower neutral-consensus bands do not borrow strength from the 70/70 tier", neutralConsensus[1]?.play_grade === "market_aligned");
  check("neutral consensus requires both ticket and money floors", neutralConsensus[2]?.play_grade === "market_aligned");
  check(
    "70/70 consensus steps down only to Lean when price movement turns favorable",
    neutralConsensus[3]?.play_grade === "lean" && neutralConsensus[3]?.best_angle === false &&
      (neutralConsensus[3]?.snapshot_json as any)?.decision_pipeline?.action_rule_id ===
        ML_CONSENSUS_SUPPORT_CONTINUITY_LEAN_RULE_ID,
  );
}

// ── Standard slate: 1 game, NRFI held → 2 records ────────────────
console.log("━━━ Slate with 1 game (NRFI held) → 2 records ━━━");
{
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId,
    abbrevByTeamId,
  });
  check("returns 2 records (ML + total, NRFI skipped)", recs.length === 2);
  check("includes moneyline record", recs.some((r) => r.market === "moneyline"));
  check("includes total record", recs.some((r) => r.market === "total"));
  check("does NOT include first_inning record", !recs.some((r) => r.market === "first_inning"));
}

console.log("\n━━━ Matchup label ━━━");
{
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId,
    abbrevByTeamId,
  });
  check("matchup is 'SF@CHC' (away@home)", recs[0]?.matchup === "SF@CHC");
}

console.log("\n━━━ V2.1 metadata propagation ━━━");
{
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId,
    abbrevByTeamId,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const ou = recs.find((r) => r.market === "total")!;
  check("ML model_used=v2_1", ml.model_used === "v2_1");
  check("ML model_version present", ml.model_version === "auto_v2.1_mlb_prediction_integrity");
  check("ML pick=home", ml.pick === "home");
  check("ML confidence=54.0", ml.confidence === 54.0);
  check("ML model_probability=0.54", ml.model_probability === 0.54);
  // Champion ML writer authority: the public grade sorter is calibrated
  // separately from raw prediction side. A 54% ML Lean is tracked but no
  // longer promoted as an actionable Lean.
  check("ML play_grade=lean@0.54 is capped to Watchlist", ml.play_grade === "market_aligned");
  check("ML best_angle=false", ml.best_angle === false);
  check("OU low-conviction Best Angle demoted", ou.best_angle === false);
  check("OU play_grade demoted below Best Angle", ou.play_grade !== "best_angle");
  check("OU line_value=7.5 (from v2_1_audit.market_total)", ou.line_value === 7.5);
  check("Data quality tier=high", ml.data_quality_tier === "high");
  check("Provisional=false", ml.provisional === false);
  check("snapshot_json preserved", ml.snapshot_json !== null && (ml.snapshot_json as Record<string, unknown>).model_used === "v2_1");
}

console.log("\n━━━ MLB total Under Best Angle quality gate ━━━");
{
  const lowProbUnderPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 62,
    sport_specific: {
      ...v21SportSpecific,
      ou_play_grade: "best_angle",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        market_total: 8.5,
        ou_model_prob: GATE_TOTAL_UNDER_BEST_ANGLE_MIN_MODEL_PROB - 0.01,
        ou_market_prob: 0.52,
        ou_edge_pct: 17,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, lowProbUnderPred]]),
    abbrevByTeamId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  const ba = (ou.snapshot_json as any)?.best_angle_resolution;
  check("low-prob Under pick still writes/tracks", ou.pick === "under" && ou.side === "under" && ou.no_bet === false);
  check("low-prob Under is not Best Angle", ou.best_angle === false);
  check("low-prob Under play_grade demotes below Best Angle", ou.play_grade !== "best_angle");
  check("low-prob Under demotion is snapshotted", ba?.total_under_quality_gate === true && ba?.demote_reason === "total_under_quality_gate");
}
{
  const highProbUnderPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 72,
    sport_specific: {
      ...v21SportSpecific,
      ou_play_grade: "best_angle",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        market_total: 8.5,
        ou_model_prob: GATE_TOTAL_UNDER_BEST_ANGLE_MIN_MODEL_PROB,
        ou_market_prob: 0.52,
        ou_edge_pct: 18,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, highProbUnderPred]]),
    abbrevByTeamId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  const ba = (ou.snapshot_json as any)?.best_angle_resolution;
  check("70%+ Under remains Best Angle", ou.best_angle === true && ou.play_grade === "best_angle");
  check("70%+ Under quality gate is false", ba?.total_under_quality_gate === false);
}

console.log("\n━━━ MLB total Over Best Angle quality gate ━━━");
{
  const lowProbOverPred = {
    ...basePrediction,
    predicted_ou_side: "over",
    ou_confidence: 62,
    predicted_home_score: 4.5,
    predicted_away_score: 4.5,
    sport_specific: {
      ...v21SportSpecific,
      ou_play_grade: "best_angle",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        market_total: 8.5,
        ou_model_prob: GATE_TOTAL_OVER_BEST_ANGLE_MIN_MODEL_PROB - 0.01,
        ou_market_prob: 0.52,
        ou_edge_pct: 17,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, lowProbOverPred]]),
    abbrevByTeamId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  const ba = (ou.snapshot_json as any)?.best_angle_resolution;
  check("low-prob Over pick still writes/tracks", ou.pick === "over" && ou.side === "over" && ou.no_bet === false);
  check("low-prob Over is not Best Angle", ou.best_angle === false);
  check("low-prob Over play_grade demotes below Best Angle", ou.play_grade !== "best_angle");
  check("low-prob Over demotion is snapshotted", ba?.total_over_quality_gate === true && ba?.demote_reason === "total_over_quality_gate");
}
{
  const highProbOverPred = {
    ...basePrediction,
    predicted_ou_side: "over",
    ou_confidence: 72,
    predicted_home_score: 4.5,
    predicted_away_score: 4.5,
    sport_specific: {
      ...v21SportSpecific,
      ou_play_grade: "best_angle",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        market_total: 8.5,
        ou_model_prob: GATE_TOTAL_OVER_BEST_ANGLE_MIN_MODEL_PROB,
        ou_market_prob: 0.52,
        ou_edge_pct: 18,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, highProbOverPred]]),
    abbrevByTeamId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  const ba = (ou.snapshot_json as any)?.best_angle_resolution;
  check("70%+ Over remains Best Angle", ou.best_angle === true && ou.play_grade === "best_angle");
  check("70%+ Over quality gate is false", ba?.total_over_quality_gate === false);
}

console.log("\n━━━ MLB Best Angle tracking/display guard under market-aware engine ━━━");
{
  const previousMarketAware = process.env.MARKET_AWARE_ENGINE_ENABLED;
  process.env.MARKET_AWARE_ENGINE_ENABLED = "true";
  try {
    const lowProbMarketAwarePred = {
      ...basePrediction,
      predicted_ou_side: "over",
      ou_confidence: 57,
      predicted_home_score: 5.6,
      predicted_away_score: 5.8,
      sport_specific: {
        ...v21SportSpecific,
        ou_play_grade: "best_angle",
        ou_best_angle_eligible: true,
        v2_2_audit: {
          market_total: 9.5,
          ou_model_prob: 0.57,
          ou_market_prob: 0.49,
          ou_edge_pct: 8,
          ou_requires_market_confirmation: true,
        },
      },
    };
    const recs = buildPredictionRecordsFromSlate({
      sport: "mlb",
      slateDate: "2026-06-06",
      launchDay: false,
      games: [baseGame],
      predictionByGameId: new Map([[14771, lowProbMarketAwarePred]]),
      abbrevByTeamId,
    });
    const ou = recs.find((r) => r.market === "total")!;
    const ba = (ou.snapshot_json as any)?.best_angle_resolution;
    check("market-aware engine still demotes unqualified total Best Angle", ou.best_angle === false);
    check("market-aware engine demotes unqualified public total grade", ou.play_grade === "market_aligned");
    check("market-aware engine snapshots Best Angle demotion", ba?.final_best_angle === false && ba?.demote_reason !== null);
  } finally {
    if (previousMarketAware === undefined) delete process.env.MARKET_AWARE_ENGINE_ENABLED;
    else process.env.MARKET_AWARE_ENGINE_ENABLED = previousMarketAware;
  }
}

console.log("\n━━━ MLB total clean strong Best Angle promotion ━━━");
{
  const cleanConfirmedTotalPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 58,
    predicted_home_score: 3.6,
    predicted_away_score: 3.8,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "market_aligned",
      ou_best_angle_eligible: false,
      v2_2_audit: {
        ou_play_grade: "market_aligned",
        market_total: 8,
        posterior_total: 7.2,
        ou_model_prob: 0.58,
        ou_market_prob: 0.525,
        ou_edge_pct: 5.5,
      },
    },
  };
  const openersByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: -105, line_value: 8, recorded_at: "2026-07-11T12:00:00Z" },
    ]],
  ]);
  const currentLinesByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: -120, line_value: 8, fetched_at: "2026-07-11T16:00:00Z" },
      { game_id: 14771, market_type: "total", side: "over", sportsbook: "pinnacle", odds_american: 100, line_value: 8, fetched_at: "2026-07-11T16:00:00Z" },
    ]],
  ]);
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -120,
      mlAwayOdds: 110,
      ouOverOdds: 100,
      ouUnderOdds: -120,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -120, line: null, observedAt: "2026-07-11T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 110, line: null, observedAt: "2026-07-11T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: 100, line: 8, observedAt: "2026-07-11T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -120, line: 8, observedAt: "2026-07-11T16:00:00Z" },
      },
    }],
  ]);
  const signalsByGameId = new Map([
    [14771, [
      { market_type: "total", side: "under", public_money_pct: 72, public_betting_pct: 45, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
    ]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, cleanConfirmedTotalPred]]),
    abbrevByTeamId,
    oddsByGameId,
    openersByGameId,
    currentLinesByGameId,
    signalsByGameId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  const promo = (ou.snapshot_json as any)?.total_clean_confirmed_best_angle_promotion;
  const ba = (ou.snapshot_json as any)?.best_angle_resolution;
  check("clean strong total promotes to Best Angle", ou.best_angle === true && ou.play_grade === "best_angle");
  check("clean strong total promotion audit is stamped", promo?.rule_id === "total_clean_strong_best_angle_v4_2026_07_11");
  check("clean strong total final BA resolution reflects promotion", ba?.clean_confirmed_promotion === true && ba?.final_best_angle === true);
  check("clean strong total decision pipeline is actionable", (ou.snapshot_json as any)?.decision_pipeline?.board_action === "bet");
}
{
  const conflictTotalPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 58,
    predicted_home_score: 3.6,
    predicted_away_score: 3.8,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "market_aligned",
      ou_best_angle_eligible: false,
      v2_2_audit: {
        ou_play_grade: "market_aligned",
        market_total: 8,
        posterior_total: 7.2,
        ou_model_prob: 0.58,
        ou_market_prob: 0.525,
        ou_edge_pct: 5.5,
      },
    },
  };
  const currentLinesByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: -120, line_value: 8, fetched_at: "2026-07-11T16:00:00Z" },
      { game_id: 14771, market_type: "total", side: "over", sportsbook: "pinnacle", odds_american: 100, line_value: 8, fetched_at: "2026-07-11T16:00:00Z" },
    ]],
  ]);
  const openersByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: 100, line_value: 8, recorded_at: "2026-07-11T12:00:00Z" },
    ]],
  ]);
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -120,
      mlAwayOdds: 110,
      ouOverOdds: 100,
      ouUnderOdds: -120,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -120, line: null, observedAt: "2026-07-11T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 110, line: null, observedAt: "2026-07-11T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: 100, line: 8, observedAt: "2026-07-11T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -120, line: 8, observedAt: "2026-07-11T16:00:00Z" },
      },
    }],
  ]);
  const signalsByGameId = new Map([
    [14771, [
      { market_type: "total", side: "over", public_money_pct: 80, public_betting_pct: 50, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
    ]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, conflictTotalPred]]),
    abbrevByTeamId,
    oddsByGameId,
    openersByGameId,
    currentLinesByGameId,
    signalsByGameId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  check("opposing public-money conflict blocks clean total promotion", ou.best_angle === false && ou.play_grade !== "best_angle");
}

console.log("\n━━━ MLB ML clean tight-edge Best Angle promotion ━━━");
{
  const cleanTightMlPred = {
    ...basePrediction,
    predicted_ml_winner: "home",
    ml_confidence: 56,
    predicted_home_score: 4.4,
    predicted_away_score: 4.0,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ml_play_grade: "market_aligned",
      ml_best_angle_eligible: false,
      v2_2_audit: {
        ml_play_grade: "market_aligned",
        ml_model_prob: 0.56,
        ml_market_prob: 0.553,
        ml_edge_pct: 0.7,
        posterior_home_diff: 0.4,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -145,
      mlAwayOdds: 125,
      ouOverOdds: 100,
      ouUnderOdds: -120,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -145, line: null, observedAt: "2026-07-11T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 125, line: null, observedAt: "2026-07-11T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: 100, line: 8, observedAt: "2026-07-11T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -120, line: 8, observedAt: "2026-07-11T16:00:00Z" },
      },
    }],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, cleanTightMlPred]]),
    abbrevByTeamId,
    oddsByGameId,
    signalsByGameId: new Map(),
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const promo = (ml.snapshot_json as any)?.ml_clean_tight_edge_best_angle_promotion;
  const secondPromo = (ml.snapshot_json as any)?.ml_tight_market_price_best_angle_promotion;
  const ba = (ml.snapshot_json as any)?.best_angle_resolution;
  check("clean tight-edge ML promotes to Best Angle", ml.best_angle === true && ml.play_grade === "best_angle");
  check("clean tight-edge ML promotion audit is stamped", promo?.rule_id === "ml_clean_tight_edge_best_angle_v1_2026_07_11");
  check("overlapping ML promotion cohorts stamp exactly one rule", secondPromo === null);
  check("clean tight-edge ML final BA resolution reflects promotion", ba?.clean_tight_edge_promotion === true && ba?.final_best_angle === true);
}

console.log("\n━━━ MLB tight market-price Best Angle integration ━━━");
{
  const tightMarketMlPred = {
    ...basePrediction,
    predicted_ml_winner: "home",
    ml_confidence: 59,
    predicted_home_score: 4.8,
    predicted_away_score: 4.2,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ml_play_grade: "market_aligned",
      ml_best_angle_eligible: false,
      v2_2_audit: {
        ml_play_grade: "market_aligned",
        ml_model_prob: 0.59,
        ml_market_prob: 0.585,
        ml_edge_pct: 0.5,
        posterior_home_diff: 0.6,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -145,
      mlAwayOdds: 125,
      ouOverOdds: -110,
      ouUnderOdds: -110,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -145, line: null, observedAt: "2026-07-20T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 125, line: null, observedAt: "2026-07-20T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-20T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-20T16:00:00Z" },
      },
    }],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-20",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, tightMarketMlPred]]),
    abbrevByTeamId,
    oddsByGameId,
    signalsByGameId: new Map(),
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const promo = (ml.snapshot_json as any)?.ml_tight_market_price_best_angle_promotion;
  check("tight market-price ML promotes to Best Angle", ml.best_angle === true && ml.play_grade === "best_angle");
  check("tight market-price promotion audit is stamped", promo?.rule_id === ML_TIGHT_MARKET_PRICE_BEST_ANGLE_RULE_ID);
}

console.log("\n━━━ MLB mid-price near-market Lean integration ━━━");
{
  const midPriceLeanPred = {
    ...basePrediction,
    predicted_ml_winner: "home",
    ml_confidence: 54,
    predicted_home_score: 4.8,
    predicted_away_score: 4.2,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ml_play_grade: "market_aligned",
      ml_best_angle_eligible: false,
      mlb_data_completeness: { status: "provisional_starters_pending" },
      v2_2_audit: {
        ml_play_grade: "market_aligned",
        ml_model_prob: 0.54,
        ml_market_prob: 0.532,
        ml_edge_pct: 0.8,
        posterior_home_diff: 0.6,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -125,
      mlAwayOdds: 105,
      ouOverOdds: -110,
      ouUnderOdds: -110,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -125, line: null, observedAt: "2026-07-25T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 105, line: null, observedAt: "2026-07-25T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-25T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-25T16:00:00Z" },
      },
    }],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-25",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, midPriceLeanPred]]),
    abbrevByTeamId,
    oddsByGameId,
    signalsByGameId: new Map(),
  });
  const ml = recs.find((record) => record.market === "moneyline")!;
  const promo = (ml.snapshot_json as any)?.ml_mid_price_near_market_lean_promotion;
  check("mid-price near-market ML promotes to Lean", ml.play_grade === "lean" && ml.best_angle === false);
  check("mid-price Lean promotion audit is stamped", promo?.rule_id === ML_MID_PRICE_NEAR_MARKET_LEAN_RULE_ID);
  check("mid-price Lean decision pipeline is actionable", (ml.snapshot_json as any)?.decision_pipeline?.action_rule_id === ML_MID_PRICE_NEAR_MARKET_LEAN_RULE_ID);
}

console.log("\n━━━ MLB market-divergence Lean integration ━━━");
{
  const marketDivergencePred = {
    ...basePrediction,
    predicted_ml_winner: "home",
    ml_confidence: 54,
    predicted_home_score: 4.3,
    predicted_away_score: 4.1,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ml_play_grade: "market_aligned",
      ml_best_angle_eligible: false,
      mlb_data_completeness: { status: "complete" },
      v2_2_audit: {
        ml_play_grade: "market_aligned",
        ml_model_prob: 0.54,
        ml_market_prob: 0.54,
        ml_edge_pct: 0,
        posterior_home_diff: 0.2,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: 110,
      mlAwayOdds: -130,
      ouOverOdds: -110,
      ouUnderOdds: -110,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: 110, line: null, observedAt: "2026-07-28T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: -130, line: null, observedAt: "2026-07-28T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-28T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-28T16:00:00Z" },
      },
    }],
  ]);
  const signalsByGameId = new Map([
    [14771, [
      { market_type: "moneyline", side: "home", public_money_pct: 50, public_betting_pct: 50, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
      { market_type: "moneyline", side: "away", public_money_pct: 50, public_betting_pct: 50, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
    ]],
  ]);
  const sharpMoneylineSupport = [
    { canonical_event_id: "5058728", market_type: "moneyline", selection_key: "5058728:moneyline:home", provider: "sharpapi", source_book: "sharp_adjacent", source_type: "sharp_adjacent_book", bets_pct: 47, money_pct: 57, source_observed_at: "2026-07-28T16:00:00Z", fetched_at: "2026-07-28T16:00:00Z" },
    { canonical_event_id: "5058728", market_type: "moneyline", selection_key: "5058728:moneyline:away", provider: "sharpapi", source_book: "sharp_adjacent", source_type: "sharp_adjacent_book", bets_pct: 53, money_pct: 43, source_observed_at: "2026-07-28T16:00:00Z", fetched_at: "2026-07-28T16:00:00Z" },
  ] as any;
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-28",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, marketDivergencePred]]),
    abbrevByTeamId,
    oddsByGameId,
    signalsByGameId,
    sourceAwareSplitsByGameId: new Map([[14771, sharpMoneylineSupport]]),
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const promo = (ml.snapshot_json as any)?.ml_market_divergence_lean_promotion;
  check("market-divergence path promotes a Watchlist to Lean", ml.play_grade === "lean" && ml.best_angle === false);
  check("market-divergence Lean audit is stamped", promo?.rule_id === ML_MARKET_DIVERGENCE_LEAN_RULE_ID);
  check("market-divergence Lean records its validated SharpAPI provider", promo?.split_provider === "sharpapi");
  check("market-divergence Lean becomes the decision action rule", (ml.snapshot_json as any)?.decision_pipeline?.action_rule_id === ML_MARKET_DIVERGENCE_LEAN_RULE_ID);

  const resistanceRecords = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-28",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, marketDivergencePred]]),
    abbrevByTeamId,
    oddsByGameId,
    signalsByGameId: new Map([
      [14771, [
        { market_type: "moneyline", side: "home", public_money_pct: 50, public_betting_pct: 50, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
        { market_type: "moneyline", side: "away", public_money_pct: 50, public_betting_pct: 50, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
      ]],
    ]),
    sourceAwareSplitsByGameId: new Map([[14771, sharpMoneylineSupport.map((split: any) =>
      split.selection_key.endsWith(":home")
        ? { ...split, bets_pct: 60, money_pct: 50 }
        : { ...split, bets_pct: 40, money_pct: 50 }
    )]]),
  });
  const resistedMl = resistanceRecords.find((record) => record.market === "moneyline")!;
  const resistanceAudit = (resistedMl.snapshot_json as any)?.ml_signed_market_resistance_standdown;
  check("signed market resistance stands down the unchanged original side", resistedMl.pick === "home" && resistedMl.no_bet === true);
  check("signed market resistance never enters a flip path", (resistedMl.snapshot_json as any)?.decision_pipeline?.final_side_changed === false);
  check("signed market resistance audit is stamped", resistanceAudit?.rule_id === ML_SIGNED_MARKET_RESISTANCE_RULE_ID);
  check("signed market resistance records its validated SharpAPI provider", resistanceAudit?.split_provider === "sharpapi");

  const playbookOnlyResistance = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-28",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, marketDivergencePred]]),
    abbrevByTeamId,
    oddsByGameId,
    signalsByGameId,
    sourceAwareSplitsByGameId: new Map([[14771, sharpMoneylineSupport.map((split: any) => ({
      ...split,
      provider: "playbook",
      source_type: "multi_book_consensus",
    }))]]),
  });
  const playbookOnlyMl = playbookOnlyResistance.find((record) => record.market === "moneyline")!;
  check(
    "Playbook-only splits cannot activate SharpAPI-validated Moneyline promotion or stand-down",
    playbookOnlyMl.play_grade !== "lean" && playbookOnlyMl.no_bet !== true,
  );
}

console.log("\n━━━ MLB mid-price established-price Best Angle integration ━━━");
{
  const midPriceBestAnglePred = {
    ...basePrediction,
    predicted_ml_winner: "home",
    ml_confidence: 56,
    predicted_home_score: 4.8,
    predicted_away_score: 4.2,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ml_play_grade: "market_aligned",
      ml_best_angle_eligible: false,
      mlb_data_completeness: { status: "provisional_starters_pending" },
      v2_2_audit: {
        ml_play_grade: "market_aligned",
        ml_model_prob: 0.56,
        ml_market_prob: 0.544,
        ml_edge_pct: 1.6,
        posterior_home_diff: 1.0,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -134,
      mlAwayOdds: 114,
      ouOverOdds: -110,
      ouUnderOdds: -110,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -134, line: null, observedAt: "2026-07-25T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 114, line: null, observedAt: "2026-07-25T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-25T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-25T16:00:00Z" },
      },
    }],
  ]);
  const ml = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-25",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, midPriceBestAnglePred]]),
    abbrevByTeamId,
    oddsByGameId,
    signalsByGameId: new Map(),
  }).find((record) => record.market === "moneyline")!;
  const promo =
    (ml.snapshot_json as any)?.ml_mid_price_established_price_best_angle_promotion;
  check(
    "mid-price established-price ML promotes to Best Angle",
    ml.play_grade === "best_angle" && ml.best_angle === true,
  );
  check(
    "mid-price Best Angle promotion audit is stamped",
    promo?.rule_id === ML_MID_PRICE_ESTABLISHED_PRICE_BEST_ANGLE_RULE_ID,
  );
  check(
    "mid-price Best Angle decision pipeline is actionable",
    (ml.snapshot_json as any)?.decision_pipeline?.action_rule_id ===
      ML_MID_PRICE_ESTABLISHED_PRICE_BEST_ANGLE_RULE_ID,
  );
}

console.log("\n━━━ MLB generic Lean positive-EV coherence ━━━");
{
  const genericLeanPred = {
    ...basePrediction,
    predicted_ml_winner: "home",
    ml_confidence: 55.8,
    predicted_home_score: 5.0,
    predicted_away_score: 4.0,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ml_play_grade: "lean",
      ml_best_angle_eligible: false,
      v2_2_audit: {
        ml_play_grade: "lean",
        ml_model_prob: 0.557562,
        ml_market_prob: 0.540368,
        ml_edge_pct: 1.7,
        posterior_home_diff: 1.0,
      },
    },
  };
  const buildAtPrice = (mlHomeOdds: number) => {
    const oddsByGameId = new Map([
      [14771, {
        mlHomeOdds,
        mlAwayOdds: 110,
        ouOverOdds: -110,
        ouUnderOdds: -110,
        oddsSourceMl: {
          home: { source: "lines" as const, book: "pinnacle", odds: mlHomeOdds, line: null, observedAt: "2026-07-25T16:00:00Z" },
          away: { source: "lines" as const, book: "pinnacle", odds: 110, line: null, observedAt: "2026-07-25T16:00:00Z" },
        },
        oddsSourceOu: {
          over: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-25T16:00:00Z" },
          under: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-25T16:00:00Z" },
        },
      }],
    ]);
    return buildPredictionRecordsFromSlate({
      sport: "mlb",
      slateDate: "2026-07-25",
      launchDay: false,
      games: [baseGame],
      predictionByGameId: new Map([[14771, genericLeanPred]]),
      abbrevByTeamId,
      oddsByGameId,
      signalsByGameId: new Map(),
    }).find((record) => record.market === "moneyline")!;
  };

  const negativeEv = buildAtPrice(-160);
  check(
    "negative-EV generic ML Lean is removed from the actionable board",
    negativeEv.play_grade !== "lean" &&
      (negativeEv.snapshot_json as any)?.decision_pipeline?.board_action === "no_play",
  );
  check(
    "demoted generic ML Lean has no action rule stamp",
    (negativeEv.snapshot_json as any)?.decision_pipeline?.action_rule_id === null,
  );

  const positiveEv = buildAtPrice(-115);
  check(
    "positive-EV generic ML Lean remains actionable",
    positiveEv.play_grade === "lean" &&
      (positiveEv.snapshot_json as any)?.decision_pipeline?.board_action === "bet",
  );
  check(
    "positive-EV calibrated-model ML Lean receives its immutable path stamp",
    (positiveEv.snapshot_json as any)?.decision_pipeline?.action_rule_id ===
      ML_CALIBRATED_MODEL_LEAN_PATH_ID,
  );
}

console.log("\n━━━ MLB market-aware final side correction ━━━");
{
  const distanceCapMlPred = {
    ...basePrediction,
    predicted_ml_winner: "home",
    ml_confidence: 56,
    predicted_home_score: 4.0,
    predicted_away_score: 4.6,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ml_play_grade: "lean",
      ml_best_angle_eligible: true,
      v2_2_audit: {
        ml_play_grade: "lean",
        ml_model_prob: 0.56,
        ml_market_prob: 0.54,
        ml_edge_pct: 2.0,
        posterior_home_diff: -0.6,
        ml_distance_cap_applied: true,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -145,
      mlAwayOdds: 125,
      ouOverOdds: -110,
      ouUnderOdds: -110,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -145, line: null, observedAt: "2026-07-11T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 125, line: null, observedAt: "2026-07-11T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-11T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-11T16:00:00Z" },
      },
    }],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, distanceCapMlPred]]),
    abbrevByTeamId,
    oddsByGameId,
    signalsByGameId: new Map(),
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const correction = (ml.snapshot_json as any)?.market_aware_side_correction;
  check("ML market-aware correction flips to priced opposite side", ml.pick === "away" && ml.odds_american === 125 && ml.confidence === 56);
  check("ML market-aware correction is capped below Best Angle", ml.best_angle === false && ml.play_grade === "market_aligned" && ml.no_bet === false);
  check(
    "ML market-aware correction audit is stamped",
    correction?.rule_id === MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID &&
      correction?.market === "moneyline" &&
      correction?.reasons?.includes("regularization_distance_cap_applied"),
  );
}
{
  const projectionConflictCorrectedMlPred = {
    ...basePrediction,
    predicted_ml_winner: "home",
    ml_confidence: 56,
    predicted_home_score: 4.7,
    predicted_away_score: 4.1,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ml_play_grade: "lean",
      ml_best_angle_eligible: true,
      v2_2_audit: {
        ml_play_grade: "lean",
        ml_model_prob: 0.56,
        ml_market_prob: 0.54,
        ml_edge_pct: 2.0,
        posterior_home_diff: 0.6,
        ml_distance_cap_applied: true,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -105,
      mlAwayOdds: -115,
      ouOverOdds: -110,
      ouUnderOdds: -110,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -105, line: null, observedAt: "2026-07-11T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: -115, line: null, observedAt: "2026-07-11T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-11T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-07-11T16:00:00Z" },
      },
    }],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, projectionConflictCorrectedMlPred]]),
    abbrevByTeamId,
    oddsByGameId,
    signalsByGameId: new Map(),
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const championCorrection = (ml.snapshot_json as any)?.champion_candidate_correction;
  check("ML market-aware correction clears stale projection-conflict no-bet but remains below Best Angle", ml.pick === "away" && ml.best_angle === false && ml.play_grade === "market_aligned" && ml.no_bet === false);
  check("ML market-aware correction does not keep original-side champion stand-down", championCorrection === null);
}
{
  const splitSignalTotalPred = {
    ...basePrediction,
    predicted_ou_side: "over",
    ou_confidence: 56,
    predicted_home_score: 4.6,
    predicted_away_score: 4.5,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "lean",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        ou_play_grade: "lean",
        market_total: 8.5,
        posterior_total: 9.1,
        ou_model_prob: 0.56,
        ou_market_prob: 0.50,
        ou_edge_pct: 6.0,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -120,
      mlAwayOdds: 110,
      ouOverOdds: -112,
      ouUnderOdds: 105,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -120, line: null, observedAt: "2026-07-11T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 110, line: null, observedAt: "2026-07-11T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -112, line: 8.5, observedAt: "2026-07-11T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: 105, line: 8.5, observedAt: "2026-07-11T16:00:00Z" },
      },
    }],
  ]);
  const currentLinesByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "over", sportsbook: "pinnacle", odds_american: -112, line_value: 8.5, fetched_at: "2026-07-11T16:00:00Z" },
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: 105, line_value: 8.5, fetched_at: "2026-07-11T16:00:00Z" },
    ]],
  ]);
  const signalsByGameId = new Map([
    [14771, [
      { market_type: "total", side: "over", public_money_pct: 72, public_betting_pct: 45, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
    ]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, splitSignalTotalPred]]),
    abbrevByTeamId,
    oddsByGameId,
    currentLinesByGameId,
    signalsByGameId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  const correction = (ou.snapshot_json as any)?.market_aware_side_correction;
  const flip = (ou.snapshot_json as any)?.ou_flip;
  const rejection = (ou.snapshot_json as any)?.totals_correction_rejection;
  const validatedLeanStanddown = (ou.snapshot_json as any)?.total_validated_lean_forward_standdown;
  check("Supporting total split leaves original side official", ou.pick === "over" && ou.odds_american === -112);
  check("Supporting total split preserves original edge", typeof ou.edge === "number" && ou.edge === 6);
  check("Forward-failed generic Total Lean is capped", ou.best_angle === false && ou.play_grade !== "lean");
  check(
    "Supporting total split does not create a rejected opposite-side correction",
    correction == null &&
      flip == null &&
      rejection == null &&
      validatedLeanStanddown?.superseded_rule_id === "total_validated_lean_v1_2026_07_11",
  );
}
{
  const marketOpposedFlipPred = {
    ...basePrediction,
    predicted_ou_side: "over",
    ou_confidence: 51.6,
    predicted_home_score: 5.2,
    predicted_away_score: 4.4,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "market_aligned",
      ou_best_angle_eligible: false,
      v2_2_audit: {
        ou_play_grade: "market_aligned",
        market_total: 9,
        posterior_total: 10.13,
        ou_model_prob: 0.5156,
        ou_market_prob: 0.4872,
        ou_edge_pct: 2.8,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -120,
      mlAwayOdds: 110,
      ouOverOdds: -105,
      ouUnderOdds: -117,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -120, line: null, observedAt: "2026-07-11T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 110, line: null, observedAt: "2026-07-11T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -105, line: 9, observedAt: "2026-07-11T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -117, line: 9, observedAt: "2026-07-11T16:00:00Z" },
      },
    }],
  ]);
  const currentLinesByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "over", sportsbook: "pinnacle", odds_american: -105, line_value: 9, fetched_at: "2026-07-11T16:00:00Z" },
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: -117, line_value: 9, fetched_at: "2026-07-11T16:00:00Z" },
    ]],
  ]);
  const signalsByGameId = new Map([
    [14771, [
      { market_type: "total", side: "under", public_money_pct: 70, public_betting_pct: 52, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
    ]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, marketOpposedFlipPred]]),
    abbrevByTeamId,
    oddsByGameId,
    currentLinesByGameId,
    signalsByGameId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  const flip = (ou.snapshot_json as any)?.ou_flip;
  const rejection = (ou.snapshot_json as any)?.totals_correction_rejection;
  const gradeResolution = (ou.snapshot_json as any)?.total_flip_public_grade_resolution;
  check("Market-opposed weak total leaves original side official", ou.pick === "over" && ou.odds_american === -105);
  check("Market-opposed weak total remains non-actionable on its original side", ou.play_grade === "market_aligned" && ou.best_angle === false && ou.no_bet === false);
  check(
    "Market-opposed total rejection audit preserves the rejected candidate without grading it",
    flip == null &&
      rejection?.rule_id === TOTALS_MARKET_OPPOSED_FLIP_RULE_ID &&
      rejection?.action === "reject_candidate_evaluate_original" &&
      rejection?.restoration_rule_id === TOTAL_REJECTED_CORRECTION_ORIGINAL_SIDE_RULE_ID &&
      rejection?.rejected_candidate_side === "under" &&
      gradeResolution?.action === "reject_candidate_evaluate_original" &&
      gradeResolution?.public_play_grade === "market_aligned",
  );
}
{
  const strongOriginalTotalPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 58.8,
    predicted_home_score: 3.4,
    predicted_away_score: 3.46,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "lean",
      ou_best_angle_eligible: false,
      v2_2_audit: {
        ou_play_grade: "lean",
        market_total: 8.5,
        posterior_total: 6.86,
        ou_model_prob: 0.588,
        ou_market_prob: 0.508,
        ou_edge_pct: 8.0,
      },
    },
  };
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -120,
      mlAwayOdds: 110,
      ouOverOdds: -103,
      ouUnderOdds: -110,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -120, line: null, observedAt: "2026-08-11T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 110, line: null, observedAt: "2026-08-11T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -103, line: 8.5, observedAt: "2026-08-11T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -110, line: 8.5, observedAt: "2026-08-11T16:00:00Z" },
      },
    }],
  ]);
  const currentLinesByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "over", sportsbook: "pinnacle", odds_american: -103, line_value: 8.5, fetched_at: "2026-08-11T16:00:00Z" },
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: -110, line_value: 8.5, fetched_at: "2026-08-11T16:00:00Z" },
    ]],
  ]);
  const signalsByGameId = new Map([
    [14771, [
      { market_type: "total", side: "over", public_money_pct: 83, public_betting_pct: 57, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
    ]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-08-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, strongOriginalTotalPred]]),
    abbrevByTeamId,
    oddsByGameId,
    currentLinesByGameId,
    signalsByGameId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  const rejection = (ou.snapshot_json as any)?.totals_correction_rejection;
  const decision = (ou.snapshot_json as any)?.decision_pipeline;
  check("Rejected total correction restores a strong original side as Lean", ou.pick === "under" && ou.play_grade === "lean" && ou.best_angle === false && ou.no_bet === false);
  check("Rejected opposite total side remains hidden", rejection?.rejected_candidate_side === "over" && ou.pick !== rejection?.rejected_candidate_side);
  check("Restored original total uses the calibrated-model Lean path", decision?.board_action === "bet" && decision?.action_rule_id === TOTAL_CALIBRATED_MODEL_LEAN_PATH_ID && decision?.original_side_restoration_rule_id === TOTAL_REJECTED_CORRECTION_ORIGINAL_SIDE_RULE_ID);
}

// ── launch_day flag ─────────────────────────────────────────────────
console.log("\n━━━ launch_day flag propagation ━━━");
{
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: true,
    games: [baseGame],
    predictionByGameId,
    abbrevByTeamId,
  });
  check("launch_day=true on all records", recs.every((r) => r.launch_day === true));
  check("manual_outcome_expected=true when launch_day", recs.every((r) => r.manual_outcome_expected === true));
}

// ── Fully held game → 0 records ───────────────────────────────────
console.log("\n━━━ Fully held game (ml+ou+nrfi all in hold_picks) → 0 records ━━━");
{
  const fullyHeldPred = {
    ...basePrediction,
    predicted_ml_winner: null,
    predicted_ou_side: null,
    sport_specific: { ...v21SportSpecific, hold_picks: ["ml", "ou", "nrfi"] },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fullyHeldPred]]),
    abbrevByTeamId,
  });
  check("returns 0 records when all markets held", recs.length === 0);
}

// ── NRFI populated → 3 records (full slate) ─────────────────────
console.log("\n━━━ NRFI populated → 3 records ━━━");
{
  const fullPred = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 55,
    sport_specific: { ...v21SportSpecific, hold_picks: [] },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fullPred]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  check("returns 3 records", recs.length === 3);
  const fi = recs.find((r) => r.market === "first_inning");
  check("FI record exists", fi !== undefined);
  check("FI pick='NRFI'", fi?.pick === "NRFI");
  check("FI side='under'", fi?.side === "under");
  check("FI line_value=0.5", fi?.line_value === 0.5);
}
{
  const fullPred = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 55,
    sport_specific: { ...v21SportSpecific, hold_picks: [] },
  };
  const mixedFiLines = new Map([[14771, [
    { game_id: 14771, market_type: "first_inning_total", side: "under", sportsbook: "ballybet", odds_american: -275, line_value: 1.5, fetched_at: "2026-06-06T16:11:00Z" },
    { game_id: 14771, market_type: "first_inning_total", side: "over", sportsbook: "ballybet", odds_american: 200, line_value: 1.5, fetched_at: "2026-06-06T16:11:00Z" },
    ...freshFiLines,
  ]]]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fullPred]]),
    abbrevByTeamId,
    currentLinesByGameId: mixedFiLines,
  });
  const fi = recs.find((r) => r.market === "first_inning");
  check("FI writer rejects 1.5-run price contamination", fi?.odds_american === -120);
  check("FI writer preserves the exact half-run market", fi?.line_value === 0.5);
}
{
  const fullPred = {
    ...basePrediction,
    predicted_nrfi: false,
    nrfi_confidence: 61,
    sport_specific: { ...v21SportSpecific, hold_picks: [], nrfi_decision_kind: "yrfi" },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fullPred]]),
    abbrevByTeamId,
    currentLinesByGameId: new Map([[14771, []]]),
    historyByKey: new Map([
      ["14771::first_inning_total::over", [
        { game_id: 14771, market_type: "first_inning_total", side: "over", sportsbook: "ballybet", odds_american: -148, line_value: 0.5, recorded_at: "2026-06-06T16:10:00Z" },
      ]],
      ["14771::first_inning_total::under", [
        { game_id: 14771, market_type: "first_inning_total", side: "under", sportsbook: "ballybet", odds_american: 112, line_value: 0.5, recorded_at: "2026-06-06T16:10:00Z" },
      ]],
    ]),
  });
  const fi = recs.find((r) => r.market === "first_inning");
  check("FI does not use line_history fallback for actionable tracking", fi === undefined);
}

// ── Phase 6B.20 — Toss-Up FI rows captured as non-actionable ─────
console.log("\n━━━ Phase 6B.20 — Toss-Up FI rows ━━━");
{
  // nrfi_decision_kind=toss_up should produce pick="Toss-Up", no_bet=true
  const tossUpPred = {
    ...basePrediction,
    predicted_nrfi: true, // internal lean (preserved in snapshot_json)
    nrfi_confidence: 52,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "toss_up",
      auto_factors: { nrfi_expected_runs: 1.0 },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, tossUpPred]]),
    abbrevByTeamId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  check("Toss-Up FI: pick='Toss-Up'", fi.pick === "Toss-Up");
  check("Toss-Up FI: side=null", fi.side === null);
  check("Toss-Up FI: no_bet=true", fi.no_bet === true);
  check("Toss-Up FI: prediction_type='toss_up'", fi.prediction_type === "toss_up");
  check("Toss-Up FI: no_bet_reason explains non-actionable", typeof fi.no_bet_reason === "string" && /non-actionable/i.test(fi.no_bet_reason!));
  check("Toss-Up FI: snapshot_json preserves internal lean for calibration", (fi.snapshot_json as any)?.nrfi_decision_kind === "toss_up");
}
{
  const sparseNamedStarterTossUp = {
    ...basePrediction,
    predicted_nrfi: false,
    nrfi_confidence: 50,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "toss_up",
      fi_v2_audit: {
        fi_pick: "Toss-Up",
        fi_pick_reason: "fi_toss_up_sparse_named_starter_history",
        fi_play_grade: "toss_up",
        fi_no_bet_reason: "Toss-Up — named probable starters are available, but verified starter history is too sparse for a directional play.",
        fresh_data_ready: false,
        fresh_data_blockers: [
          "away_batting_opposing_starter_fi_missing",
          "home_batting_opposing_starter_fi_missing",
        ],
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, sparseNamedStarterTossUp]]),
    abbrevByTeamId,
  });
  const fi = recs.find((r) => r.market === "first_inning");
  check("sparse named-starter Toss-Up writes a tracking row", fi?.pick === "Toss-Up");
  check("sparse named-starter tracking row remains non-actionable", fi?.no_bet === true && fi?.play_grade === "toss_up");
  check("sparse named-starter tracking row preserves audit blockers", (fi?.snapshot_json as any)?.fi_v2_audit?.fresh_data_ready === false);
}
{
  const unpublishedProbableTossUp = {
    ...basePrediction,
    predicted_nrfi: false,
    nrfi_confidence: 50,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "toss_up",
      fi_v2_audit: {
        fi_pick: "Toss-Up",
        fi_pick_reason: "fi_toss_up_market_backed_probable_unpublished",
        fi_play_grade: "toss_up",
        fi_no_bet_reason: "Toss-Up — model probability in the neutral band.",
        fresh_data_ready: false,
        fresh_data_blockers: ["away_batting_opposing_starter_fi_missing"],
        market_data_quality: "ok",
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, unpublishedProbableTossUp]]),
    abbrevByTeamId,
  });
  const fi = recs.find((r) => r.market === "first_inning");
  check("unpublished-probable market-backed Toss-Up writes a tracking row", fi?.pick === "Toss-Up");
  check("unpublished-probable tracking row remains non-actionable", fi?.no_bet === true && fi?.play_grade === "toss_up");
  check("unpublished-probable tracking row is stamped with current release", (fi?.snapshot_json as any)?.model_layer_versions?.decision_release_id === MLB_DAILY_EDGE_DECISION_RELEASE_ID);
}
{
  // Actionable NRFI: nrfi_decision_kind='nrfi' → unchanged path
  const actionablePred = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 56,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, actionablePred]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  check("Actionable NRFI: pick='NRFI'", fi.pick === "NRFI");
  check("Actionable NRFI: side='under'", fi.side === "under");
  check("Actionable NRFI: no_bet=false", fi.no_bet === false);
  check("Actionable NRFI: prediction_type=null", fi.prediction_type === null);
}
{
  // Heuristic fallback: pre-4D.1 row without nrfi_decision_kind but
  // nrfi_confidence=52 + nrfi_expected_runs in [0.85, 1.15) → Toss-Up
  const heuristicPred = {
    ...basePrediction,
    predicted_nrfi: false,
    nrfi_confidence: 52,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      // no nrfi_decision_kind
      auto_factors: { nrfi_expected_runs: 0.95 },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, heuristicPred]]),
    abbrevByTeamId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  check("Heuristic Toss-Up: pick='Toss-Up' via conf=52 + runs band", fi.pick === "Toss-Up");
  check("Heuristic Toss-Up: no_bet=true", fi.no_bet === true);
}

// ── Unique key (game_id, market, model_version, slate_date) ─────
console.log("\n━━━ Idempotency key uniqueness ━━━");
{
  // The records produced for the same inputs share no duplicate keys.
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId,
    abbrevByTeamId,
  });
  const keys = recs.map((r) => `${r.game_id}::${r.market}::${r.model_version}::${r.slate_date}`);
  const uniqueKeys = new Set(keys);
  check("each record has a unique idempotency key", uniqueKeys.size === keys.length);
}

// ── Phase 6B.12 — public-money guard at record-build layer ────────
console.log("\n━━━ Phase 6B.12 — public-money guard on best_angle ━━━");
{
  // BAL@TOR moneyline scenario from 2026-06-07: V2.2 says ml BA eligible,
  // model picked home. Opposite side (away) has 78% money / 27% bets =
  // 51pp divergence. Guard should SUPPRESS best_angle.
  const baTorPred = {
    ...basePrediction,
    sport_specific: { ...v21SportSpecific, hold_picks: [], ml_best_angle_eligible: true, ou_best_angle_eligible: false },
  };
  const signalsConflict = new Map([
    [14771, [{ market_type: "moneyline", side: "away", public_money_pct: 78, public_betting_pct: 27, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null }]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-07",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, baTorPred]]),
    abbrevByTeamId,
    signalsByGameId: signalsConflict,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  check("ML best_angle SUPPRESSED when opposing money ≥60 + divergence ≥15", ml.best_angle === false);
  check("ML public split conflict stands down from actionable board",
        ml.no_bet === true &&
        typeof ml.no_bet_reason === "string" &&
        /champion_candidate_ml_stand_down/.test(ml.no_bet_reason));
  check("ML champion correction audit captures public split conflict",
        (ml.snapshot_json as any)?.champion_candidate_correction?.public_split_conflict === true);
}
{
  // BAL@TOR moneyline with no signals → public-money guard goes neutral and
  // the calibrated model remains the primary Best Angle path.
  const baTorPred = {
    ...basePrediction,
    sport_specific: { ...v21SportSpecific, hold_picks: [], ml_best_angle_eligible: true, ou_best_angle_eligible: false },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-07",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, baTorPred]]),
    abbrevByTeamId,
    // no signalsByGameId — guard must default to V2.2 raw eligibility
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  check(
    "ML calibrated-model Best Angle remains primary when signals map is absent",
    ml.best_angle === true &&
      (ml.snapshot_json as any)?.best_angle_resolution?.calibrated_model_path_retained === true,
  );
}
{
  // Phase 6B.12 — explicit null public_money_pct must be treated as
  // NEUTRAL (no suppression). This is the regression that re-Best-Angled
  // NYY ML / TOR ML this morning.
  const baTorPred = {
    ...basePrediction,
    sport_specific: { ...v21SportSpecific, hold_picks: [], ml_best_angle_eligible: true, ou_best_angle_eligible: false },
  };
  const signalsNullMoney = new Map([
    [14771, [{ market_type: "moneyline", side: "away", public_money_pct: null, public_betting_pct: 33, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null }]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-07",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, baTorPred]]),
    abbrevByTeamId,
    signalsByGameId: signalsNullMoney,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  check(
    "ML calibrated-model Best Angle remains when opposing public money is unknown",
    ml.best_angle === true &&
      (ml.snapshot_json as any)?.best_angle_resolution?.calibrated_model_path_retained === true,
  );
}
{
  // Below-threshold opposing money (e.g. 57/33) → guard does NOT fire.
  const baTorPred = {
    ...basePrediction,
    sport_specific: { ...v21SportSpecific, hold_picks: [], ml_best_angle_eligible: true, ou_best_angle_eligible: false },
  };
  const signalsBelowThreshold = new Map([
    [14771, [{ market_type: "moneyline", side: "away", public_money_pct: 57, public_betting_pct: 33, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null }]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-07",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, baTorPred]]),
    abbrevByTeamId,
    signalsByGameId: signalsBelowThreshold,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  check(
    "ML calibrated-model Best Angle remains below the validated opposing-money threshold",
    ml.best_angle === true &&
      (ml.snapshot_json as any)?.best_angle_resolution?.calibrated_model_path_retained === true,
  );
}
{
  // OU side: pick=over, opposite=under has 88% money / 50% bets = 38pp →
  // suppress (KC@MIN OU scenario from today's surgical resync).
  const kcMinPred = {
    ...basePrediction,
    predicted_ou_side: "over",
    ou_confidence: 65,
    sport_specific: { ...v21SportSpecific, hold_picks: [], ml_best_angle_eligible: false, ou_best_angle_eligible: true },
  };
  const signalsOuConflict = new Map([
    [14771, [{ market_type: "total", side: "under", public_money_pct: 88, public_betting_pct: 50, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null }]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-07",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, kcMinPred]]),
    abbrevByTeamId,
    signalsByGameId: signalsOuConflict,
  });
  const ou = recs.find((r) => r.market === "total")!;
  check("OU best_angle SUPPRESSED when opposite under has 88% money", ou.best_angle === false);
}

// ── 2026-06-22 — Totals integrity stand-down on mean/probability divergence ──
console.log("\n━━━ Totals divergence stand-down (integrity patch) ━━━");
{
  // Projected mean lands on the opposite side of the line from the
  // probability-driven pick → reconcileTotalProjection flags
  // mean_probability_divergence=true. The OU record must stand down:
  // no_bet=true (resolver → "No Play"), best_angle=false, clear reason —
  // but the row STILL WRITES (tracking-completeness; not held).
  const divergentPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 56,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "lean",
      ou_best_angle_eligible: true,
      total_projection_reconciliation: { mean_probability_divergence: true, grade_cap: "watchlist" },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-22",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, divergentPred]]),
    abbrevByTeamId,
    signalsByGameId: new Map(),
  });
  const ou = recs.find((r) => r.market === "total");
  check("Divergent total: row STILL WRITES (not dropped)", ou !== undefined);
  check("Divergent total: no_bet=true (→ No Play)", ou?.no_bet === true);
  check("Divergent total: best_angle=false", ou?.best_angle === false);
  check(
    "Divergent total: no_bet_reason explains divergence",
    typeof ou?.no_bet_reason === "string" && /opposite side|divergence/i.test(ou!.no_bet_reason!),
  );
}
{
  // Negative control: no divergence → unchanged (no_bet stays false).
  const coherentPred = {
    ...basePrediction,
    predicted_ou_side: "over",
    ou_confidence: 56,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "lean",
      total_projection_reconciliation: { mean_probability_divergence: false, grade_cap: null },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-22",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, coherentPred]]),
    abbrevByTeamId,
    signalsByGameId: new Map(),
  });
  const ou = recs.find((r) => r.market === "total");
  check("Coherent total: no_bet=false (unchanged)", ou?.no_bet === false);
}
{
  // Champion/current-control: calibrated probability heads no longer suppress
  // the mean-side reconciliation. If the selected side conflicts with the model
  // total and no valid mean-side price is available, the total stands down
  // instead of quietly tracking an incoherent pick.
  const calibratedHeadPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 56,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "lean",
      total_projection_reconciliation: {
        mean_probability_divergence: true,
        reconciled_total_side: "under",
        grade_cap: "watchlist",
      },
      mlb_core_model_calibration: {
        recommendation_uses_calibrated_projection: true,
        calibrated_probability_head: {
          selected_side: "under",
          regularized_probability_over: 0.49,
        },
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, calibratedHeadPred]]),
    abbrevByTeamId,
    signalsByGameId: new Map(),
  });
  const ou = recs.find((r) => r.market === "total");
  const ouFlip = ou?.snapshot_json?.ou_flip as { action?: string; flipped?: boolean } | null | undefined;
  check("Calibrated total head: row still writes", ou !== undefined);
  check("Calibrated total head: stored pick remains model side", ou?.pick === "under" && ou?.side === "under");
  check("Calibrated total head: divergent/no mean-price stands down", ou?.no_bet === true);
  check("Calibrated total head: no suppressed-legacy audit remains", ouFlip == null);
}
{
  const projectionOpposedPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 57,
    predicted_home_score: 4.1,
    predicted_away_score: 4.1,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "best_angle",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        ou_play_grade: "best_angle",
        market_total: 8,
        ou_model_prob: 0.57,
        ou_market_prob: 0.5,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, projectionOpposedPred]]),
    abbrevByTeamId,
  });
  const ou = recs.find((r) => r.market === "total");
  const cap = (ou?.snapshot_json as any)?.total_lean_projection_gap_cap;
  check("Total Lean projection-opposed total stands down", ou?.play_grade === null && ou?.no_bet === true);
  check("Total Lean projection-opposed early stand-down does not need a duplicate cap audit", cap === null);
}
{
  const clearGapPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 57,
    predicted_home_score: 3.1,
    predicted_away_score: 3.2,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "best_angle",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        ou_play_grade: "best_angle",
        market_total: 8,
        ou_model_prob: 0.57,
        ou_market_prob: 0.5,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, clearGapPred]]),
    abbrevByTeamId,
  });
  const ou = recs.find((r) => r.market === "total");
  check("Total Lean clear projection gap without price is capped by actionability recalibration", ou?.play_grade === "market_aligned");
  check("Total Lean clear projection gap has no cap audit", (ou?.snapshot_json as any)?.total_lean_projection_gap_cap === null);
  check("Total Lean clear projection gap without price records recalibration cap", (ou?.snapshot_json as any)?.total_lean_recalibration_cap?.action === "cap_to_watchlist");
}
{
  const validatedLeanPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 57,
    predicted_home_score: 3.4,
    predicted_away_score: 3.9,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "best_angle",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        ou_play_grade: "best_angle",
        market_total: 8,
        posterior_total: 7.3,
        ou_model_prob: 0.57,
        ou_market_prob: 0.49,
        ou_edge_pct: 8,
      },
    },
  };
  const currentLinesByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: -105, line_value: 8, fetched_at: "2026-07-10T16:00:00Z" },
      { game_id: 14771, market_type: "total", side: "over", sportsbook: "pinnacle", odds_american: -105, line_value: 8, fetched_at: "2026-07-10T16:00:00Z" },
    ]],
  ]);
  const oddsByGameId = new Map([
    [14771, {
      mlHomeOdds: -120,
      mlAwayOdds: 110,
      ouOverOdds: -105,
      ouUnderOdds: -105,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -120, line: null, observedAt: "2026-07-10T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 110, line: null, observedAt: "2026-07-10T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -105, line: 8, observedAt: "2026-07-10T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -105, line: 8, observedAt: "2026-07-10T16:00:00Z" },
      },
    }],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, validatedLeanPred]]),
    abbrevByTeamId,
    oddsByGameId,
    currentLinesByGameId,
  });
  const ou = recs.find((r) => r.market === "total");
  const standdown = (ou?.snapshot_json as any)?.total_validated_lean_forward_standdown;
  check("Forward-failed Total Lean profile stands down", ou?.play_grade !== "lean" && ou?.best_angle === false);
  check("Total Lean standdown records the superseded rule", standdown?.superseded_rule_id === TOTAL_VALIDATED_LEAN_RULE_ID && standdown?.action === "stand_down_from_lean");
  check("superseded Total Lean decision pipeline is nonactionable", (ou?.snapshot_json as any)?.decision_pipeline?.board_action === "no_play");
}
{
  const frictionPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 54,
    predicted_home_score: 3.1,
    predicted_away_score: 3.2,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "best_angle",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        ou_play_grade: "best_angle",
        market_total: 8,
        posterior_total: 6.3,
        ou_model_prob: 0.56,
        ou_market_prob: 0.52,
        ou_edge_pct: 4,
      },
    },
  };
  const openersByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: -120, line_value: 8, recorded_at: "2026-07-10T12:00:00Z" },
    ]],
  ]);
  const currentLinesByGameId = new Map([
    [14771, [
      { game_id: 14771, market_type: "total", side: "under", sportsbook: "pinnacle", odds_american: -105, line_value: 8, fetched_at: "2026-07-10T16:00:00Z" },
    ]],
  ]);
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, frictionPred]]),
    abbrevByTeamId,
    openersByGameId,
    currentLinesByGameId,
  });
  const ou = recs.find((r) => r.market === "total");
  const cap = (ou?.snapshot_json as any)?.total_lean_market_friction_cap;
  check("Total Lean thin edge + market friction caps to Watchlist grade", ou?.play_grade === "market_aligned");
  check(
    "Total Lean market friction cap records audit",
    cap?.rule_id === "total_lean_edge_lt_5_market_friction_cap" &&
      cap?.edge_pct < GATE_TOTAL_LEAN_MARKET_FRICTION_MAX_EDGE_PCT &&
      cap?.line_direction === "against_pick",
    JSON.stringify({
      cap,
      gapCap: (ou?.snapshot_json as any)?.total_lean_projection_gap_cap,
      lineMovement: (ou?.snapshot_json as any)?.line_movement,
      playGrade: ou?.play_grade,
      edge: ou?.edge,
      modelProbability: ou?.model_probability,
    }),
  );
}

{
  const resistancePred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 57,
    predicted_home_score: 3.6,
    predicted_away_score: 3.6,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      ou_play_grade: "market_aligned",
      ou_best_angle_eligible: false,
      v2_2_audit: {
        ou_play_grade: "market_aligned",
        market_total: 8,
        posterior_total: 7.2,
        ou_model_prob: 0.57,
        ou_market_prob: 0.54,
        ou_edge_pct: 3,
      },
    },
  };
  const resistanceSignals = [
    { market_type: "total", side: "under", public_money_pct: 20, public_betting_pct: 30, has_steam_move: false, has_reverse_line_movement: false, rlm_direction: null, signal_strength: null, computed_at: "2026-07-10T16:00:00Z", pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
    { market_type: "total", side: "over", public_money_pct: 80, public_betting_pct: 70, has_steam_move: false, has_reverse_line_movement: false, rlm_direction: null, signal_strength: null, computed_at: "2026-07-10T16:00:00Z", pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
  ] as any;
  const resistanceOdds = new Map([
    [14771, {
      mlHomeOdds: -120,
      mlAwayOdds: 110,
      ouOverOdds: -105,
      ouUnderOdds: -115,
      oddsSourceMl: {
        home: { source: "lines" as const, book: "pinnacle", odds: -120, line: null, observedAt: "2026-07-10T16:00:00Z" },
        away: { source: "lines" as const, book: "pinnacle", odds: 110, line: null, observedAt: "2026-07-10T16:00:00Z" },
      },
      oddsSourceOu: {
        over: { source: "lines" as const, book: "pinnacle", odds: -105, line: 8, observedAt: "2026-07-10T16:00:00Z" },
        under: { source: "lines" as const, book: "pinnacle", odds: -115, line: 8, observedAt: "2026-07-10T16:00:00Z" },
      },
    }],
  ]);
  const resistanceSharpSplits = [
    { canonical_event_id: "5058728", market_type: "total", selection_key: "5058728:total:under", provider: "sharpapi", source_book: "sharp_adjacent", source_type: "sharp_adjacent_book", bets_pct: 30, money_pct: 20, source_observed_at: "2026-07-10T16:00:00Z", fetched_at: "2026-07-10T16:00:00Z" },
    { canonical_event_id: "5058728", market_type: "total", selection_key: "5058728:total:over", provider: "sharpapi", source_book: "sharp_adjacent", source_type: "sharp_adjacent_book", bets_pct: 70, money_pct: 80, source_observed_at: "2026-07-10T16:00:00Z", fetched_at: "2026-07-10T16:00:00Z" },
  ] as any;
  const resistanceRecords = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, resistancePred]]),
    abbrevByTeamId,
    signalsByGameId: new Map([[14771, resistanceSignals]]),
    sourceAwareSplitsByGameId: new Map([[14771, resistanceSharpSplits]]),
    oddsByGameId: resistanceOdds,
  });
  const resistanceTotal = resistanceRecords.find((record) => record.market === "total");
  const resistanceAudit = (resistanceTotal?.snapshot_json as any)?.total_under_low_ticket_resistance_lean;
  check("low-ticket Under resistance promotes a guarded Watchlist to Lean", resistanceTotal?.play_grade === "lean" && resistanceTotal?.best_angle === false);
  check("low-ticket Under resistance records the additive rule", resistanceAudit?.rule_id === TOTAL_UNDER_LOW_TICKET_RESISTANCE_LEAN_RULE_ID && resistanceAudit?.money_minus_bets_pct === -10);
  check("low-ticket Under resistance records the validated SharpAPI provider", resistanceAudit?.split_provider === "sharpapi");
  check("low-ticket Under resistance is actionable in the decision pipeline", (resistanceTotal?.snapshot_json as any)?.decision_pipeline?.action_rule_id === TOTAL_UNDER_LOW_TICKET_RESISTANCE_LEAN_RULE_ID && (resistanceTotal?.snapshot_json as any)?.decision_pipeline?.board_action === "bet");

  const marketAnchoredPred = {
    ...resistancePred,
    ou_confidence: 51,
    sport_specific: {
      ...resistancePred.sport_specific,
      v2_2_audit: {
        ...resistancePred.sport_specific.v2_2_audit,
        ou_model_prob: 0.51,
        ou_market_prob: 0.54,
        ou_edge_pct: -3,
      },
    },
  };
  const marketAnchoredRecords = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, marketAnchoredPred]]),
    abbrevByTeamId,
    signalsByGameId: new Map([[14771, resistanceSignals]]),
    sourceAwareSplitsByGameId: new Map([[14771, resistanceSharpSplits]]),
    oddsByGameId: resistanceOdds,
  });
  const marketAnchoredTotal = marketAnchoredRecords.find((record) => record.market === "total");
  check(
    "validated low-ticket Under market evidence is not blocked by an arbitrary model-probability or edge floor",
    marketAnchoredTotal?.play_grade === "lean" &&
      (marketAnchoredTotal?.snapshot_json as any)?.total_under_low_ticket_resistance_lean?.rule_id === TOTAL_UNDER_LOW_TICKET_RESISTANCE_LEAN_RULE_ID,
  );

  const highTicketRecords = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, resistancePred]]),
    abbrevByTeamId,
    signalsByGameId: new Map([[14771, resistanceSignals]]),
    sourceAwareSplitsByGameId: new Map([[14771, resistanceSharpSplits.map((split: any) => split.selection_key.endsWith(":under") ? { ...split, bets_pct: 36 } : split)]]),
    oddsByGameId: resistanceOdds,
  });
  const highTicketTotal = highTicketRecords.find((record) => record.market === "total");
  check("ticket share above 35 percent cannot earn the resistance Lean", highTicketTotal?.play_grade !== "lean" && (highTicketTotal?.snapshot_json as any)?.total_under_low_ticket_resistance_lean === null);

  const playbookOnlyRecords = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, resistancePred]]),
    abbrevByTeamId,
    signalsByGameId: new Map([[14771, resistanceSignals]]),
    sourceAwareSplitsByGameId: new Map([[14771, resistanceSharpSplits.map((split: any) => ({ ...split, provider: "playbook", source_type: "multi_book_consensus" }))]]),
    oddsByGameId: resistanceOdds,
  });
  const playbookOnlyTotal = playbookOnlyRecords.find((record) => record.market === "total");
  check("Playbook-only splits cannot activate the SharpAPI-validated resistance sleeve", playbookOnlyTotal?.play_grade !== "lean" && (playbookOnlyTotal?.snapshot_json as any)?.total_under_low_ticket_resistance_lean === null);

  const supportPred = {
    ...resistancePred,
    predicted_ou_side: "under",
    ou_confidence: 51,
    sport_specific: {
      ...resistancePred.sport_specific,
      v2_2_audit: {
        ...resistancePred.sport_specific.v2_2_audit,
        ou_play_grade: "market_aligned",
        posterior_total: 7.3,
        ou_model_prob: 0.51,
        ou_market_prob: 0.54,
        ou_edge_pct: -3,
      },
    },
  };
  const supportRecords = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-07-10",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, supportPred]]),
    abbrevByTeamId,
    signalsByGameId: new Map([[14771, resistanceSignals]]),
    sourceAwareSplitsByGameId: new Map([[14771, resistanceSharpSplits.map((split: any) =>
      split.selection_key.endsWith(":under")
        ? { ...split, bets_pct: 30, money_pct: 40 }
        : { ...split, bets_pct: 70, money_pct: 60 }
    )]]),
    oddsByGameId: resistanceOdds,
  });
  const supportTotal = supportRecords.find((record) => record.market === "total");
  check(
    "10-point selected-side SharpAPI money support promotes a guarded total to Lean",
    supportTotal?.play_grade === "lean" &&
      (supportTotal?.snapshot_json as any)?.decision_pipeline?.action_rule_id === TOTAL_SHARPAPI_SUPPORT_LEAN_RULE_ID,
  );
  check(
    "total support Lean records exact provider and gap",
    (supportTotal?.snapshot_json as any)?.total_sharpapi_support_lean?.split_provider === "sharpapi" &&
      (supportTotal?.snapshot_json as any)?.total_sharpapi_support_lean?.money_minus_bets_pct === 10,
  );
}

// ── Phase 6B.22 — pure helpers for snapshot context ──────────────────
console.log("\n━━━ Phase 6B.22 — context snapshot helpers ━━━");

// americanToImpliedProb
check("impliedProb(null) = null", americanToImpliedProb(null) === null);
check("impliedProb(0) = null", americanToImpliedProb(0) === null);
check(
  "impliedProb(-120) ≈ 0.5454",
  Math.abs((americanToImpliedProb(-120) ?? 0) - 120 / 220) < 1e-6,
);
check(
  "impliedProb(+120) ≈ 0.4545",
  Math.abs((americanToImpliedProb(120) ?? 0) - 100 / 220) < 1e-6,
);
check("impliedProb(+100) = 0.5", americanToImpliedProb(100) === 0.5);

// buildPublicSplitsSnapshot
{
  const snap = buildPublicSplitsSnapshot([], "moneyline", null);
  check("public_splits: null picked side → null snapshot", snap === null);
}
{
  // No signals at all → null
  const snap = buildPublicSplitsSnapshot([], "moneyline", "home");
  check("public_splits: no signals → null snapshot", snap === null);
}
{
  // Both sides present, conflict & support computable
  const sigs = [
    { market_type: "moneyline", side: "home", public_money_pct: 30, public_betting_pct: 40, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: "2026-06-07T11:00:00Z", pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
    { market_type: "moneyline", side: "away", public_money_pct: 70, public_betting_pct: 40, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: "2026-06-07T11:00:00Z", pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
  ] as any;
  const snap = buildPublicSplitsSnapshot(sigs, "moneyline", "home") as any;
  check("public_splits: picked_side present", snap.picked_side === "home");
  check("public_splits: picked_money_pct = 30", snap.picked_money_pct === 30);
  check("public_splits: opp_side = away", snap.opp_side === "away");
  check("public_splits: opp_money_pct = 70", snap.opp_money_pct === 70);
  // Opposite has 70% money, 40% bets → gap = 30 ≥ 15, money ≥ 60 → CONFLICT = true
  check("public_splits: conflict = true (opp money 70, bets 40)", snap.conflict === true);
  check("public_splits: support = false (picked money 30 < 60)", snap.support === false);
  check("public_splits: source = 'sharp_signals'", snap.source === "sharp_signals");
  check("public_splits: fetched_at carried through", snap.fetched_at === "2026-06-07T11:00:00Z");
}
{
  // Picked-side data only — opp missing → conflict null, support computable
  const sigs = [
    { market_type: "moneyline", side: "home", public_money_pct: 80, public_betting_pct: 40, has_steam_move: null, has_reverse_line_movement: null, rlm_direction: null, signal_strength: null, computed_at: null, pinnacle_fair_probability: null, is_plus_ev: null, ev_pct: null, steam_detected_at: null, steam_books_count: null },
  ] as any;
  const snap = buildPublicSplitsSnapshot(sigs, "moneyline", "home") as any;
  check("public_splits: opp missing → conflict null (tri-state)", snap.conflict === null);
  check("public_splits: picked support computable", snap.support === true);
}

// buildLineMovementSnapshot
{
  const snap = buildLineMovementSnapshot([], [], [], "moneyline", null);
  check("line_movement: null picked side → null snapshot", snap === null);
}
{
  // No openers, no current → direction=unknown
  const snap = buildLineMovementSnapshot([], [], [], "moneyline", "home") as any;
  check("line_movement: no openers/current → direction=unknown", snap.direction === "unknown");
  check("line_movement: open_odds null when no openers", snap.open_odds_american === null);
}
{
  // Opener -120, current -130 (picked-side implied prob went UP) → toward_pick
  const openers = [
    { game_id: 1, market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -120, line_value: null, recorded_at: "2026-06-07T08:00:00Z" },
  ];
  const current = [
    { game_id: 1, market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -130, line_value: null },
  ];
  const snap = buildLineMovementSnapshot(openers, current, [], "moneyline", "home") as any;
  check("line_movement: opener -120 → current -130 → toward_pick", snap.direction === "toward_pick");
  check("line_movement: magnitude_pp > 0 when direction not unknown", typeof snap.magnitude_pp === "number" && snap.magnitude_pp > 0);
}
{
  // Opener -130, current -120 → against_pick (implied prob went down)
  const openers = [
    { game_id: 1, market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -130, line_value: null, recorded_at: "2026-06-07T08:00:00Z" },
  ];
  const current = [
    { game_id: 1, market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -120, line_value: null },
  ];
  const snap = buildLineMovementSnapshot(openers, current, [], "moneyline", "home") as any;
  check("line_movement: opener -130 → current -120 → against_pick", snap.direction === "against_pick");
}
{
  // A stale high-priority book must not override a fresh trusted book. The
  // prediction price selector already enforced this freshness contract; line
  // movement must use the same current reference or grades can contradict the
  // displayed/stored price.
  const openers = [
    { game_id: 1, market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -130, line_value: null, recorded_at: "2026-06-07T08:00:00Z" },
  ];
  const current = [
    { game_id: 1, market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -120, line_value: null, fetched_at: "2026-01-01T00:00:00Z" },
    { game_id: 1, market_type: "moneyline", side: "home", sportsbook: "ballybet", odds_american: -150, line_value: null, fetched_at: new Date().toISOString() },
  ];
  const snap = buildLineMovementSnapshot(openers, current, [], "moneyline", "home") as any;
  check("line_movement: stale priority price is ignored", snap.current_odds_american === -150);
  check("line_movement: fresh trusted price controls direction", snap.direction === "toward_pick");
}
{
  const openers = [
    { game_id: 1, market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -110, line_value: null, recorded_at: "2026-06-07T08:00:00Z" },
  ];
  const current = [
    { game_id: 1, market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -120, line_value: null, fetched_at: "2026-01-01T00:00:00Z" },
  ];
  const snap = buildLineMovementSnapshot(openers, current, [], "moneyline", "home") as any;
  check("line_movement: stale-only price is unavailable", snap.current_odds_american === null);
  check("line_movement: stale-only direction is unknown", snap.direction === "unknown");
}
{
  // Steam + RLM on picked side
  const sigs = [
    { market_type: "moneyline", side: "home", public_money_pct: null, public_betting_pct: null, has_steam_move: true, has_reverse_line_movement: true, rlm_direction: "home_to_away", signal_strength: "strong", computed_at: null },
  ] as any;
  const snap = buildLineMovementSnapshot([], [], sigs, "moneyline", "home") as any;
  check("line_movement: has_steam_move propagated", snap.has_steam_move === true);
  check("line_movement: has_reverse_line_movement propagated", snap.has_reverse_line_movement === true);
  check("line_movement: rlm_direction propagated", snap.rlm_direction === "home_to_away");
}
{
  // Total drift: 8.5 → 9.0
  const openers = [
    { game_id: 1, market_type: "total", side: "over", sportsbook: "pinnacle", odds_american: -110, line_value: 8.5, recorded_at: null },
  ];
  const current = [
    { game_id: 1, market_type: "total", side: "over", sportsbook: "pinnacle", odds_american: -110, line_value: 9.0 },
  ];
  const snap = buildLineMovementSnapshot(openers, current, [], "total", "over") as any;
  check("line_movement: total drift open=8.5", snap.total_open === 8.5);
  check("line_movement: total drift current=9.0", snap.total_current === 9.0);
}

// buildDataIntegritySnapshot
{
  const di = buildDataIntegritySnapshot({}, null, "moneyline") as any;
  check("data_integrity: starter_confirmed=unknown on empty snapshot", di.starter_confirmed === "unknown");
  check("data_integrity: market_two_sided_available=unknown without odds", di.market_two_sided_available === "unknown");
  check("data_integrity: bullpen_fallback=unknown (TODO upstream)", di.bullpen_fallback === "unknown");
}
// Forward Fix A (2026-06-09) — fixture GameOddsSnapshot now also
// carries per-side source metadata. These tests don't exercise it; use
// a constant "unavailable" filler so the type checker is satisfied.
const FILLER_SRC = { source: "unavailable" as const, book: null, odds: null, line: null, observedAt: null };
const FILLER_OU_SRC = { over: FILLER_SRC, under: FILLER_SRC };
const FILLER_ML_SRC = { home: FILLER_SRC, away: FILLER_SRC };
{
  const di = buildDataIntegritySnapshot(
    { starter_confirmed: true, lineup_confirmed: false, market_line_available: true, stale: false, v2_2_audit: { market_baseline_valid: true, market_source_quality: "real_api" } },
    { mlHomeOdds: -120, mlAwayOdds: 110, ouOverOdds: null, ouUnderOdds: null, oddsSourceMl: FILLER_ML_SRC, oddsSourceOu: FILLER_OU_SRC },
    "moneyline",
  ) as any;
  check("data_integrity: starter_confirmed=yes from true", di.starter_confirmed === "yes");
  check("data_integrity: lineup_confirmed=no from false", di.lineup_confirmed === "no");
  check("data_integrity: market_two_sided_available=yes when both ML sides present", di.market_two_sided_available === "yes");
  check("data_integrity: odds_source_quality propagated", di.odds_source_quality === "real_api");
}
{
  const di = buildDataIntegritySnapshot(
    {},
    { mlHomeOdds: -120, mlAwayOdds: null, ouOverOdds: null, ouUnderOdds: null, oddsSourceMl: FILLER_ML_SRC, oddsSourceOu: FILLER_OU_SRC },
    "moneyline",
  ) as any;
  check("data_integrity: market_two_sided_available=no when away null", di.market_two_sided_available === "no");
}

console.log("\n━━━ Total record selected-line basis ━━━");
{
  const underPred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 55.2,
    sport_specific: {
      ...v21SportSpecific,
      // Keep this selected-line storage test outside the calibrated 3-5pp
      // inversion band; that behavior has its own integration coverage.
      v2_2_audit: { market_total: 8, ou_model_prob: 0.548, ou_market_prob: 0.519, ou_edge_pct: 2.9 },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, underPred]]),
    abbrevByTeamId,
    oddsByGameId: new Map([[14771, {
      mlHomeOdds: -120,
      mlAwayOdds: 110,
      ouOverOdds: -114,
      ouUnderOdds: -125,
      oddsSourceMl: FILLER_ML_SRC,
      oddsSourceOu: {
        over: { source: "lines", book: "ballybet", odds: -114, line: 8, observedAt: "2026-06-26T10:06:53.690Z" },
        under: { source: "lines", book: "ballybet", odds: -125, line: 8.5, observedAt: "2026-06-26T10:06:53.690Z" },
      },
    }]]),
  });
  const ou = recs.find((r) => r.market === "total")!;
  check("Under total stores picked-side line, not Over line", ou.line_value === 8.5);
  check("Under total stores picked-side price", ou.odds_american === -125);
  check("Under total pick/side remain under", ou.pick === "under" && ou.side === "under");
}

console.log("\n━━━ Champion candidate correction — total projection conflict ━━━");
{
  const conflictPred = {
    ...basePrediction,
    predicted_ou_side: "over",
    ou_confidence: 58,
    predicted_home_score: 4.0,
    predicted_away_score: 4.0,
    sport_specific: {
      ...v21SportSpecific,
      ou_play_grade: "lean",
      ou_best_angle_eligible: false,
      total_projection_reconciliation: { mean_probability_divergence: false, grade_cap: null },
      v2_2_audit: {
        market_total: 8.5,
        ou_model_prob: 0.58,
        ou_market_prob: 0.52,
        ou_edge_pct: 6,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, conflictPred]]),
    abbrevByTeamId,
  });
  const ou = recs.find((r) => r.market === "total")!;
  check("projection-conflict total stands down", ou.no_bet === true && ou.best_angle === false && ou.play_grade === null);
  check("projection-conflict reason is explicit",
        typeof ou.no_bet_reason === "string" &&
        /champion_candidate_total_projection_conflict|projected total/i.test(ou.no_bet_reason));
  check("projection-conflict audit is snapshotted",
        (ou.snapshot_json as any)?.champion_candidate_correction?.replay_policy === "champion_candidate_guardrails_2026_07_08");
}

// ── Phase 6B.27 — V2.2 internal labels must not leak into public play_grade ──
console.log("\n━━━ Phase 6B.27 — public play_grade leak guard ━━━");
{
  // V2.2 emitted "no_bet" (edge < -1%). Public play_grade column must
  // be null; no_bet guidance must be true; snapshot.v2_2_audit must keep
  // raw "no_bet". This does NOT remove the prediction from W/L tracking —
  // real-sided no_bet rows still grade.
  const noBetSp = {
    ...v21SportSpecific,
    ml_play_grade: "no_bet",
    ml_no_bet_reason: "Negative model edge (-5.0%). Pick shown but do not bet.",
    ou_play_grade: "best_angle",
    v2_2_audit: {
      ml_play_grade: "no_bet",
      ou_play_grade: "best_angle",
      ml_no_bet_reason: "Negative model edge (-5.0%). Pick shown but do not bet.",
    },
  };
  const noBetPred = { ...basePrediction, sport_specific: noBetSp };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb", slateDate: "2026-06-06", launchDay: false, games: [baseGame],
    predictionByGameId: new Map([[14771, noBetPred]]), abbrevByTeamId,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const ou = recs.find((r) => r.market === "total")!;
  check("ML record.play_grade=null when V2.2 emits 'no_bet'", ml.play_grade === null);
  check("ML record.no_bet=true when model reason says do not bet", ml.no_bet === true);
  check("ML record.pick still present (customer-facing pick unchanged)", ml.pick === "home");
  check("ML record.confidence still present", ml.confidence === 54.0);
  check("ML snapshot_json.v2_2_audit.ml_play_grade='no_bet' (raw preserved)",
        (ml.snapshot_json as any)?.v2_2_audit?.ml_play_grade === "no_bet");
  check("ML snapshot_json.v2_2_audit.ml_no_bet_reason preserved",
        typeof (ml.snapshot_json as any)?.v2_2_audit?.ml_no_bet_reason === "string");
  check("OU record.play_grade demoted below Best Angle by total quality gate",
        ou.play_grade !== "best_angle");
}
{
  // Provisional / low-quality rows say "not a betting recommendation".
  // They should be guidance no_bet rows, but still carry pick/confidence so
  // the grader and calibration pipeline can track whether the read was right.
  const provisionalSp = {
    ...v21SportSpecific,
    ml_play_grade: "provisional",
    ml_no_bet_reason: "Data quality tier=low; not a betting recommendation.",
    ou_play_grade: "provisional",
    ou_no_bet_reason: "Data quality tier=low; not a betting recommendation.",
    v2_data_quality_tier: "low",
    v2_provisional: true,
    v2_2_audit: {
      ml_play_grade: "provisional",
      ou_play_grade: "provisional",
    },
  };
  const pred = { ...basePrediction, sport_specific: provisionalSp };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb", slateDate: "2026-06-06", launchDay: false, games: [baseGame],
    predictionByGameId: new Map([[14771, pred]]), abbrevByTeamId,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const ou = recs.find((r) => r.market === "total")!;
  check("Provisional ML: no_bet=true guidance", ml.no_bet === true);
  check("Provisional ML: pick still present", ml.pick === "home");
  check("Provisional ML: grade preserved as provisional", ml.play_grade === "provisional");
  check("Provisional total: no_bet=true guidance", ou.no_bet === true);
  check("Provisional total: pick still present", ou.pick === "over");
  check("Provisional total: grade preserved as provisional", ou.play_grade === "provisional");
}
{
  const unavailable = { source: "unavailable", book: null, odds: null, line: null, observedAt: null } as const;
  const missingTotalPricePred = {
    ...basePrediction,
    predicted_ou_side: "under",
    ou_confidence: 58,
    sport_specific: {
      ...v21SportSpecific,
      ou_play_grade: "lean",
      ou_best_angle_eligible: true,
      v2_2_audit: {
        market_total: 8.5,
        ou_model_prob: 0.58,
        ou_market_prob: 0.52,
        ou_edge_pct: 6,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-06",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, missingTotalPricePred]]),
    abbrevByTeamId,
    oddsByGameId: new Map([[14771, {
      mlHomeOdds: null,
      mlAwayOdds: null,
      ouOverOdds: null,
      ouUnderOdds: null,
      oddsSourceMl: { home: unavailable, away: unavailable },
      oddsSourceOu: { over: unavailable, under: unavailable },
    }]]),
  });
  const ou = recs.find((r) => r.market === "total")!;
  check("Missing total price: row still writes for audit", ou.pick === "under" && ou.line_value === 8.5);
  check("Missing total price: no_bet=true", ou.no_bet === true);
  check("Missing total price: never Best Angle", ou.best_angle === false);
  check("Missing total price: public play grade cleared", ou.play_grade === null);
  check(
    "Missing total price: no_bet_reason names price/implied gap",
    typeof ou.no_bet_reason === "string" && /real-book total price|market-implied/i.test(ou.no_bet_reason),
  );
}
{
  // V2.2 'held' on ML — same translator behavior.
  const heldSp = {
    ...v21SportSpecific,
    ml_play_grade: "held",
    ou_play_grade: "lean",
    v2_2_audit: { ml_play_grade: "held", ou_play_grade: "lean" },
  };
  const heldPred = { ...basePrediction, sport_specific: heldSp };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb", slateDate: "2026-06-06", launchDay: false, games: [baseGame],
    predictionByGameId: new Map([[14771, heldPred]]), abbrevByTeamId,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const ou = recs.find((r) => r.market === "total")!;
  check("ML record.play_grade=null when V2.2 emits 'held'", ml.play_grade === null);
  check("ML snapshot raw 'held' preserved", (ml.snapshot_json as any)?.v2_2_audit?.ml_play_grade === "held");
  check("OU record.play_grade='lean' without validated profile caps to Watchlist", ou.play_grade === expectTotalGrade("lean", ou));
}
{
  // V2.2 'toss_up' on OU side.
  const tuSp = {
    ...v21SportSpecific,
    ml_play_grade: "market_aligned",
    ou_play_grade: "toss_up",
    v2_2_audit: { ml_play_grade: "market_aligned", ou_play_grade: "toss_up" },
  };
  const tuPred = { ...basePrediction, sport_specific: tuSp };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb", slateDate: "2026-06-06", launchDay: false, games: [baseGame],
    predictionByGameId: new Map([[14771, tuPred]]), abbrevByTeamId,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const ou = recs.find((r) => r.market === "total")!;
  check("OU record.play_grade=null when V2.2 emits 'toss_up'", ou.play_grade === null);
  check("OU snapshot raw 'toss_up' preserved", (ou.snapshot_json as any)?.v2_2_audit?.ou_play_grade === "toss_up");
  check("ML record.play_grade='market_aligned' (actionable pass-through)", ml.play_grade === "market_aligned");
}
{
  // All four public labels pass through unchanged.
  for (const grade of ["best_angle", "lean", "market_aligned", "provisional"]) {
    const sp = {
      ...v21SportSpecific,
      ml_play_grade: grade,
      ou_play_grade: grade,
      v2_2_audit: { ml_play_grade: grade, ou_play_grade: grade },
    };
    const pred = { ...basePrediction, sport_specific: sp };
    const recs = buildPredictionRecordsFromSlate({
      sport: "mlb", slateDate: "2026-06-06", launchDay: false, games: [baseGame],
      predictionByGameId: new Map([[14771, pred]]), abbrevByTeamId,
    });
    const ml = recs.find((r) => r.market === "moneyline")!;
    const ou = recs.find((r) => r.market === "total")!;
    const expectedMl =
      grade === "provisional"
        ? "provisional"
        : grade === "market_aligned" || grade === "lean" || grade === "best_angle"
          ? "market_aligned"
          : grade;
    check(`ML record.play_grade='${grade}' (translator + grade recalibration)`, ml.play_grade === expectedMl);
    check(`OU record.play_grade='${grade}' (translator + total gate)`, ou.play_grade === expectTotalGrade(grade, ou));
  }
}
{
  // Defensive: unknown / future label maps to null (don't trust strings we
  // don't know are publicly safe).
  const unknownSp = {
    ...v21SportSpecific,
    ml_play_grade: "future_internal_signal",
    ou_play_grade: "best_angle",
    v2_2_audit: { ml_play_grade: "future_internal_signal", ou_play_grade: "best_angle" },
  };
  const pred = { ...basePrediction, sport_specific: unknownSp };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb", slateDate: "2026-06-06", launchDay: false, games: [baseGame],
    predictionByGameId: new Map([[14771, pred]]), abbrevByTeamId,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  check("ML record.play_grade=null for unknown label", ml.play_grade === null);
  check("ML snapshot preserves raw unknown label",
        (ml.snapshot_json as any)?.v2_2_audit?.ml_play_grade === "future_internal_signal");
}

// ── Phase 6B.28 — Daily Edge lock substrate captured at lock ──
console.log("\n━━━ Phase 6B.28 — Daily Edge lock substrate ━━━");
{
  const sig = {
    market_type: "moneyline", side: "home", public_money_pct: 64, public_betting_pct: 52,
    has_steam_move: false, has_reverse_line_movement: false, rlm_direction: null,
    signal_strength: "moderate", computed_at: "2026-06-06T16:10:00Z",
    pinnacle_fair_probability: 0.547, is_plus_ev: true, ev_pct: 2.3,
    steam_detected_at: null, steam_books_count: 0,
  };
  const line = { game_id: 14771, market_type: "moneyline" as const, side: "home", sportsbook: "pinnacle", odds_american: -130, line_value: null, fetched_at: "2026-06-06T16:15:00Z" };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb", slateDate: "2026-06-06", launchDay: false, games: [baseGame],
    predictionByGameId, abbrevByTeamId,
    signalsByGameId: new Map([[14771, [sig]]]),
    currentLinesByGameId: new Map([[14771, [line]]]),
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const sp = ml.snapshot_json as Record<string, unknown>;
  check("snapshot.signal_rows_at_lock is array", Array.isArray(sp.signal_rows_at_lock));
  check("signal_rows_at_lock captures signal",
        Array.isArray(sp.signal_rows_at_lock) && (sp.signal_rows_at_lock as any[]).length === 1);
  check("signal_rows_at_lock preserves public_money_pct",
        (sp.signal_rows_at_lock as any[])?.[0]?.public_money_pct === 64);
  check("signal_rows_at_lock preserves pinnacle_fair_probability (6B.28 field)",
        (sp.signal_rows_at_lock as any[])?.[0]?.pinnacle_fair_probability === 0.547);
  check("signal_rows_at_lock preserves ev_pct",
        (sp.signal_rows_at_lock as any[])?.[0]?.ev_pct === 2.3);
  check("snapshot.lines_at_lock is array",
        Array.isArray(sp.lines_at_lock) && (sp.lines_at_lock as any[]).length === 1);
  check("lines_at_lock preserves sportsbook + odds + fetched_at",
        (sp.lines_at_lock as any[])?.[0]?.sportsbook === "pinnacle" &&
        (sp.lines_at_lock as any[])?.[0]?.odds_american === -130 &&
        (sp.lines_at_lock as any[])?.[0]?.fetched_at === "2026-06-06T16:15:00Z");
  check("snapshot.predicted_scores_at_lock captures home/away",
        (sp.predicted_scores_at_lock as any)?.home === 4.2 &&
        (sp.predicted_scores_at_lock as any)?.away === 3.8);
  check("snapshot.framework_grades_at_lock captures ml/ou_grade",
        (sp.framework_grades_at_lock as any)?.ml_grade === "market_watch" &&
        (sp.framework_grades_at_lock as any)?.ou_grade === "market_watch");
  const memberFacing = sp.member_facing_at_lock as any;
  const layerVersions = sp.model_layer_versions as any;
  const expectedMemberGrade = ml.no_bet === true
    ? "no_play"
    : ml.best_angle === true
      ? "best_angle"
      : ml.play_grade;
  check("snapshot.model_layer_versions carries schema",
        layerVersions?.schema_version === MLB_MODEL_LAYER_VERSION_SCHEMA);
  check("snapshot.model_layer_versions marks active ML head",
        layerVersions?.market === "moneyline" &&
        layerVersions?.active_probability_head === layerVersions?.moneyline_probability_head);
  check("member_facing_at_lock captures finalized ML grade",
        memberFacing?.grade === expectedMemberGrade);
  check("member_facing_at_lock captures finalized ML pick/price",
        memberFacing?.pick === ml.pick &&
        memberFacing?.odds_american === ml.odds_american);
  check("member_facing_at_lock captures finalized ML Best Angle flag",
        memberFacing?.best_angle === ml.best_angle);
  check("member_facing_at_lock carries model layer stamp",
        memberFacing?.model_layer_versions?.active_probability_head === layerVersions?.active_probability_head);
}
{
  // Empty signals/lines → arrays still present but empty (honest "not
  // captured at lock"). Pre-6B.28 snapshots would have the keys absent;
  // post-6B.28 they're always present (empty if no live data).
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb", slateDate: "2026-06-06", launchDay: false, games: [baseGame],
    predictionByGameId, abbrevByTeamId,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const sp = ml.snapshot_json as Record<string, unknown>;
  check("empty signals → empty signal_rows_at_lock array",
        Array.isArray(sp.signal_rows_at_lock) && (sp.signal_rows_at_lock as any[]).length === 0);
  check("empty lines → empty lines_at_lock array",
        Array.isArray(sp.lines_at_lock) && (sp.lines_at_lock as any[]).length === 0);
  check("predicted_scores_at_lock still captured when signals/lines absent",
        (sp.predicted_scores_at_lock as any)?.home === 4.2);
  check("framework_grades_at_lock still captured when signals/lines absent",
        (sp.framework_grades_at_lock as any)?.ml_grade === "market_watch");
}
{
  // FI snapshot also carries substrate (signals/lines empty by design;
  // predicted_scores + framework_grades captured for NRFI/YRFI).
  const fullPred = {
    ...basePrediction, predicted_nrfi: true, nrfi_confidence: 55,
    sport_specific: { ...v21SportSpecific, hold_picks: [] },
    nrfi_grade: "market_watch",
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb", slateDate: "2026-06-06", launchDay: false, games: [baseGame],
    predictionByGameId: new Map([[14771, fullPred]]), abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const sp = fi.snapshot_json as Record<string, unknown>;
  check("FI snapshot has framework_grades_at_lock with nrfi_grade",
        (sp.framework_grades_at_lock as any)?.nrfi_grade === "market_watch");
  check("FI snapshot has predicted_scores_at_lock",
        (sp.predicted_scores_at_lock as any)?.home === 4.2);
  check("FI snapshot has member_facing_at_lock",
        (sp.member_facing_at_lock as any)?.market === "first_inning" &&
        (sp.member_facing_at_lock as any)?.pick === "NRFI");
  check("FI snapshot marks active FI probability head",
        (sp.model_layer_versions as any)?.market === "first_inning" &&
        (sp.model_layer_versions as any)?.active_probability_head ===
          (sp.model_layer_versions as any)?.first_inning_probability_head);
}

// ── P7-Commit-B — FI play_grade persistence going forward ──────────
console.log("\n━━━ P7-Commit-B — FI v2 play_grade persistence ━━━");
{
  // Without a current FI V2 audit grade, confidence alone must not invent an
  // actionable FI public grade.
  const fiLean = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 58,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiLean]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  check("FI conf=58 without audit grade → play_grade=null", fi.play_grade === null);
  check("FI conf=58 without audit grade → best_angle stays false", fi.best_angle === false);
  check("FI conf=58 → no_bet stays false", fi.no_bet === false);
}
{
  // Current FI v2 writer Best Angle must pass the final signed-edge/price gate
  // before it persists both play_grade and the tracking boolean.
  const fiBestAngle = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 65,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
      fi_v2_audit: {
        fi_play_grade: "best_angle",
        fi_no_bet_reason: null,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiBestAngle]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const gate = (fi.snapshot_json as any)?.fi_final_grade_resolution;
  check("FI v2 best_angle → play_grade='best_angle'", fi.play_grade === "best_angle");
  check("FI v2 best_angle → best_angle=true", fi.best_angle === true);
  check("FI v2 best_angle → final signed-edge gate stamped",
        gate?.rule_id === FI_VALIDATED_BEST_ANGLE_RULE_ID && gate?.action === "keep_as_best_angle");
  check("FI Best Angle decision pipeline stamps current release and validated rule",
        (fi.snapshot_json as any)?.decision_pipeline?.release_id === MLB_DAILY_EDGE_DECISION_RELEASE_ID &&
        (fi.snapshot_json as any)?.decision_pipeline?.board_action === "bet" &&
        (fi.snapshot_json as any)?.decision_pipeline?.actionable_grade === "best_angle" &&
        (fi.snapshot_json as any)?.decision_pipeline?.action_rule_id === FI_VALIDATED_BEST_ANGLE_RULE_ID);
  check("FI v2 best_angle → member-facing lock grade is best_angle",
        (fi.snapshot_json as any)?.member_facing_at_lock?.grade === "best_angle");
}
{
  const fiThinBestAngle = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 56,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
      fi_v2_audit: {
        fi_play_grade: "best_angle",
        fi_no_bet_reason: null,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiThinBestAngle]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const gate = (fi.snapshot_json as any)?.fi_final_grade_resolution;
  check("FI v2 thin final edge demotes stale Best Angle to Lean", fi.play_grade === "lean" && fi.best_angle === false);
  check("FI v2 thin final edge demotion is audited",
        gate?.rule_id === FI_VALIDATED_BEST_ANGLE_RULE_ID && gate?.action === "demote_to_lean");
}
{
  const expensiveNegativeEdgeLines = new Map([
    [14771, [
      { game_id: 14771, market_type: "first_inning_total", side: "under", sportsbook: "pinnacle", odds_american: -385, line_value: 0.5, fetched_at: "2026-06-11T16:10:00Z" },
      { game_id: 14771, market_type: "first_inning_total", side: "over", sportsbook: "pinnacle", odds_american: 300, line_value: 0.5, fetched_at: "2026-06-11T16:10:00Z" },
    ]],
  ]);
  const fiNegativeBestAngle = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 65,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
      fi_v2_audit: {
        fi_play_grade: "best_angle",
        fi_no_bet_reason: null,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiNegativeBestAngle]]),
    abbrevByTeamId,
    currentLinesByGameId: expensiveNegativeEdgeLines,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const gate = (fi.snapshot_json as any)?.fi_final_grade_resolution;
  check("FI v2 negative final edge blocks stale Best Angle to no_bet",
        fi.play_grade === "no_bet" && fi.best_angle === false && fi.no_bet === true);
  check("FI v2 negative final edge block is audited",
        gate?.rule_id === FI_VALIDATED_BEST_ANGLE_RULE_ID && gate?.action === "block_to_no_bet" && gate?.reason === "negative_final_edge");
}
{
  // The FI v2 writer can emit a Lean below the old confidence-only floor.
  const fiWriterLean = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 54,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
      fi_v2_audit: {
        fi_play_grade: "lean",
        fi_no_bet_reason: null,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiWriterLean]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  check("FI v2 lean below old floor → play_grade='lean'", fi.play_grade === "lean");
  check("FI v2 lean below old floor → best_angle=false", fi.best_angle === false);
  check("direct FI model Lean has an explicit immutable action path",
        (fi.snapshot_json as any)?.decision_pipeline?.board_action === "bet" &&
        (fi.snapshot_json as any)?.decision_pipeline?.actionable_grade === "lean" &&
        (fi.snapshot_json as any)?.decision_pipeline?.action_rule_id === FI_CALIBRATED_MODEL_LEAN_PATH_ID &&
        (fi.snapshot_json as any)?.decision_pipeline?.grade_source === "fi_v2_model");
}
{
  // An existing FI Lean with a validated final writer edge and playable price
  // is promoted additively; it is not dependent on a target board count.
  const fiWriterLeanPromotion = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 65,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
      fi_v2_audit: {
        fi_play_grade: "lean",
        fi_no_bet_reason: null,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiWriterLeanPromotion]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const gate = (fi.snapshot_json as any)?.fi_final_grade_resolution;
  check("validated FI Lean promotion → play_grade='best_angle'", fi.play_grade === "best_angle");
  check("validated FI Lean promotion → best_angle=true", fi.best_angle === true);
  check(
    "validated FI Lean promotion carries additive rule id",
    gate?.rule_id === FI_LEAN_SIGNED_EDGE_PRICE_BEST_ANGLE_PROMOTION_RULE_ID &&
      gate?.action === "promote_to_best_angle",
  );
}
{
  // An explicit provisional "Lean only" decision must win over the later
  // signed-edge promotion. This is paired with the clean promotion fixture
  // immediately above so the safety change does not disable the validated
  // additive path.
  const provisionalFiWriterLean = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 65,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
      fi_v2_audit: {
        fi_play_grade: "lean",
        fi_no_bet_reason: "Provisional / key feature missing; lean only.",
        provisional: true,
        fresh_data_ready: true,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, provisionalFiWriterLean]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const gate = (fi.snapshot_json as any)?.fi_final_grade_resolution;
  check("provisional FI Lean cannot be promoted to Best Angle",
        fi.play_grade === "lean" && fi.best_angle === false && fi.no_bet === false);
  check("provisional FI Best Angle block is audited",
        gate?.rule_id === FI_PROVISIONAL_BEST_ANGLE_BLOCK_RULE_ID &&
          gate?.action === "keep_as_lean" &&
          gate?.reason === "provisional_fi_audit");
}
{
  const nrfiMidbandBestAngle = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 60,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
      fi_v2_audit: {
        fi_play_grade: "best_angle",
        fi_no_bet_reason: null,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, nrfiMidbandBestAngle]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const gate = (fi.snapshot_json as any)?.fi_final_grade_resolution;
  check("NRFI 57%-63% posterior band stays actionable as Lean",
        fi.play_grade === "lean" && fi.best_angle === false && fi.no_bet === false);
  check("NRFI midband demotion carries its immutable rule id",
        gate?.rule_id === FI_NRFI_MIDBAND_BEST_ANGLE_DEMOTION_RULE_ID);
  check("NRFI midband decision pipeline reports the demotion as its live action rule",
        (fi.snapshot_json as any)?.decision_pipeline?.board_action === "bet" &&
        (fi.snapshot_json as any)?.decision_pipeline?.actionable_grade === "lean" &&
        (fi.snapshot_json as any)?.decision_pipeline?.action_rule_id === FI_NRFI_MIDBAND_BEST_ANGLE_DEMOTION_RULE_ID);
}
{
  const cleanPlusMoneyYrfiLean = {
    ...basePrediction,
    predicted_nrfi: false,
    nrfi_confidence: 54,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "yrfi",
      fi_v2_audit: {
        fi_play_grade: "lean",
        fi_no_bet_reason: null,
        provisional: false,
        fresh_data_ready: true,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, cleanPlusMoneyYrfiLean]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const gate = (fi.snapshot_json as any)?.fi_final_grade_resolution;
  check("positive-edge plus-money FI Lean promotes without a board quota",
        fi.play_grade === "best_angle" && fi.best_angle === true && fi.no_bet === false);
  check("plus-money FI promotion carries its immutable rule id",
        gate?.rule_id === FI_PLUS_MONEY_LEAN_BEST_ANGLE_PROMOTION_RULE_ID);
}
{
  const provisionalPlusMoneyYrfiLean = {
    ...basePrediction,
    predicted_nrfi: false,
    nrfi_confidence: 54,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "yrfi",
      fi_v2_audit: {
        fi_play_grade: "lean",
        fi_no_bet_reason: "Provisional / key feature missing; lean only.",
        provisional: true,
        fresh_data_ready: true,
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, provisionalPlusMoneyYrfiLean]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const gate = (fi.snapshot_json as any)?.fi_final_grade_resolution;
  check("plus-money promotion cannot bypass a provisional FI restriction",
        fi.play_grade === "lean" && fi.best_angle === false && fi.no_bet === false);
  check("provisional plus-money FI remains stamped by the block rule",
        gate?.rule_id === FI_PROVISIONAL_BEST_ANGLE_BLOCK_RULE_ID);
}
{
  // A stale scratch marker may be cleared only when the fresh FI audit has
  // confirmed both starters and is no longer provisional.
  const resolvedScratchFi = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 60,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
      nrfi_hold_reason: "starter_scratch_nrfi",
      fi_v2_audit: {
        fi_play_grade: "lean",
        fi_no_bet_reason: null,
        provisional: false,
        fresh_data_ready: true,
        feature_capture: {
          starter: {
            away: { confirmed: true },
            home: { confirmed: true },
          },
        },
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, resolvedScratchFi]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  const resolution = (fi.snapshot_json as any)?.fi_hold_reason_resolution;
  check("fresh confirmed starters clear stale scratch hold reason",
        (fi.snapshot_json as any)?.nrfi_hold_reason === null);
  check("scratch hold resolution is audited",
        resolution?.original_hold_reason === "starter_scratch_nrfi" &&
          resolution?.final_hold_reason === null &&
          resolution?.scratch_resolved_by_fresh_confirmed_starters === true);
}
{
  const fiWriterNoBet = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 56,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
      fi_v2_audit: {
        fi_play_grade: "no_bet",
        fi_no_bet_reason: "Edge too thin; no bet.",
      },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiWriterNoBet]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  check("FI v2 no_bet → play_grade='no_bet'", fi.play_grade === "no_bet");
  check("FI v2 no_bet → no_bet=true", fi.no_bet === true);
  check("FI v2 no_bet → reason persisted", fi.no_bet_reason === "Edge too thin; no bet.");
}
{
  // Confidence just below threshold (57) must NOT persist lean.
  const fiBelow = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 57,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "nrfi",
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiBelow]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  check("FI conf=57 (below floor) → play_grade=null", fi.play_grade === null);
}
{
  // High-confidence FI still needs the FI V2 audit grade to become actionable.
  const fiHigh = {
    ...basePrediction,
    predicted_nrfi: false,
    nrfi_confidence: 65,
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "yrfi",
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiHigh]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  check("FI conf=65 without audit grade → play_grade=null", fi.play_grade === null);
  check("FI conf=65 without audit grade → best_angle stays false", fi.best_angle === false);
}
{
  // Toss-Up FI (canonical) must NOT persist lean even if confidence
  // somehow clears the floor — Toss-Up always wins.
  const fiTossUp = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 60, // above floor, but Toss-Up overrides
    sport_specific: {
      ...v21SportSpecific,
      hold_picks: [],
      nrfi_decision_kind: "toss_up",
      auto_factors: { nrfi_expected_runs: 1.0 },
    },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiTossUp]]),
    abbrevByTeamId,
  });
  const fi = recs.find((r) => r.market === "first_inning")!;
  check("Toss-Up FI → play_grade='toss_up' even at conf=60", fi.play_grade === "toss_up");
  check("Toss-Up FI → no_bet=true preserved", fi.no_bet === true);
  check("Toss-Up FI → prediction_type='toss_up' preserved", fi.prediction_type === "toss_up");
  check("Toss-Up FI → member-facing lock grade is no_play",
        (fi.snapshot_json as any)?.member_facing_at_lock?.grade === "no_play");
}
{
  // FI held (nrfi in hold_picks) returns no record — already covered by
  // the early held-return branch. Sanity check that a held FI never
  // emits any row at all, so play_grade can't appear via this path.
  const fiHeld = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 60,
    sport_specific: { ...v21SportSpecific, hold_picks: ["nrfi"] },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, fiHeld]]),
    abbrevByTeamId,
  });
  const fi = recs.find((r) => r.market === "first_inning");
  check("FI held → no record emitted (so no spurious play_grade)", fi === undefined);
}
{
  // ML / Total unchanged — make sure adding FI persistence didn't
  // ripple into the other markets' play_grade derivation.
  const baseFiLean = {
    ...basePrediction,
    predicted_nrfi: true,
    nrfi_confidence: 58,
    sport_specific: { ...v21SportSpecific, hold_picks: [] },
  };
  const recs = buildPredictionRecordsFromSlate({
    sport: "mlb",
    slateDate: "2026-06-11",
    launchDay: false,
    games: [baseGame],
    predictionByGameId: new Map([[14771, baseFiLean]]),
    abbrevByTeamId,
    currentLinesByGameId: freshFiLinesByGameId,
  });
  const ml = recs.find((r) => r.market === "moneyline")!;
  const ou = recs.find((r) => r.market === "total")!;
  check("ML play_grade unchanged by FI persistence change",
        ml.play_grade === "market_aligned" /* FI persistence change must not alter champion ML grade calibration */);
  check("Total play_grade reflects the total quality gate",
        ou.play_grade !== "best_angle" /* base fixture is below the 70% total BA floor */);
}

// ── Stale unlocked FI cleanup guard ────────────────────────────────
console.log("\n━━━ stale unlocked FI cleanup guard ━━━");
{
  const src = readFileSync("lib/services/predictionRecordService.ts", "utf8");
  check("sync neutralizes stale unlocked FI rows when fresh-data gate stops proposing FI",
        src.includes("staleUnlockedFiRows") &&
        src.includes('r.market === "first_inning"') &&
        src.includes('play_grade: "held"') &&
        src.includes('prediction_type: "toss_up"') &&
        src.includes("model_layer_versions: currentModelLayers") &&
        src.includes("calibration_version: MLB_PUBLIC_CALIBRATION_VERSION") &&
        src.includes("stale_unlocked_fi_cleanup") &&
        src.includes("locked rows are never touched"));
}

// ── Post-start mutation guard ─────────────────────────────────────
console.log("\n━━━ post-start prediction record guard ━━━");
{
  const src = readFileSync("lib/services/predictionRecordService.ts", "utf8");
  check("MLB sync identifies games that already started",
        src.includes("const startedGameIds = new Set") &&
        src.includes('sport === "mlb"'));
  check("MLB sync refuses post-start prediction record upserts",
        src.includes("if (startedGameIds.has(proposedRecord.game_id))"));
  check("stale FI cleanup cannot mutate a post-start game",
        src.includes("!startedGameIds.has(r.game_id)"));

  const automodelSrc = readFileSync("lib/services/automodelService.ts", "utf8");
  check("automodel write runs independently exclude already-started games",
        automodelSrc.includes("fetchStartedExternalIds") &&
        automodelSrc.includes("const startedExternalIds = wantWrite") &&
        automodelSrc.includes("...startedExternalIds"));
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All prediction record service tests passed.");
