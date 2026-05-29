/**
 * Unit tests for the scores-model abstraction (Phase 4B).
 *
 *   • Factory routing (manual returned for false flags; throws for unimplemented auto)
 *   • Per-sport schema validation (happy path + sad paths × 7 sports)
 *   • Payload mirroring (MLB NRFI written to both top_level + sport_specific)
 *   • Back-compat shim (validateDanielsModelRow still works)
 *
 * Run with: npm run test:scores-model
 */

import { createClient } from "@supabase/supabase-js";
import {
  getScoresModelSource,
  __resetScoresModelSourceCache,
} from "../lib/scoresModel/factory";
import {
  validateScoresModelRow,
  validateDanielsModelRow,
  reconcilePredictedTotal,
  type ScoresModelInputRow,
  type DanielsModelRow,
} from "../lib/scoresModel/ingester";
import { ManualScoresModelSource } from "../lib/scoresModel/manual/ManualScoresModelSource";
import { getSportSchema, SPORT_SCHEMAS } from "../lib/scoresModel/sportSchemas";
import type { Sport } from "../lib/types/domain/Sport";

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

function checkThrows(label: string, fn: () => unknown, expectedSubstring?: string) {
  try {
    fn();
    fail++;
    const msg = `  ✗ ${label} did NOT throw`;
    console.log(msg);
    failures.push(msg);
  } catch (e) {
    const msg = (e as Error).message;
    const ok = !expectedSubstring || msg.includes(expectedSubstring);
    if (ok) {
      pass++;
      console.log(`  ✓ ${label} threw "${msg.slice(0, 80)}..."`);
    } else {
      fail++;
      console.log(`  ✗ ${label} threw wrong message: ${msg}`);
      failures.push(label);
    }
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

// Dummy Supabase client (factory only needs it as opaque token in these tests)
const dummyClient = createClient(
  "https://dummy.supabase.co",
  "dummy-key-not-used-in-tests"
);

const known = new Set<number>([18599100, 18599101, 18599102]);

// ─── Factory routing ─────────────────────────────────────────────────────
section("factory — routing");

// Default (no env vars set) → manual for every sport
const SPORTS: Sport[] = ["mlb", "nba", "nfl", "nhl", "ucl", "cfb", "cbb"];
for (const sport of SPORTS) {
  __resetScoresModelSourceCache();
  delete process.env[`USE_AUTO_SCORES_MODEL_${sport.toUpperCase().replace("CFB", "NCAAF").replace("CBB", "NCAAB")}`];
  const source = getScoresModelSource(sport, dummyClient);
  check(
    `factory(${sport}) → ManualScoresModelSource`,
    source instanceof ManualScoresModelSource
  );
  check(`  isAutomated = false`, source.isAutomated === false);
  check(`  metadata.source = 'manual_daniel'`, source.metadata.source === "manual_daniel");
}

// Setting USE_AUTO_SCORES_MODEL_MLB=true → throws (auto not implemented)
__resetScoresModelSourceCache();
process.env.USE_AUTO_SCORES_MODEL_MLB = "true";
checkThrows(
  "factory(mlb) with auto=true throws helpful error",
  () => getScoresModelSource("mlb", dummyClient),
  "not yet implemented"
);
process.env.USE_AUTO_SCORES_MODEL_MLB = "false";

// Defensive: only literal "true" enables auto. Other values stay on manual.
__resetScoresModelSourceCache();
process.env.USE_AUTO_SCORES_MODEL_NBA = "1";
const nbaWithOne = getScoresModelSource("nba", dummyClient);
check("factory: '1' value does NOT enable auto", nbaWithOne.isAutomated === false);
process.env.USE_AUTO_SCORES_MODEL_NBA = "TRUE";
__resetScoresModelSourceCache();
const nbaWithTRUE = getScoresModelSource("nba", dummyClient);
check("factory: 'TRUE' (case-sensitive) does NOT enable auto", nbaWithTRUE.isAutomated === false);
delete process.env.USE_AUTO_SCORES_MODEL_NBA;
__resetScoresModelSourceCache();

// Cache returns same instance per sport
const mlb1 = getScoresModelSource("mlb", dummyClient);
const mlb2 = getScoresModelSource("mlb", dummyClient);
check("factory caches per-sport instances", mlb1 === mlb2);

// Different sports → different instances
const nbaSource = getScoresModelSource("nba", dummyClient);
check("factory: mlb !== nba instances", (mlb1 as ManualScoresModelSource).sport !== (nbaSource as ManualScoresModelSource).sport);

// ─── SPORT_SCHEMAS structure ─────────────────────────────────────────────
section("sportSchemas — structure");

check("all 7 sports have schemas", Object.keys(SPORT_SCHEMAS).length === 7);
for (const sport of SPORTS) {
  const schema = getSportSchema(sport);
  check(
    `${sport}: schema has fields`,
    Array.isArray(schema.fields) && schema.fields.length > 0
  );
  check(
    `${sport}: schema.sport matches`,
    schema.sport === sport
  );
}

// Schemas should have these top-level core fields where applicable
const mlbSchema = getSportSchema("mlb");
const requiredMlbKeys = mlbSchema.fields.filter(f => f.required).map(f => f.key);
check(
  "mlb schema includes NRFI fields",
  requiredMlbKeys.includes("predicted_nrfi") && requiredMlbKeys.includes("nrfi_confidence")
);

const uclSchema = getSportSchema("ucl");
const uclKeys = uclSchema.fields.map(f => f.key);
check(
  "ucl schema includes win % fields",
  uclKeys.includes("home_win_pct") && uclKeys.includes("draw_pct") && uclKeys.includes("away_win_pct")
);
const uclMlField = uclSchema.fields.find(f => f.key === "predicted_ml_winner");
check(
  "ucl ML enum includes 'draw'",
  uclMlField?.options?.includes("draw") === true
);

const nbaSchema = getSportSchema("nba");
const nbaRequiredKeys = nbaSchema.fields.filter(f => f.required).map(f => f.key);
check(
  "nba schema does NOT require ML/OU confidences (per design)",
  !nbaRequiredKeys.includes("ml_confidence") && !nbaRequiredKeys.includes("ou_confidence")
);

// ─── validateScoresModelRow — MLB ─────────────────────────────────────────
section("validateScoresModelRow — MLB");

const validMlbRow: ScoresModelInputRow = {
  game_external_id: 18599100,
  predicted_home_score: 4.6,
  predicted_away_score: 3.8,
  predicted_total: 8.4,
  predicted_ml_winner: "home",
  ml_confidence: 64.5,
  predicted_ou_side: "under",
  ou_confidence: 53.2,
  predicted_nrfi: true,
  nrfi_confidence: 58.4,
  model_version: "daniels-v3.2",
  computed_at: "2026-05-22T13:00:00.000Z",
};

check("MLB valid row passes", validateScoresModelRow("mlb", validMlbRow, known).ok);

check(
  "MLB: missing NRFI fails",
  !validateScoresModelRow("mlb", { ...validMlbRow, predicted_nrfi: undefined as unknown as boolean }, known).ok
);
check(
  "MLB: ml_confidence > 100 fails",
  !validateScoresModelRow("mlb", { ...validMlbRow, ml_confidence: 110 }, known).ok
);
check(
  "MLB: negative score fails",
  !validateScoresModelRow("mlb", { ...validMlbRow, predicted_home_score: -1 }, known).ok
);
check(
  "MLB: unknown game_external_id fails",
  !validateScoresModelRow("mlb", { ...validMlbRow, game_external_id: 99999 }, known).ok
);

// Verify multiple errors collected
const multiBad = validateScoresModelRow("mlb", {
  ...validMlbRow,
  predicted_ml_winner: "neutral",
  ml_confidence: 110,
  predicted_ou_side: "push",
}, known);
check(
  "MLB: multiple errors collected (not just first)",
  !multiBad.ok && (multiBad as { ok: false; errors: string[] }).errors.length >= 3
);

// ─── validateScoresModelRow — NBA (no confidences) ────────────────────────
section("validateScoresModelRow — NBA");

const validNbaRow: ScoresModelInputRow = {
  game_external_id: 18599101,
  predicted_home_score: 114,
  predicted_away_score: 108,
  predicted_total: 222,
  sport_specific: { listed_line: 224.5 },
  model_version: "daniels-nba-v1",
  computed_at: "2026-05-22T13:00:00.000Z",
};

check("NBA valid row (no ML/OU confidences) passes", validateScoresModelRow("nba", validNbaRow, known).ok);

check(
  "NBA: missing predicted_home_score fails",
  !validateScoresModelRow("nba", { ...validNbaRow, predicted_home_score: undefined }, known).ok
);
check(
  "NBA: extra MLB-only fields ignored (validator doesn't require NRFI for NBA)",
  validateScoresModelRow("nba", { ...validNbaRow, predicted_nrfi: undefined }, known).ok
);

// ─── validateScoresModelRow — NFL ────────────────────────────────────────
section("validateScoresModelRow — NFL");

const validNflRow: ScoresModelInputRow = {
  game_external_id: 18599102,
  predicted_home_score: 24,
  predicted_away_score: 21,
  predicted_total: 45,
  predicted_ml_winner: "home",
  ml_confidence: 56.0,
  predicted_ou_side: "over",
  ou_confidence: 54.0,
  model_version: "daniels-nfl-v1",
  computed_at: "2026-05-22T13:00:00.000Z",
};

check("NFL valid row passes", validateScoresModelRow("nfl", validNflRow, known).ok);
check(
  "NFL: missing ml_confidence fails (required for NFL)",
  !validateScoresModelRow("nfl", { ...validNflRow, ml_confidence: undefined }, known).ok
);

// ─── validateScoresModelRow — UCL (draw + win %s) ────────────────────────
section("validateScoresModelRow — UCL");

const validUclRow: ScoresModelInputRow = {
  game_external_id: 18599100,  // reuse known id
  predicted_home_score: 1.7,
  predicted_away_score: 1.2,
  predicted_total: 2.9,
  predicted_ml_winner: "draw",
  sport_specific: {
    home_win_pct: 42,
    draw_pct: 28,
    away_win_pct: 30,
  },
  model_version: "daniels-ucl-v1",
  computed_at: "2026-05-22T13:00:00.000Z",
};

check("UCL valid row (draw pick + win %s) passes", validateScoresModelRow("ucl", validUclRow, known).ok);
check(
  "UCL: missing home_win_pct (sport_specific required) fails",
  !validateScoresModelRow("ucl", {
    ...validUclRow,
    sport_specific: { draw_pct: 28, away_win_pct: 30 },
  }, known).ok
);

// MLB schema does NOT accept "draw" for ML winner
check(
  "MLB: predicted_ml_winner='draw' fails (MLB doesn't have draws)",
  !validateScoresModelRow("mlb", { ...validMlbRow, predicted_ml_winner: "draw" }, known).ok
);

// ─── validateScoresModelRow — NHL ────────────────────────────────────────
section("validateScoresModelRow — NHL");

const validNhlRow: ScoresModelInputRow = {
  game_external_id: 18599101,
  predicted_home_score: 3,
  predicted_away_score: 2,
  predicted_total: 5,
  predicted_ml_winner: "away",
  ml_confidence: 51.0,
  predicted_ou_side: "under",
  ou_confidence: 53.0,
  model_version: "daniels-nhl-v1",
  computed_at: "2026-05-22T13:00:00.000Z",
};

check("NHL valid row passes", validateScoresModelRow("nhl", validNhlRow, known).ok);

// ─── Back-compat shim (validateDanielsModelRow) ──────────────────────────
section("back-compat shim — validateDanielsModelRow");

const legacyMlbRow: DanielsModelRow = {
  game_external_id: 18599100,
  predicted_home_score: 4.6,
  predicted_away_score: 3.8,
  predicted_total: 8.4,
  predicted_ml_winner: "home",
  ml_confidence: 64.5,
  predicted_ou_side: "under",
  ou_confidence: 53.2,
  predicted_nrfi: true,
  nrfi_confidence: 58.4,
  model_version: "daniels-v3.2",
  computed_at: "2026-05-22T13:00:00.000Z",
};
check("back-compat: valid row passes", validateDanielsModelRow(legacyMlbRow, known).ok);
check(
  "back-compat: bad row fails with single error string",
  !validateDanielsModelRow({ ...legacyMlbRow, ml_confidence: -1 }, known).ok
);

// ─── Fix 7.2.3 — reconcilePredictedTotal (server-side invariant) ────────
// The ingester silently recomputes predicted_total = round(home + away, 1)
// for any sport whose schema declares the computeFrom marker. Direct-API
// callers that submit a mismatched total get it corrected before UPSERT.
section("Fix 7.2.3 — reconcilePredictedTotal");

const reconciledMismatch = reconcilePredictedTotal("mlb", {
  ...legacyMlbRow,
  predicted_home_score: 4.3,
  predicted_away_score: 3.5,
  predicted_total: 8, // caller-submitted; wrong
});
check(
  `MLB mismatched total (4.3 + 3.5 → 8) silently recomputed to 7.8 (got ${(reconciledMismatch as { predicted_total: number }).predicted_total})`,
  (reconciledMismatch as { predicted_total: number }).predicted_total === 7.8
);

const reconciledMatch = reconcilePredictedTotal("mlb", {
  ...legacyMlbRow,
  predicted_home_score: 4.5,
  predicted_away_score: 3.5,
  predicted_total: 8.0,
});
check(
  `MLB matched total (4.5 + 3.5 = 8.0) preserved as 8.0 (got ${(reconciledMatch as { predicted_total: number }).predicted_total})`,
  (reconciledMatch as { predicted_total: number }).predicted_total === 8.0
);

const reconciledFloatArtifact = reconcilePredictedTotal("mlb", {
  ...legacyMlbRow,
  predicted_home_score: 4.1,
  predicted_away_score: 3.2,
  predicted_total: 99, // wrong on purpose
});
check(
  `MLB float-artifact case (4.1 + 3.2) rounds to clean 7.3, not 7.300000000000001 (got ${(reconciledFloatArtifact as { predicted_total: number }).predicted_total})`,
  (reconciledFloatArtifact as { predicted_total: number }).predicted_total === 7.3
);

const reconciledInteger = reconcilePredictedTotal("mlb", {
  ...legacyMlbRow,
  predicted_home_score: 4,
  predicted_away_score: 3,
  predicted_total: 99,
});
check(
  `MLB integer inputs (4 + 3 → 7) recomputed cleanly (got ${(reconciledInteger as { predicted_total: number }).predicted_total})`,
  (reconciledInteger as { predicted_total: number }).predicted_total === 7
);

const reconciledMissingHome = reconcilePredictedTotal("mlb", {
  ...legacyMlbRow,
  predicted_home_score: undefined as unknown as number,
  predicted_away_score: 3.5,
  predicted_total: 99,
});
check(
  `MLB missing home score: total left unchanged (defensive — got ${(reconciledMissingHome as { predicted_total: number }).predicted_total})`,
  (reconciledMissingHome as { predicted_total: number }).predicted_total === 99
);

// NBA also has computeFrom; verify it applies cross-sport.
const reconciledNba = reconcilePredictedTotal("nba", {
  game_external_id: 1,
  predicted_home_score: 112.5,
  predicted_away_score: 108.5,
  predicted_total: 200, // wrong
  model_version: "x",
  computed_at: "2026-01-01T00:00:00.000Z",
} as unknown as ScoresModelInputRow);
check(
  `NBA reconcile (112.5 + 108.5 → 221) — confirms cross-sport behavior (got ${(reconciledNba as { predicted_total: number }).predicted_total})`,
  (reconciledNba as { predicted_total: number }).predicted_total === 221
);

// ─── Phase 3C — validationMode (manual vs auto_model) ────────────────────
// The auto-model relaxation lets ingestScoresModel accept rows with null
// pick fields when justified by sport_specific.held / hold_picks. Manual
// upload MUST stay strict — these tests pin both behaviors.
section("Phase 3C — validationMode (manual stays strict; auto allows justified holds)");

// MLB row with NRFI held — auto-model would output predicted_nrfi=null
// + nrfi_confidence=null and record sport_specific.hold_picks=["nrfi"].
const mlbRowNrfiHeld: ScoresModelInputRow = {
  game_external_id: 18599100,
  predicted_home_score: 5.1,
  predicted_away_score: 4.4,
  predicted_total: 9.5,
  predicted_ml_winner: "home",
  ml_confidence: 58.5,
  predicted_ou_side: "over",
  ou_confidence: 53.0,
  // predicted_nrfi + nrfi_confidence omitted (auto held NRFI)
  model_version: "auto_v1.0_mlb_rules",
  computed_at: "2026-05-22T13:00:00.000Z",
  sport_specific: {
    held: false,
    hold_picks: ["nrfi"],
    model_version: "auto_v1.0_mlb_rules",
  },
};

// 1. Manual mode rejects NRFI hold (preserves V1 strict behavior).
const manualVerdict = validateScoresModelRow(
  "mlb",
  mlbRowNrfiHeld,
  known,
  "manual"
);
check(
  "Manual mode REJECTS held-NRFI row (manual upload stays strict — required fields enforced)",
  !manualVerdict.ok &&
    (manualVerdict as { errors: string[] }).errors.some((e) =>
      e.includes("predicted_nrfi")
    )
);

// 2. Auto mode ACCEPTS the same row (NRFI null is justified by hold_picks).
const autoVerdictJustified = validateScoresModelRow(
  "mlb",
  mlbRowNrfiHeld,
  known,
  "auto_model"
);
check(
  "Auto mode ACCEPTS held-NRFI row when sport_specific.hold_picks=['nrfi']",
  autoVerdictJustified.ok
);

// 3. Auto mode also accepts when sport_specific.held=true (whole row held).
const mlbRowAllHeld: ScoresModelInputRow = {
  game_external_id: 18599101,
  predicted_home_score: 4.5,
  predicted_away_score: 4.5,
  predicted_total: 9.0,
  // ALL three picks omitted (sport_specific.held=true)
  model_version: "auto_v1.0_mlb_rules",
  computed_at: "2026-05-22T13:00:00.000Z",
  sport_specific: {
    held: true,
    hold_picks: ["ml", "ou", "nrfi"],
    model_version: "auto_v1.0_mlb_rules",
    hold_reason: "starter not confirmed",
  },
};
check(
  "Auto mode ACCEPTS all-held row when sport_specific.held=true",
  validateScoresModelRow("mlb", mlbRowAllHeld, known, "auto_model").ok
);

// 4. Auto mode REJECTS unjustified nulls — pick is null but no hold context.
const mlbRowUnjustified: ScoresModelInputRow = {
  game_external_id: 18599102,
  predicted_home_score: 5.0,
  predicted_away_score: 4.0,
  predicted_total: 9.0,
  predicted_ml_winner: "home",
  ml_confidence: 60.0,
  predicted_ou_side: "over",
  ou_confidence: 55.0,
  // predicted_nrfi + nrfi_confidence missing, but sport_specific does
  // NOT justify the null (held=false, hold_picks doesn't include "nrfi")
  model_version: "auto_v1.0_mlb_rules",
  computed_at: "2026-05-22T13:00:00.000Z",
  sport_specific: {
    held: false,
    hold_picks: [],
    model_version: "auto_v1.0_mlb_rules",
  },
};
const autoVerdictUnjustified = validateScoresModelRow(
  "mlb",
  mlbRowUnjustified,
  known,
  "auto_model"
);
check(
  "Auto mode REJECTS unjustified NRFI null (no hold_picks entry)",
  !autoVerdictUnjustified.ok &&
    (autoVerdictUnjustified as { errors: string[] }).errors.some((e) =>
      e.includes("unjustified null")
    )
);

// 5. Auto mode REJECTS null score even when sport_specific.held=true.
//    Scores are not in the relaxable pick list — auto-model always
//    produces predicted_home_score / predicted_away_score / predicted_total.
const mlbRowMissingScore: ScoresModelInputRow = {
  game_external_id: 18599100,
  // predicted_home_score MISSING
  predicted_away_score: 4.0,
  predicted_total: 8.0,
  model_version: "auto_v1.0_mlb_rules",
  computed_at: "2026-05-22T13:00:00.000Z",
  sport_specific: {
    held: true,
    hold_picks: ["ml", "ou", "nrfi"],
    model_version: "auto_v1.0_mlb_rules",
  },
};
const autoVerdictMissingScore = validateScoresModelRow(
  "mlb",
  mlbRowMissingScore,
  known,
  "auto_model"
);
check(
  "Auto mode REJECTS missing predicted_home_score even when held=true (scores not relaxable)",
  !autoVerdictMissingScore.ok &&
    (autoVerdictMissingScore as { errors: string[] }).errors.some(
      (e) => e.includes("Home Runs") || e.includes("predicted_home_score")
    )
);

// 6. Auto mode still enforces format on PRESENT pick fields (e.g.
//    confidence > 100 still fails, even though confidence is relaxable).
const mlbRowBadConfidence: ScoresModelInputRow = {
  ...mlbRowAllHeld,
  predicted_ml_winner: "home",
  ml_confidence: 150,  // OUT OF RANGE
  sport_specific: {
    held: false,
    hold_picks: ["ou", "nrfi"],
    model_version: "auto_v1.0_mlb_rules",
  },
};
const autoVerdictBadConf = validateScoresModelRow(
  "mlb",
  mlbRowBadConfidence,
  known,
  "auto_model"
);
check(
  "Auto mode still enforces format on PRESENT pick fields (ml_confidence=150 fails)",
  !autoVerdictBadConf.ok
);

// 7. Default validationMode is "manual" — back-compat for all existing callers.
const defaultModeVerdict = validateScoresModelRow(
  "mlb",
  mlbRowNrfiHeld,
  known
  // no validationMode argument
);
check(
  "Default validationMode is 'manual' — back-compat preserved (held-NRFI row rejected)",
  !defaultModeVerdict.ok
);

// ─── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All scores-model tests passed.`);
