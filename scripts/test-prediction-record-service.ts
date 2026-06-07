/**
 * Push 4 — tests for the pure record-building portion of
 * predictionRecordService.
 *
 * Tests the synthesis logic that splits one game_predictions row
 * into ML/total/FI prediction_records. Pure / fixture-only — no DB.
 */

import { buildPredictionRecordsFromSlate } from "../lib/services/predictionRecordService";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── Game + prediction fixtures ────────────────────────────────────
const baseGame = {
  id: 14771,
  external_id: 5058728,
  game_date: "2026-06-06T18:20:00Z",
  slate_status: "published",
  home_team_id: 771,
  away_team_id: 780,
};

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
};

const abbrevByTeamId = new Map<number, string>([[771, "CHC"], [780, "SF"]]);
const predictionByGameId = new Map<number, typeof basePrediction>([[14771, basePrediction]]);

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
  check("ML play_grade=lean", ml.play_grade === "lean");
  check("ML best_angle=false", ml.best_angle === false);
  check("OU best_angle=true", ou.best_angle === true);
  check("OU play_grade=best_angle", ou.play_grade === "best_angle");
  check("OU line_value=7.5 (from v2_1_audit.market_total)", ou.line_value === 7.5);
  check("Data quality tier=high", ml.data_quality_tier === "high");
  check("Provisional=false", ml.provisional === false);
  check("snapshot_json preserved", ml.snapshot_json !== null && (ml.snapshot_json as Record<string, unknown>).model_used === "v2_1");
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
  });
  check("returns 3 records", recs.length === 3);
  const fi = recs.find((r) => r.market === "first_inning");
  check("FI record exists", fi !== undefined);
  check("FI pick='NRFI'", fi?.pick === "NRFI");
  check("FI side='under'", fi?.side === "under");
  check("FI line_value=0.5", fi?.line_value === 0.5);
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
    [14771, [{ market_type: "moneyline", side: "away", public_money_pct: 78, public_betting_pct: 27 }]],
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
}
{
  // BAL@TOR moneyline with no signals → guard goes neutral, BA passes through.
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
  check("ML best_angle PRESERVED when signals map is absent", ml.best_angle === true);
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
    [14771, [{ market_type: "moneyline", side: "away", public_money_pct: null, public_betting_pct: 33 }]],
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
    "ML best_angle PRESERVED when opp.public_money_pct is null (missing ≠ confirmation)",
    ml.best_angle === true,
  );
}
{
  // Below-threshold opposing money (e.g. 57/33) → guard does NOT fire.
  const baTorPred = {
    ...basePrediction,
    sport_specific: { ...v21SportSpecific, hold_picks: [], ml_best_angle_eligible: true, ou_best_angle_eligible: false },
  };
  const signalsBelowThreshold = new Map([
    [14771, [{ market_type: "moneyline", side: "away", public_money_pct: 57, public_betting_pct: 33 }]],
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
  check("ML best_angle PRESERVED when opp money <60", ml.best_angle === true);
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
    [14771, [{ market_type: "total", side: "under", public_money_pct: 88, public_betting_pct: 50 }]],
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

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All prediction record service tests passed.");
