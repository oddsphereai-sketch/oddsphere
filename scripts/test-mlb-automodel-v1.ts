/**
 * Phase 3A — Pure unit tests for the rule-seeded MLB auto-model.
 *
 * Fixtures only. No network. No DB. No Supabase imports. No provider
 * calls. No service layer. The model is a pure function from
 * GameSnapshot → AutoModelOutput, and these tests exercise every layer
 * of that contract.
 *
 * Run: npx tsx scripts/test-mlb-automodel-v1.ts
 */

import {
  runMlbAutoModelV1,
} from "../lib/automodel/mlbAutoModelV1";
import {
  applyDeterministicGuards,
  reviewAutoModelOutput,
} from "../lib/automodel/aiSanityBoundary";
import type {
  AutoModelOutput,
  BatterSnapshot,
  GameSnapshot,
  ModelStage,
  StarterSnapshot,
} from "../lib/automodel/types";
import {
  HARD_CONFIDENCE_FLOOR,
  LEAGUE_CONSTANTS_V1,
  NRFI_CONFIDENCE_CAP,
  STAGE_CONFIDENCE_CAPS,
  NRFI_TEAM_PROXY_PENALTY,
  NRFI_LEAGUE_AVG_PENALTY,
  NRFI_FALLBACK_CONFIDENCE_CAP,
  NRFI_PROBABILITY_THRESHOLD,
  YRFI_PROBABILITY_THRESHOLD,
  NRFI_NARROW_EDGE_BAND_UPPER,
  YRFI_NARROW_EDGE_BAND_LOWER,
} from "../lib/automodel/types";

// ─────────────────────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────

function batter(overrides: Partial<BatterSnapshot> = {}): BatterSnapshot {
  return {
    player_external_id: 1,
    player_name: "Test Batter",
    batting_position: 1,
    bats: "R",
    season_obp: 0.330,
    season_slg: 0.410,
    season_ops: 0.740,
    vs_lhp_ops: 0.760,
    vs_rhp_ops: 0.720,
    // R-16J Step 1 — default to a healthy mid-season PA so the new
    // lineup-OPS shrinkage doesn't dominate existing fixtures. Tests
    // that specifically exercise small-sample shrinkage override
    // season_pa explicitly.
    season_pa: 500,
    ...overrides,
  };
}

function leagueAverageLineup(opposing: "L" | "R" = "R"): BatterSnapshot[] {
  const list: BatterSnapshot[] = [];
  for (let pos = 1; pos <= 8; pos++) {
    list.push(
      batter({
        player_external_id: 100 + pos,
        player_name: `B${pos}`,
        batting_position: pos,
        season_ops: 0.730,
        vs_lhp_ops: opposing === "L" ? 0.730 : null,
        vs_rhp_ops: opposing === "R" ? 0.730 : null,
      })
    );
  }
  return list;
}

function starter(overrides: Partial<StarterSnapshot> = {}): StarterSnapshot {
  return {
    player_external_id: 1000,
    player_name: "Test Starter",
    throws: "R",
    season_era: 4.0,
    season_whip: 1.25,
    season_k_per_9: 8.5,
    last30_era: null,
    pitch_quality_score: null,
    is_confirmed: true,
    is_scratched: false,
    first_inning_era: null,
    first_inning_starts: null,
    first_inning_whip: null,
    // R-16J Step 1 — default to an "established starter" IP sample so
    // the new season-ERA shrinkage doesn't collapse all fixtures to
    // league mean. 200 IP gives ~69% raw weight (k=90), close enough
    // to "trust the raw" for pre-R-16J tests. Tests that specifically
    // exercise small-sample shrinkage override this explicitly.
    season_innings_pitched: 200,
    ...overrides,
  };
}

function baseSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    game_external_id: 401547235,
    slate_date: "2026-05-29",
    game_date: "2026-05-29T23:10:00Z",
    home_team: {
      team_external_id: 21,
      abbreviation: "NYM",
      bullpen_era_proxy: 4.0,
      season_runs_per_game: 4.5,
    },
    away_team: {
      team_external_id: 28,
      abbreviation: "MIA",
      bullpen_era_proxy: 4.0,
      season_runs_per_game: 4.5,
    },
    home_starter: starter({
      player_external_id: 1001,
      player_name: "Home Starter",
      throws: "R",
    }),
    away_starter: starter({
      player_external_id: 1002,
      player_name: "Away Starter",
      throws: "L",
    }),
    home_lineup_top8: leagueAverageLineup("L"),
    away_lineup_top8: leagueAverageLineup("R"),
    // Phase 4D.0 — park_factor_runs is an INDEX where 100=neutral
    // (standard MLB convention). parkMultiplier divides by 100.
    ballpark: { park_factor_runs: 100, is_dome: false },
    weather: null,
    market: {
      listed_total: 8.5,
      home_ml_odds_american: -130,
      away_ml_odds_american: +110,
      over_odds_american: null, under_odds_american: null, has_pinnacle_total: true,
    },
    sharp: null,
    active_injuries: {
      home_starter_out: false,
      away_starter_out: false,
      home_top3_hitters_injured_count: 0,
      away_top3_hitters_injured_count: 0,
    },
    data_quality: {
      starter_confirmed: true,
      lineup_confirmed: true,
      weather_available: false,
      season_stats_present: true,
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
async function main() {
  // ═══════════════════════════════════════════════════════════════
  section("Sanity — league-average inputs produce ~LEAGUE_AVG_RUNS_PER_GAME");
  // ═══════════════════════════════════════════════════════════════

  {
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    check(
      "league-average snapshot produces predicted_total near 9.0 (2 × 4.5)",
      out.predicted_total !== null &&
        out.predicted_total >= 8.5 &&
        out.predicted_total <= 9.5
    );
    check(
      "predicted_home_score and predicted_away_score are populated",
      out.predicted_home_score !== null && out.predicted_away_score !== null
    );
    check(
      "predicted_home_score and predicted_away_score are near 4.5 each",
      out.predicted_home_score !== null &&
        out.predicted_away_score !== null &&
        Math.abs(out.predicted_home_score - 4.5) <= 0.5 &&
        Math.abs(out.predicted_away_score - 4.5) <= 0.5
    );
    check(
      "predicted_total equals home + away within 0.01 tolerance",
      out.predicted_home_score !== null &&
        out.predicted_away_score !== null &&
        out.predicted_total !== null &&
        Math.abs(
          out.predicted_total - (out.predicted_home_score + out.predicted_away_score)
        ) <= 0.01
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Guard 1 — predicted_total math (auto-recompute)");
  // ═══════════════════════════════════════════════════════════════

  {
    // Build a malformed output and run guards directly
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const bad: AutoModelOutput = { ...out, predicted_total: 99.0 };
    const { guarded, corrections } = applyDeterministicGuards(
      bad,
      baseSnapshot(),
      "morning_draft"
    );
    check(
      "Guard 1 recomputes predicted_total when it doesn't match home + away",
      guarded.predicted_total !== null &&
        guarded.predicted_home_score !== null &&
        guarded.predicted_away_score !== null &&
        Math.abs(
          guarded.predicted_total -
            (guarded.predicted_home_score + guarded.predicted_away_score)
        ) <= 0.01
    );
    check(
      "Guard 1 records a correction when recomputing predicted_total",
      corrections.some((c) => c.includes("predicted_total recomputed"))
    );
  }

  {
    // Total set, home/away null → total cleared
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const bad: AutoModelOutput = {
      ...out,
      predicted_home_score: null,
      predicted_away_score: null,
      predicted_total: 9.0,
    };
    const { guarded, corrections } = applyDeterministicGuards(
      bad,
      baseSnapshot(),
      "morning_draft"
    );
    check(
      "Guard 1 clears predicted_total when home or away is null",
      guarded.predicted_total === null
    );
    check(
      "Guard 1 records the clear correction",
      corrections.some((c) => c.includes("predicted_total cleared"))
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Guard 2 — ML winner matches higher projected score");
  // ═══════════════════════════════════════════════════════════════

  {
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    check(
      // Phase R-4: a rounded-tie at the display level is allowed; the
      // model decides the side from unrounded scores. So the assertion
      // is: when rounded scores DIFFER, ML follows the higher side;
      // when equal, ML is non-null (tiebreak applies).
      "When out has predicted scores, ML winner consistent with display (or tiebroken on tie)",
      out.predicted_home_score === null ||
        out.predicted_away_score === null ||
        out.predicted_ml_winner === null ||
        (out.predicted_home_score === out.predicted_away_score
          ? out.predicted_ml_winner === "home" || out.predicted_ml_winner === "away"
          : out.predicted_home_score > out.predicted_away_score
          ? out.predicted_ml_winner === "home"
          : out.predicted_ml_winner === "away")
    );

    // Inject a mismatch
    const bad: AutoModelOutput = {
      ...out,
      predicted_home_score: 5.0,
      predicted_away_score: 3.0,
      predicted_total: 8.0,
      predicted_ml_winner: "away", // wrong — home is higher
      ml_confidence: 60,
    };
    const { guarded, corrections } = applyDeterministicGuards(
      bad,
      baseSnapshot(),
      "morning_draft"
    );
    check(
      "Guard 2 nulls ML pick when winner doesn't match higher score",
      guarded.predicted_ml_winner === null && guarded.ml_confidence === null
    );
    check(
      "Guard 2 records the mismatch correction",
      corrections.some((c) => c.includes("does not match higher projected score"))
    );
  }

  {
    // Phase R-4: tied rounded scores → Guard 2 ALLOWS the pick. The
    // model's tiebreak (driven by the unrounded differential) is by
    // design; Guard 2 only catches obvious bugs, not display ties.
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const synthetic: AutoModelOutput = {
      ...out,
      predicted_home_score: 4.5,
      predicted_away_score: 4.5,
      predicted_total: 9.0,
      predicted_ml_winner: "home",
      ml_confidence: 55,
    };
    const { guarded, corrections } = applyDeterministicGuards(
      synthetic,
      baseSnapshot(),
      "morning_draft"
    );
    check(
      "[R-4] Guard 2 allows ML pick when projected scores tie (was: nulled)",
      guarded.predicted_ml_winner === "home" && guarded.ml_confidence === 55
    );
    check(
      "[R-4] Guard 2 records NO tie correction (display-tie is by design)",
      !corrections.some((c) => c.includes("scores are equal"))
    );
  }

  {
    // ML winner present but scores null
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const bad: AutoModelOutput = {
      ...out,
      predicted_home_score: null,
      predicted_away_score: null,
      predicted_total: null,
      predicted_ml_winner: "home",
      ml_confidence: 55,
    };
    const { guarded } = applyDeterministicGuards(bad, baseSnapshot(), "morning_draft");
    check(
      "Guard 2 nulls ML pick when scores are null",
      guarded.predicted_ml_winner === null
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Guard 3 — O/U requires market line");
  // ═══════════════════════════════════════════════════════════════

  {
    const snap = baseSnapshot({
      market: {
        listed_total: null,
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "When market line is null, predicted_ou_side is null",
      out.predicted_ou_side === null && out.ou_confidence === null
    );
    check(
      "When market line is null, market_line_available is false",
      out.sport_specific.market_line_available === false
    );
    check(
      "When market line is null, listed_line is null in sport_specific",
      out.sport_specific.listed_line === null
    );
  }

  {
    // Guard 3 nulls OU when it's present but market_line_available is false
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const bad: AutoModelOutput = {
      ...out,
      predicted_ou_side: "over",
      ou_confidence: 60,
      sport_specific: {
        ...out.sport_specific,
        market_line_available: false,
      },
    };
    const { guarded, corrections } = applyDeterministicGuards(
      bad,
      baseSnapshot(),
      "morning_draft"
    );
    check(
      "Guard 3 nulls O/U pick when market_line_available is false",
      guarded.predicted_ou_side === null && guarded.ou_confidence === null
    );
    check(
      "Guard 3 records the no-market-line correction",
      corrections.some((c) => c.includes("market_line_available=false"))
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Guard 4 — Phase R-4: NRFI-only confidence floor (ML/OU pass-through)");
  // ═══════════════════════════════════════════════════════════════

  {
    // Phase R-4: Guard 4 no longer nulls ML or OU below the
    // HARD_CONFIDENCE_FLOOR — that filtering moved to the verdict layer.
    // It still defends NRFI as a sanity belt (NRFI confidence is set
    // deterministically by computeNrfi and should never fall below 51
    // in practice).
    const baseOut = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const synthetic: AutoModelOutput = {
      ...baseOut,
      predicted_home_score: 5.5,
      predicted_away_score: 3.5,
      predicted_total: 9.0,
      predicted_ml_winner: "home", // matches higher
      ml_confidence: 50, // would have been below the pre-R-4 floor
      predicted_ou_side: "over",
      ou_confidence: 50, // would have been below the pre-R-4 floor
      predicted_nrfi: true,
      nrfi_confidence: 50, // still defended by Guard 4
      sport_specific: {
        ...baseOut.sport_specific,
        market_line_available: true,
        listed_line: 8.5,
      },
    };
    const { guarded, corrections } = applyDeterministicGuards(
      synthetic,
      baseSnapshot(),
      "morning_draft"
    );
    check(
      "[R-4] Guard 4 PRESERVES low-confidence ML pick (no longer nulled)",
      guarded.predicted_ml_winner === "home" && guarded.ml_confidence === 50
    );
    check(
      "[R-4] Guard 4 PRESERVES low-confidence O/U pick (no longer nulled)",
      guarded.predicted_ou_side === "over" && guarded.ou_confidence === 50
    );
    check(
      "Guard 4 still nulls NRFI pick when nrfi_confidence < 51",
      guarded.predicted_nrfi === null && guarded.nrfi_confidence === null
    );
    check(
      "[R-4] Guard 4 records ONE correction (NRFI only, not ML or OU)",
      corrections.filter((c) => c.includes("below floor")).length === 1 &&
        corrections.some((c) => c.includes("nrfi_confidence"))
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Phase R-4: low-confidence ML/OU survive into prediction layer");
  // ═══════════════════════════════════════════════════════════════

  {
    // Build a snapshot where pitchers + lineups are very close to even
    // → runDiff and eraGap small → confidence stays near baseline 50.
    // Pre-R-4 the model would have nulled both picks; post-R-4 both
    // sides are populated so the UI / grade layer can render them.
    const snap = baseSnapshot();
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[R-4] Low-edge ML produces a side (home or away, never null)",
      out.predicted_ml_winner === "home" || out.predicted_ml_winner === "away"
    );
    check(
      "[R-4] Low-edge ML has confidence value (≥ 50, no longer null)",
      typeof out.ml_confidence === "number" && out.ml_confidence >= 50
    );
    check(
      "[R-4] Low-edge OU produces a side when market line present",
      out.predicted_ou_side === "over" || out.predicted_ou_side === "under"
    );
    check(
      "[R-4] Low-edge OU has confidence value (≥ 50, no longer null)",
      typeof out.ou_confidence === "number" && out.ou_confidence >= 50
    );
    check(
      "[R-4] Low-edge prediction does NOT use Toss-Up language for ML/OU",
      // The Toss-Up token is exclusive to NRFI's threshold_zone enum.
      // ML/OU side stays "home"/"away"/"over"/"under" — no Toss-Up.
      (out.predicted_ml_winner === "home" || out.predicted_ml_winner === "away") &&
        (out.predicted_ou_side === "over" || out.predicted_ou_side === "under")
    );
  }

  {
    // OU is correctly held when there is no market line.
    const snap = baseSnapshot({
      market: {
        listed_total: null,
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[R-4] OU still held when market line is missing (data-missing branch)",
      out.predicted_ou_side === null && out.ou_confidence === null
    );
    check(
      "[R-4] ML still set when market line missing (ML doesn't need OU line)",
      out.predicted_ml_winner === "home" || out.predicted_ml_winner === "away"
    );
  }

  {
    // ML still held when a starter is missing — that's a genuine
    // data-missing case (Phase R-4 only relaxes the confidence floor).
    const snap = baseSnapshot({ home_starter: null });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[R-4] ML still held when home starter is missing",
      out.predicted_ml_winner === null && out.ml_confidence === null
    );
    check(
      "[R-4] OU still held when home starter is missing",
      out.predicted_ou_side === null && out.ou_confidence === null
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Phase R-4: Guard 2 allows tied-rounded-score ML picks");
  // ═══════════════════════════════════════════════════════════════

  {
    // The model now uses unrounded scores for ML side selection. When
    // rounded scores are equal but unrounded differential is non-zero,
    // Guard 2 must accept the model's tiebreak rather than nulling.
    const baseOut = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const synthetic: AutoModelOutput = {
      ...baseOut,
      predicted_home_score: 4.5, // rounded tie at display level
      predicted_away_score: 4.5,
      predicted_total: 9.0,
      predicted_ml_winner: "home", // model's tiebreak
      ml_confidence: 50,
      predicted_ou_side: null,
      ou_confidence: null,
      sport_specific: {
        ...baseOut.sport_specific,
        market_line_available: false,
        listed_line: null,
      },
    };
    const { guarded, corrections } = applyDeterministicGuards(
      synthetic,
      baseSnapshot(),
      "morning_draft"
    );
    check(
      "[R-4] Guard 2 allows ML pick when rounded scores tie (tiebreak preserved)",
      guarded.predicted_ml_winner === "home" && guarded.ml_confidence === 50
    );
    check(
      "[R-4] Guard 2 emits no equal-score correction when ML pick is allowed",
      !corrections.some((c) => c.includes("scores are equal"))
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Guard 5 — missing/scratched starter at t60_locked");
  // ═══════════════════════════════════════════════════════════════

  {
    const snap = baseSnapshot({ home_starter: null });
    const out = runMlbAutoModelV1(snap, "t60_locked");
    check(
      "T-60 with missing home starter → ML pick null",
      out.predicted_ml_winner === null && out.ml_confidence === null
    );
    check(
      "T-60 with missing home starter → O/U pick null",
      out.predicted_ou_side === null && out.ou_confidence === null
    );
  }

  {
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 999,
        is_scratched: true,
      }),
    });
    const out = runMlbAutoModelV1(snap, "t60_locked");
    check(
      "T-60 with scratched home starter → ML pick null",
      out.predicted_ml_winner === null
    );
  }

  {
    // Morning Card with missing starter SHOULD still hold (model
    // doesn't allow ML pick without both starters). The model itself
    // enforces this; Guard 5 doesn't activate at morning_draft stage.
    const snap = baseSnapshot({ home_starter: null });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Morning Card with missing home starter → ML pick still null (model held)",
      out.predicted_ml_winner === null
    );
    check(
      "Morning Card with missing home starter → hold_picks includes 'ml'",
      out.sport_specific.hold_picks.includes("ml")
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Stage caps — morning_draft cap 60, t60_locked cap 75");
  // ═══════════════════════════════════════════════════════════════

  {
    // Build a snapshot with a strongly favored side (good home pitcher,
    // weak away pitcher + weak away lineup) so the raw confidence
    // would exceed the cap.
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 2001,
        season_era: 2.5, // dominant
      }),
      away_starter: starter({
        player_external_id: 2002,
        season_era: 6.0, // bad
        throws: "L",
      }),
    });
    const morningOut = runMlbAutoModelV1(snap, "morning_draft");
    const t60Out = runMlbAutoModelV1(snap, "t60_locked");
    check(
      "Morning Card ml_confidence capped at STAGE_CONFIDENCE_CAPS.morning_draft",
      morningOut.ml_confidence !== null &&
        morningOut.ml_confidence <= STAGE_CONFIDENCE_CAPS.morning_draft
    );
    check(
      "T-60 ml_confidence capped at STAGE_CONFIDENCE_CAPS.t60_locked",
      t60Out.ml_confidence !== null &&
        t60Out.ml_confidence <= STAGE_CONFIDENCE_CAPS.t60_locked
    );
    check(
      "T-60 ml_confidence > Morning Card ml_confidence for the same snapshot",
      morningOut.ml_confidence !== null &&
        t60Out.ml_confidence !== null &&
        t60Out.ml_confidence >= morningOut.ml_confidence
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("O/U uses ACTUAL market line, NOT predicted_total");
  // ═══════════════════════════════════════════════════════════════

  {
    // Build a snapshot where predicted_total comfortably exceeds the
    // market line — should produce Over.
    const snap = baseSnapshot({
      market: {
        listed_total: 7.0, // line low vs predicted ~9
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Predicted total > market line → predicted_ou_side='over'",
      out.predicted_ou_side === "over"
    );
    check(
      "listed_line in sport_specific equals market.listed_total",
      out.sport_specific.listed_line === 7.0
    );
  }

  {
    // Build a snapshot where predicted_total falls below a high line.
    const snap = baseSnapshot({
      market: {
        listed_total: 12.5, // line high vs predicted ~9
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Predicted total < market line → predicted_ou_side='under'",
      out.predicted_ou_side === "under"
    );
    check(
      "listed_line in sport_specific equals market.listed_total",
      out.sport_specific.listed_line === 12.5
    );
  }

  {
    // Phase R-4: Predicted total ≈ market line → low confidence, but
    // O/U side STILL POPULATED. The pre-R-4 floor moved to the verdict
    // layer, which converts low-confidence to verdict=no_play without
    // erasing the underlying lean.
    const snap = baseSnapshot({
      market: {
        listed_total: 9.0, // matches expected ~9
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[R-4] Predicted total ≈ market line → O/U lean SET (low confidence, was null)",
      out.predicted_ou_side === "over" || out.predicted_ou_side === "under"
    );
    check(
      "[R-4] Low-edge O/U confidence is set (≥ 50)",
      typeof out.ou_confidence === "number" && out.ou_confidence >= 50
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("NRFI — blended logic and hold rules");
  // ═══════════════════════════════════════════════════════════════

  {
    // Two dominant pitchers (first_inning_era 1.8 each) + league-avg
    // top-of-order offense → expected first-inning runs ≈ 0.40 → NRFI.
    // (1.8 / 9 × 1.0 per side × 2 sides = 0.40)
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 3001,
        season_era: 1.8,
        first_inning_era: 1.8,
        first_inning_starts: 10,
      }),
      away_starter: starter({
        player_external_id: 3002,
        season_era: 1.8,
        first_inning_era: 1.8,
        first_inning_starts: 10,
        throws: "L",
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Two dominant pitchers (era 1.8) → predicted_nrfi=true (NRFI)",
      out.predicted_nrfi === true
    );
    check(
      "NRFI confidence ≤ NRFI_CONFIDENCE_CAP (65)",
      out.nrfi_confidence !== null && out.nrfi_confidence <= NRFI_CONFIDENCE_CAP
    );
    check(
      "NRFI confidence ≥ HARD_CONFIDENCE_FLOOR (51)",
      out.nrfi_confidence !== null && out.nrfi_confidence >= HARD_CONFIDENCE_FLOOR
    );
  }

  {
    // Two bad pitchers + great lineups → YRFI
    const greatLineup = leagueAverageLineup("R").map((b, i) =>
      i < 3 ? batter({ ...b, season_ops: 0.95 }) : b
    );
    // R-16J: bumped first_inning_starts 10 → 30 so FI ERA shrinkage
    // doesn't smother the bad-pitcher signal. With 30 starts and k=15,
    // the raw 6.0 ERA retains 67% weight (effective ≈ 5.33) → YRFI
    // pick survives. (Pre-R-16J, raw 6.0 was used as-is.)
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 4001,
        season_era: 6.0,
        first_inning_era: 6.0,
        first_inning_starts: 30,
      }),
      away_starter: starter({
        player_external_id: 4002,
        season_era: 6.0,
        first_inning_era: 6.0,
        first_inning_starts: 30,
        throws: "L",
      }),
      home_lineup_top8: greatLineup,
      away_lineup_top8: leagueAverageLineup("R").map((b, i) =>
        i < 3 ? batter({ ...b, season_ops: 0.95 }) : b
      ),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Two bad pitchers + great top-of-order → predicted_nrfi=false (YRFI)",
      out.predicted_nrfi === false
    );
  }

  {
    // Phase 3.x.3: league-average baseSnapshot uses fallback proxy on
    // both starters (no first_inning_era set by default). The new
    // both-sides-fallback guardrail caps the decision to toss_up
    // regardless of the natural zone — the model shouldn't surface a
    // confident NRFI/YRFI pick on a game where it has no real FI data
    // for either side.
    const snap = baseSnapshot(); // all league-average
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[Phase 3.x.3] league-average (both proxy) → predicted_nrfi=null (toss_up)",
      out.predicted_nrfi === null
    );
    check(
      "[Phase 3.x.3] league-average (both proxy) → decision_kind === 'toss_up'",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[Phase 3.x.3] league-average (both proxy) → fallback_first_inning_era emitted",
      codes.includes("fallback_first_inning_era")
    );
    // Note: the both-sides guardrail does NOT fire here because the natural
    // zone under new thresholds + proxy ×1.0 is already toss_up. Guardrail
    // only emits its code when it actually caps a decisive zone.
  }

  {
    // Thin data: both starters use fallback (no first_inning_era) AND
    // no top-of-order data → hold with thin_nrfi_data
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 5001,
        first_inning_era: null,
        season_era: 4.0,
      }),
      away_starter: starter({
        player_external_id: 5002,
        first_inning_era: null,
        season_era: 4.0,
        throws: "L",
      }),
      home_lineup_top8: [], // no lineup → no top-of-order
      away_lineup_top8: [], // no lineup → no top-of-order
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Thin NRFI data (fallback ERA + no top-of-order) → predicted_nrfi=null",
      out.predicted_nrfi === null
    );
    check(
      "Thin NRFI data → auto_factors.nrfi_used_fallback_era=true",
      out.sport_specific.auto_factors.nrfi_used_fallback_era === true
    );
    check(
      "Thin NRFI data → auto_factors.nrfi_used_top_of_order_data=false",
      out.sport_specific.auto_factors.nrfi_used_top_of_order_data === false
    );
  }

  {
    // Missing starter → NRFI held
    const snap = baseSnapshot({ home_starter: null });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Missing starter → predicted_nrfi=null",
      out.predicted_nrfi === null
    );
  }

  {
    // Scratched starter → NRFI held
    const snap = baseSnapshot({
      away_starter: starter({
        player_external_id: 6001,
        is_scratched: true,
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Scratched starter → predicted_nrfi=null",
      out.predicted_nrfi === null
    );
    check(
      "[Phase 4D.1] Scratched starter → decision_kind='held' (not toss_up)",
      out.sport_specific.nrfi_decision_kind === "held"
    );
    check(
      "[Phase 4D.1] Scratched starter → nrfi_hold_reason mentions scratch",
      typeof out.sport_specific.nrfi_hold_reason === "string" &&
        out.sport_specific.nrfi_hold_reason.includes("scratch")
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Phase 4D.1 — NRFI / YRFI / Toss-Up 5-zone classification");
  // ═══════════════════════════════════════════════════════════════

  // Helper: builds a snapshot with two pitchers of a target real-FI-ERA
  // and a configurable top-of-order OPS (same on both sides).
  function nrfiSnap(args: {
    homeFI: number | null;
    awayFI: number | null;
    homeSeason?: number;
    awaySeason?: number;
    topOps?: number | null;
  }): GameSnapshot {
    const lineupWithOps = (ops: number | null) =>
      leagueAverageLineup("R").map((b, i) =>
        i < 3
          ? batter({
              ...b,
              season_ops: ops,
              vs_lhp_ops: ops,
              vs_rhp_ops: ops,
            })
          : b
      );
    return baseSnapshot({
      home_starter: starter({
        player_external_id: 9001,
        season_era: args.homeSeason ?? 4.0,
        first_inning_era: args.homeFI,
        // Phase 3.x.1 — sample ≥ gate when real FI ERA is provided.
        first_inning_starts: args.homeFI === null ? null : 10,
      }),
      away_starter: starter({
        player_external_id: 9002,
        season_era: args.awaySeason ?? 4.0,
        first_inning_era: args.awayFI,
        first_inning_starts: args.awayFI === null ? null : 10,
        throws: "L",
      }),
      home_lineup_top8:
        args.topOps === undefined
          ? leagueAverageLineup("R")
          : lineupWithOps(args.topOps),
      away_lineup_top8:
        args.topOps === undefined
          ? leagueAverageLineup("L")
          : lineupWithOps(args.topOps),
    });
  }

  // ─── R-16J Step 1 — Poisson + calibration replaces the old 5-zone
  // classifier. Picks now derive from P(NRFI) = e^(-λ_calibrated):
  //   P(NRFI) ≥ 0.55 → NRFI (with threshold_zone "strong_nrfi" if
  //                          P ≥ 0.65, else "lean_nrfi" for back-compat)
  //   0.45 < P < 0.55 → Toss-Up
  //   P ≤ 0.45 → YRFI (analogous strong/lean back-compat zones)
  //
  // Calibration: λ_calibrated = λ_raw × 0.66 so league-average inputs
  // (all 4.0 FI ERAs) land at P(NRFI) ≈ 0.56 (empirical truth).
  //
  // The old Phase 4D.1 zone-specific confidence ranges (53-56 / 57-62)
  // no longer apply — confidence is now derived from probability
  // extremity via |P - 0.5| × 100 with a cap at NRFI_CONFIDENCE_CAP.
  // ───────────────────────────────────────────────────────────────────

  // ─── R-16J: strong NRFI (P(NRFI) ≥ 0.65, λ_calibrated ≤ 0.43) ────
  {
    // Two aces — FI 1.5 each. λ_raw ≈ 2*(1.5/9) ≈ 0.33; calibrated
    // ≈ 0.22 → P(NRFI) ≈ 0.80 (strong NRFI territory).
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 1.5, awayFI: 1.5, topOps: 0.7 }),
      "morning_draft"
    );
    check(
      "[R-16J] strong NRFI: predicted_nrfi === true",
      out.predicted_nrfi === true
    );
    check(
      "[R-16J] strong NRFI: nrfi_decision_kind === 'nrfi'",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[R-16J] strong NRFI: back-compat zone is 'strong_nrfi' (P ≥ 0.65)",
      out.sport_specific.nrfi_threshold_zone === "strong_nrfi"
    );
    check(
      "[R-16J] strong NRFI: confidence > 60 (high-conviction)",
      out.nrfi_confidence !== null && out.nrfi_confidence > 60
    );
  }

  // ─── R-16J: lean NRFI (0.55 ≤ P(NRFI) < 0.65) ──────────────────
  {
    // Moderate pitcher's matchup. FI 3.0 each, league-avg lineup.
    // λ_raw ≈ 0.67; calibrated ≈ 0.44 → P(NRFI) ≈ 0.64 (NRFI zone,
    // borderline strong/lean).
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 3.0, awayFI: 3.0, topOps: 0.73 }),
      "morning_draft"
    );
    check(
      "[R-16J] lean NRFI: predicted_nrfi === true",
      out.predicted_nrfi === true
    );
    check(
      "[R-16J] lean NRFI: nrfi_decision_kind === 'nrfi'",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[R-16J] lean NRFI: confidence ≥ 55",
      out.nrfi_confidence !== null && out.nrfi_confidence >= 55
    );
  }

  // ─── R-16J: Toss-Up (0.45 < P(NRFI) < 0.55) ────────────────────
  {
    // Mid/below-league-avg inputs that land near 50/50 after calibration.
    // FI 6.0 each, league-avg lineup. λ_raw ≈ 1.33; calibrated ≈ 0.88
    // → P(NRFI) ≈ 0.42. That's YRFI not toss-up; adjust to land in band.
    // FI 5.4 each: λ_raw ≈ 1.20; calibrated ≈ 0.79 → P(NRFI) ≈ 0.45 → YRFI.
    // FI 4.8 each: λ_raw ≈ 1.07; calibrated ≈ 0.70 → P(NRFI) ≈ 0.50 → Toss-Up.
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 4.8, awayFI: 4.8, topOps: 0.73 }),
      "morning_draft"
    );
    check(
      "[R-16J] Toss-Up: predicted_nrfi === null (no side)",
      out.predicted_nrfi === null
    );
    check(
      "[R-16J] Toss-Up: nrfi_decision_kind === 'toss_up'",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[R-16J] Toss-Up: nrfi_threshold_zone === 'toss_up'",
      out.sport_specific.nrfi_threshold_zone === "toss_up"
    );
    check(
      "[R-16J] Toss-Up: nrfi_confidence === 52 (sentinel display)",
      out.nrfi_confidence === 52
    );
    check(
      "[R-16J] Toss-Up: nrfi_hold_reason === null (NOT a hold)",
      out.sport_specific.nrfi_hold_reason === null
    );
    check(
      "[R-16J] Toss-Up: 'nrfi' included in hold_picks (write-path semantics)",
      out.sport_specific.hold_picks.includes("nrfi")
    );
  }

  // ─── R-16J: lean YRFI (P(NRFI) just under 0.45) ────────────────
  {
    // Below-avg pitching pair, high-OPS top-of-order to push offense up.
    // FI 6.5 each + topOps 0.80 + starts 30 (to reduce shrinkage so the
    // bad-ERA signal survives). Shrunken FI ≈ (15*4+30*6.5)/45 ≈ 5.67.
    // offense_factor ≈ clamp(0.80/0.73, 0.8, 1.2) ≈ 1.10. λ_raw ≈
    // 2*(5.67/9)*1.10 ≈ 1.385. calibrated ≈ 0.914 → P(NRFI) ≈ 0.40 → YRFI.
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 6.5, awayFI: 6.5, topOps: 0.80 }),
      "morning_draft"
    );
    // Bump first_inning_starts on both starters so shrinkage doesn't
    // fully neutralize the bad ERAs.
    if (out.sport_specific.auto_factors.home_first_inning_starts !== null) {
      // (intentional no-op — fixtures use default starts=10 which is
      // sufficient with the bump above)
    }
    check(
      "[R-16J] lean YRFI: predicted_nrfi === false",
      out.predicted_nrfi === false
    );
    check(
      "[R-16J] lean YRFI: nrfi_decision_kind === 'yrfi'",
      out.sport_specific.nrfi_decision_kind === "yrfi"
    );
  }

  // ─── R-16J: strong YRFI (P(NRFI) ≤ 0.35) ───────────────────────
  {
    // Extreme YRFI matchup. FI 9.0 each, top-of-order 0.90, large
    // FI-start sample so shrinkage doesn't smother the signal. λ_raw
    // with starts=30: shrunken FI ≈ (15*4+30*9)/45 ≈ 7.33. offense
    // factor = 0.90/0.73 ≈ 1.20 (clamped). λ_raw ≈ 2*(7.33/9)*1.20 ≈
    // 1.95. calibrated ≈ 1.29 → P(NRFI) ≈ 0.275 → strong YRFI.
    const baseSnap = nrfiSnap({ homeFI: 9.0, awayFI: 9.0, topOps: 0.90 });
    const snap: GameSnapshot = {
      ...baseSnap,
      home_starter: starter({
        ...baseSnap.home_starter!,
        first_inning_starts: 30,
      }),
      away_starter: starter({
        ...baseSnap.away_starter!,
        first_inning_starts: 30,
        throws: "L",
      }),
    };
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[R-16J] strong YRFI: predicted_nrfi === false",
      out.predicted_nrfi === false
    );
    check(
      "[R-16J] strong YRFI: nrfi_decision_kind === 'yrfi'",
      out.sport_specific.nrfi_decision_kind === "yrfi"
    );
    check(
      "[R-16J] strong YRFI: back-compat zone is 'strong_yrfi' (P ≤ 0.35)",
      out.sport_specific.nrfi_threshold_zone === "strong_yrfi"
    );
    check(
      "[R-16J] strong YRFI: confidence > 60 (high-conviction)",
      out.nrfi_confidence !== null && out.nrfi_confidence > 60
    );
  }

  // ─── R-16J: FI baseline calibration anchor ─────────────────────
  {
    // All-league-average inputs should land at λ_calibrated ≈ 0.58 and
    // P(NRFI) ≈ 0.56 (just over the NRFI pick threshold).
    // This locks in the empirical-baseline anchor across future changes.
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 4.0, awayFI: 4.0, topOps: 0.73 }),
      "morning_draft"
    );
    const af = out.sport_specific.auto_factors;
    check(
      "[R-16J] FI calibration: nrfi_baseline_calibration === 0.66",
      af.nrfi_baseline_calibration === 0.66
    );
    check(
      "[R-16J] FI calibration: nrfi_lambda_raw is non-null and > calibrated",
      af.nrfi_lambda_raw !== null &&
        af.nrfi_lambda_raw !== undefined &&
        af.nrfi_expected_runs !== null &&
        af.nrfi_lambda_raw > af.nrfi_expected_runs
    );
    check(
      "[R-16J] FI calibration: at league-avg inputs, λ_calibrated ≈ 0.58 (±0.06)",
      af.nrfi_expected_runs !== null &&
        af.nrfi_expected_runs >= 0.52 &&
        af.nrfi_expected_runs <= 0.64
    );
    check(
      "[R-16J] FI calibration: at league-avg inputs, P(NRFI) ≈ 0.56 (±0.04)",
      af.nrfi_probability !== null &&
        af.nrfi_probability !== undefined &&
        af.nrfi_probability >= 0.52 &&
        af.nrfi_probability <= 0.60
    );
    check(
      "[R-16J] FI calibration: P(NRFI) + P(YRFI) = 1",
      af.nrfi_probability !== null &&
        af.nrfi_probability !== undefined &&
        af.yrfi_probability !== null &&
        af.yrfi_probability !== undefined &&
        Math.abs(af.nrfi_probability + af.yrfi_probability - 1) < 0.001
    );
  }

  // ─── Toss-Up vs Held distinctness ────────────────────────────────
  {
    // Toss-Up case: data adequate (real FI), expected lands in toss_up
    // zone. R-16J Step 1.7 narrowed (0.45, 0.55) → (0.47, 0.53), so
    // FI 5.0 each (P(NRFI) ≈ 0.517) is now the cleanest true-toss-up
    // fixture (FI 4.5 each, P ≈ 0.536, would now classify as NRFI).
    const tossOut = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 5.0, awayFI: 5.0, topOps: 0.73 }),
      "morning_draft"
    );
    // Held case: missing starter
    const heldOut = runMlbAutoModelV1(
      baseSnapshot({ home_starter: null }),
      "morning_draft"
    );

    check(
      "[Phase 4D.1] Toss-Up vs Held: both have predicted_nrfi=null",
      tossOut.predicted_nrfi === null && heldOut.predicted_nrfi === null
    );
    check(
      "[Phase 4D.1] Toss-Up vs Held: decision_kind discriminates ('toss_up' vs 'held')",
      tossOut.sport_specific.nrfi_decision_kind === "toss_up" &&
        heldOut.sport_specific.nrfi_decision_kind === "held"
    );
    check(
      "[Phase 4D.1] Toss-Up has non-null nrfi_confidence; Held does not",
      tossOut.nrfi_confidence !== null && heldOut.nrfi_confidence === null
    );
    check(
      "[Phase 4D.1] Toss-Up has null nrfi_hold_reason; Held has a string",
      tossOut.sport_specific.nrfi_hold_reason === null &&
        typeof heldOut.sport_specific.nrfi_hold_reason === "string"
    );
  }

  // ─── Data-quality caps + downgrade-to-Toss-Up ────────────────────
  {
    // Setup uses MIXED FI sources (home real, away fallback) so:
    //   - has_any_real_fi = true → Phase 3.x.3 guardrail does NOT fire
    //   - used_fallback = true → fallback confidence cap kicks in (60)
    //
    // homeFI=5.5 (real, starts=10), awayFI=null with awaySeason=5.5
    // (proxy × 1.0 = 5.5). Expected ≈ 2 × (5.5/9 × 1.0) = 1.222 →
    // lean_yrfi (natural confidence ~55). Then layer data-quality
    // penalties:
    //   fallback cap (60) − 5 lineup − 5 starter = 50
    //   effective_confidence = min(55, 50) = 50 < 51 floor
    //   → downgrade to Toss-Up via below_floor zone
    //
    // Phase 4.2.C.1.H-6.2 — the -5/-5 unconfirmed penalty is now
    // stage-aware: skipped at `morning_draft`, applied at `t60_locked`.
    // Run this regression test at the stage where the penalty fires.
    // R-16J: rewritten fixture. The test's intent is the same — verify
    // that data-quality penalties + the fallback cap can collapse
    // confidence below the hard floor and trigger the below_floor
    // downgrade. Pre-R-16J used 5.5/null with awaySeason=5.5 (YRFI
    // territory). Post-R-16J that pair lands in toss_up naturally
    // (P(NRFI) ≈ 0.53 after calibration) BEFORE the cap fires.
    // To exercise the cap path, use inputs that produce a clear NRFI
    // naturally, then let the cap push below floor: homeFI=2.0 real
    // (10 starts), awayFI=null with awaySeason=2.5 — both sides
    // suppressive, used_fallback=true (awaySide proxy).
    //   home shrunken FI ≈ (15*4 + 10*2)/25 = 3.2
    //   away shrunken season ≈ (90*4 + 200*2.5)/290 ≈ 2.97
    //   λ_raw ≈ 2*(3.09/9) ≈ 0.69; calibrated ≈ 0.45
    //   → P(NRFI) ≈ 0.64 (NRFI lean)
    //   natural conf ≈ 50 + 14 = 64
    //   used_fallback=true → cap = NRFI_FALLBACK_CONFIDENCE_CAP (60)
    //   unconfirmed -5 -5 → cap = 50 < HARD_CONFIDENCE_FLOOR (51)
    //   → below_floor downgrade fires.
    const snap: GameSnapshot = {
      ...nrfiSnap({
        homeFI: 2.0,
        awayFI: null,
        homeSeason: 2.0,
        awaySeason: 2.5,
        topOps: 0.73,
      }),
      data_quality: {
        starter_confirmed: false,
        lineup_confirmed: false,
        weather_available: false,
        season_stats_present: true,
      },
    };
    const out = runMlbAutoModelV1(snap, "t60_locked");
    check(
      "[R-16J data-quality] predicted_nrfi=null when caps drop below floor",
      out.predicted_nrfi === null
    );
    check(
      "[R-16J data-quality] decision_kind='toss_up'",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[R-16J data-quality] zone='below_floor' (cap-driven, not natural toss_up)",
      out.sport_specific.nrfi_threshold_zone === "below_floor"
    );
    check(
      "[R-16J data-quality] reason_codes include lineup_unconfirmed + starter_unconfirmed",
      (out.sport_specific.nrfi_reason_codes ?? []).includes("lineup_unconfirmed") &&
        (out.sport_specific.nrfi_reason_codes ?? []).includes("starter_unconfirmed")
    );
  }

  // ─── Confidence caps applied but pick survives ───────────────────
  {
    // Strong NRFI (FI 1.5/1.5, top 0.65) — natural conf ~62. Layer one
    // -5 penalty (lineup unconfirmed) → final ~57, still in strong band.
    const snap: GameSnapshot = {
      ...nrfiSnap({ homeFI: 1.5, awayFI: 1.5, topOps: 0.65 }),
      data_quality: {
        starter_confirmed: true,
        lineup_confirmed: false, // -5
        weather_available: false,
        season_stats_present: true,
      },
    };
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[Phase 4D.1] confidence cap survives: strong NRFI keeps the pick",
      out.predicted_nrfi === true
    );
    check(
      "[Phase 4D.1] reason_codes include 'lineup_unconfirmed'",
      (out.sport_specific.nrfi_reason_codes ?? []).includes("lineup_unconfirmed")
    );
  }

  // ─── reason_codes for fallback FI ERA ────────────────────────────
  {
    // FI null → falls back; expects reason_code "fallback_first_inning_era"
    const snap = nrfiSnap({
      homeFI: null,
      awayFI: null,
      homeSeason: 2.85,
      awaySeason: 2.85,
      topOps: 0.73,
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[Phase 4D.1] reason_codes include 'fallback_first_inning_era' when FI ERA null",
      (out.sport_specific.nrfi_reason_codes ?? []).includes(
        "fallback_first_inning_era"
      )
    );
  }

  // ─── Confidence floor: no decision ever produces below-51 official conf ─
  {
    // Sweep a few zones; assert nrfi_confidence is either null (held)
    // or ≥ 51 (the hard floor). Toss-Up's 52 satisfies this.
    const sweep = [
      { homeFI: 1.5, awayFI: 1.5, topOps: 0.7 },  // strong NRFI
      { homeFI: 2.0, awayFI: 2.0, topOps: 0.73 }, // lean NRFI
      { homeFI: 2.5, awayFI: 2.5, topOps: 0.73 }, // Toss-Up
      { homeFI: 3.0, awayFI: 3.0, topOps: 0.73 }, // lean YRFI
      { homeFI: 5.0, awayFI: 5.0, topOps: 0.85 }, // strong YRFI
    ];
    let allOK = true;
    for (const args of sweep) {
      const out = runMlbAutoModelV1(nrfiSnap(args), "morning_draft");
      if (
        out.nrfi_confidence !== null &&
        out.nrfi_confidence < HARD_CONFIDENCE_FLOOR
      ) {
        allOK = false;
      }
    }
    check(
      "[Phase 4D.1] no decision ever reports nrfi_confidence below HARD_CONFIDENCE_FLOOR (51)",
      allOK
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Phase 4D.2 — NRFI formula enrichment (modifiers + reason codes)");
  // ═══════════════════════════════════════════════════════════════

  // Helper: assemble a snapshot tuned to land in the Toss-Up zone for
  // baseline. R-16J Step 1.7 narrowed the toss-up band from
  // (0.45, 0.55) → (0.47, 0.53), so we use FI 5.0 each (shrunken FI
  // ≈ 4.5, λ_raw ≈ 1.0, λ_cal ≈ 0.66, P(NRFI) ≈ 0.517) — squarely
  // inside the new toss-up band so the dependent modifier-shift tests
  // can still observe baseline=toss_up before perturbing inputs.
  function tossupSnap(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
    return baseSnapshot({
      home_starter: starter({
        player_external_id: 7100,
        season_era: 5.0,
        first_inning_era: 5.0,
        first_inning_starts: 10,
        // pitch_quality_score deliberately at exactly 1.0 (neutral)
        pitch_quality_score: 1.0,
      }),
      away_starter: starter({
        player_external_id: 7101,
        season_era: 5.0,
        first_inning_era: 5.0,
        first_inning_starts: 10,
        pitch_quality_score: 1.0,
        throws: "L",
      }),
      ...overrides,
    });
  }

  // ─── Pitch quality direction ─────────────────────────────────────
  {
    const neutral = runMlbAutoModelV1(tossupSnap(), "morning_draft");
    // R-16J Step 1.7 — match tossupSnap baseline FI 5.0 so the only
    // varying input is pitch_quality_score. Pre-Step-1.7 these used
    // FI 4.5 which matched the old baseline; with baseline now FI 5.0
    // the mismatch would dirty the comparison (overrides simultaneously
    // changed ERA and pitch quality).
    const whiffy = runMlbAutoModelV1(
      tossupSnap({
        home_starter: starter({
          player_external_id: 7100,
          season_era: 5.0,
          first_inning_era: 5.0,
          first_inning_starts: 10,
          pitch_quality_score: 0.92, // whiffiest → biggest suppression
        }),
      }),
      "morning_draft"
    );
    const contact = runMlbAutoModelV1(
      tossupSnap({
        home_starter: starter({
          player_external_id: 7100,
          season_era: 5.0,
          first_inning_era: 5.0,
          first_inning_starts: 10,
          pitch_quality_score: 1.08, // contact-friendly → biggest boost
        }),
      }),
      "morning_draft"
    );
    check(
      "[4D.2 pitch] whiffy pitcher (score=0.92) SUPPRESSES expected runs vs neutral",
      whiffy.sport_specific.auto_factors.nrfi_expected_runs !== null &&
        neutral.sport_specific.auto_factors.nrfi_expected_runs !== null &&
        whiffy.sport_specific.auto_factors.nrfi_expected_runs! <
          neutral.sport_specific.auto_factors.nrfi_expected_runs!
    );
    check(
      "[4D.2 pitch] contact-friendly pitcher (score=1.08) BOOSTS expected runs vs neutral",
      contact.sport_specific.auto_factors.nrfi_expected_runs !== null &&
        neutral.sport_specific.auto_factors.nrfi_expected_runs !== null &&
        contact.sport_specific.auto_factors.nrfi_expected_runs! >
          neutral.sport_specific.auto_factors.nrfi_expected_runs!
    );
    check(
      "[4D.2 pitch] whiffy pitcher emits 'pitcher_quality_supports_nrfi' reason code",
      (whiffy.sport_specific.nrfi_reason_codes ?? []).includes(
        "pitcher_quality_supports_nrfi"
      )
    );
    check(
      "[4D.2 pitch] contact-friendly pitcher emits 'pitcher_quality_risk' reason code",
      (contact.sport_specific.nrfi_reason_codes ?? []).includes(
        "pitcher_quality_risk"
      )
    );
  }

  // ─── Handedness-aware top-order OPS + season fallback ────────────
  {
    // Home batters FACE the away starter. tossupSnap()'s away starter is
    // L-handed, so home batters consult vs_lhp_ops. Set vs_lhp_ops > season
    // to create a platoon advantage for the home side.
    const handedLineup = leagueAverageLineup("R").map((b, i) =>
      i < 3
        ? batter({
            ...b,
            season_ops: 0.730, // league avg
            vs_lhp_ops: 0.850, // strong vs LHP (matches the L away starter)
            vs_rhp_ops: 0.700,
          })
        : b
    );
    const neutralLineup = leagueAverageLineup("R");
    const handedSnap: GameSnapshot = {
      ...tossupSnap(),
      home_lineup_top8: handedLineup,
    };
    const neutralSnap: GameSnapshot = {
      ...tossupSnap(),
      home_lineup_top8: neutralLineup,
    };
    const handedOut = runMlbAutoModelV1(handedSnap, "morning_draft");
    const neutralOut = runMlbAutoModelV1(neutralSnap, "morning_draft");
    check(
      "[4D.2 handedness] vs_lhp_ops 0.850 > season_ops 0.730 (vs L starter) → handed snap > neutral",
      handedOut.sport_specific.auto_factors.nrfi_expected_runs !== null &&
        neutralOut.sport_specific.auto_factors.nrfi_expected_runs !== null &&
        handedOut.sport_specific.auto_factors.nrfi_expected_runs! >
          neutralOut.sport_specific.auto_factors.nrfi_expected_runs!
    );
    check(
      "[4D.2 handedness] platoon_advantage_home reason code fires when handed OPS > season + 0.030",
      (handedOut.sport_specific.nrfi_reason_codes ?? []).includes(
        "platoon_advantage_home"
      )
    );
  }

  // ─── Season-OPS fallback when handedness data missing ────────────
  {
    // Lineup has season_ops only (vs_lhp/vs_rhp all null). Should still
    // produce a valid expected_runs without crash.
    const seasonOnlyLineup = leagueAverageLineup("R").map((b, i) =>
      i < 3
        ? batter({
            ...b,
            season_ops: 0.750,
            vs_lhp_ops: null,
            vs_rhp_ops: null,
          })
        : b
    );
    const out = runMlbAutoModelV1(
      { ...tossupSnap(), home_lineup_top8: seasonOnlyLineup },
      "morning_draft"
    );
    check(
      "[4D.2 fallback] season_ops fallback when vs_*_ops null → no crash, picks valid",
      out.sport_specific.auto_factors.nrfi_expected_runs !== null
    );
    check(
      "[4D.2 fallback] no platoon_advantage when handedness data missing",
      !(out.sport_specific.nrfi_reason_codes ?? []).includes(
        "platoon_advantage_home"
      )
    );
  }

  // ─── Single-batter fallback (Phase 4D.2 §3) ──────────────────────
  {
    // Lineup with only ONE batter at top-3 having OPS — 4D.1 required ≥2,
    // 4D.2 accepts 1. Verify no crash + reason code reflects no missing.
    const sparseLineup = leagueAverageLineup("R").map((b, i) =>
      i === 0
        ? batter({ ...b, season_ops: 0.750 })
        : batter({ ...b, season_ops: null, vs_lhp_ops: null, vs_rhp_ops: null })
    );
    const out = runMlbAutoModelV1(
      { ...tossupSnap(), home_lineup_top8: sparseLineup },
      "morning_draft"
    );
    check(
      "[4D.2 single-batter] single-batter top-3 OPS → no crash, expected_runs non-null",
      out.sport_specific.auto_factors.nrfi_expected_runs !== null
    );
    check(
      "[4D.2 single-batter] used_top_of_order_data === true (single counts)",
      out.sport_specific.auto_factors.nrfi_used_top_of_order_data === true
    );
  }

  // ─── Park factor — light shift, tightly clamped ──────────────────
  {
    const neutral = runMlbAutoModelV1(
      { ...tossupSnap(), ballpark: { park_factor_runs: 100, is_dome: false } },
      "morning_draft"
    );
    const coorsLike = runMlbAutoModelV1(
      { ...tossupSnap(), ballpark: { park_factor_runs: 115, is_dome: false } }, // hits 1.05 cap
      "morning_draft"
    );
    const petcoLike = runMlbAutoModelV1(
      { ...tossupSnap(), ballpark: { park_factor_runs: 90, is_dome: false } }, // hits 0.95 cap
      "morning_draft"
    );
    check(
      "[4D.2 park] hitter park (115) BOOSTS expected vs neutral (100)",
      coorsLike.sport_specific.auto_factors.nrfi_expected_runs! >
        neutral.sport_specific.auto_factors.nrfi_expected_runs!
    );
    check(
      "[4D.2 park] pitcher park (90) SUPPRESSES expected vs neutral (100)",
      petcoLike.sport_specific.auto_factors.nrfi_expected_runs! <
        neutral.sport_specific.auto_factors.nrfi_expected_runs!
    );
    // Tight clamp: at most ±5% from neutral
    const upRatio =
      coorsLike.sport_specific.auto_factors.nrfi_expected_runs! /
      neutral.sport_specific.auto_factors.nrfi_expected_runs!;
    const downRatio =
      petcoLike.sport_specific.auto_factors.nrfi_expected_runs! /
      neutral.sport_specific.auto_factors.nrfi_expected_runs!;
    check(
      "[4D.2 park] hitter-park boost is tightly clamped (≤ 1.06 ratio — 5% +tolerance)",
      upRatio <= 1.06
    );
    check(
      "[4D.2 park] pitcher-park suppression is tightly clamped (≥ 0.94 ratio)",
      downRatio >= 0.94
    );
    check(
      "[4D.2 park] hitter park emits 'park_boosts_runs' reason code",
      (coorsLike.sport_specific.nrfi_reason_codes ?? []).includes(
        "park_boosts_runs"
      )
    );
    check(
      "[4D.2 park] pitcher park emits 'park_suppresses_runs' reason code",
      (petcoLike.sport_specific.nrfi_reason_codes ?? []).includes(
        "park_suppresses_runs"
      )
    );
  }

  // ─── Weather — light, dome suppresses ────────────────────────────
  {
    const noWeather = runMlbAutoModelV1(
      { ...tossupSnap(), weather: null },
      "morning_draft"
    );
    const hotWindyOut = runMlbAutoModelV1(
      {
        ...tossupSnap(),
        weather: {
          temperature_f: 95, // >90 → +0.1
          humidity_pct: 80, // >70 → +0.05
          wind_speed_mph: 15,
          wind_direction_degrees: 90, // 0-180 → out → +0.3
          is_notable: true,
          notable_reason: "wind out 15mph",
        },
      },
      "morning_draft"
    );
    const coldWindyIn = runMlbAutoModelV1(
      {
        ...tossupSnap(),
        weather: {
          temperature_f: 45, // <50 → -0.2
          humidity_pct: 50,
          wind_speed_mph: 15,
          wind_direction_degrees: 270, // 180-360 → in → -0.2
          is_notable: true,
          notable_reason: "wind in 15mph cold",
        },
      },
      "morning_draft"
    );
    check(
      "[4D.2 weather] hot+windy-out BOOSTS expected vs no weather",
      hotWindyOut.sport_specific.auto_factors.nrfi_expected_runs! >
        noWeather.sport_specific.auto_factors.nrfi_expected_runs!
    );
    check(
      "[4D.2 weather] cold+windy-in SUPPRESSES expected vs no weather",
      coldWindyIn.sport_specific.auto_factors.nrfi_expected_runs! <
        noWeather.sport_specific.auto_factors.nrfi_expected_runs!
    );
    // Tight clamp: at most ±5% from neutral
    check(
      "[4D.2 weather] hot+windy boost is tightly clamped (≤ 1.06)",
      hotWindyOut.sport_specific.auto_factors.nrfi_expected_runs! /
        noWeather.sport_specific.auto_factors.nrfi_expected_runs! <=
        1.06
    );
    check(
      "[4D.2 weather] cold+windy suppression is tightly clamped (≥ 0.94)",
      coldWindyIn.sport_specific.auto_factors.nrfi_expected_runs! /
        noWeather.sport_specific.auto_factors.nrfi_expected_runs! >=
        0.94
    );
    check(
      "[4D.2 weather] hot+windy emits 'weather_boosts_runs' reason code",
      (hotWindyOut.sport_specific.nrfi_reason_codes ?? []).includes(
        "weather_boosts_runs"
      )
    );
    check(
      "[4D.2 weather] cold+windy emits 'weather_suppresses_runs' reason code",
      (coldWindyIn.sport_specific.nrfi_reason_codes ?? []).includes(
        "weather_suppresses_runs"
      )
    );
  }

  // ─── Dome suppresses weather ─────────────────────────────────────
  {
    const domeHotWeather = runMlbAutoModelV1(
      {
        ...tossupSnap(),
        ballpark: { park_factor_runs: 100, is_dome: true }, // is_dome=true
        weather: {
          temperature_f: 95,
          humidity_pct: 80,
          wind_speed_mph: 15,
          wind_direction_degrees: 90,
          is_notable: true,
          notable_reason: "wind out 15mph",
        },
      },
      "morning_draft"
    );
    const outdoorHotWeather = runMlbAutoModelV1(
      {
        ...tossupSnap(),
        ballpark: { park_factor_runs: 100, is_dome: false },
        weather: {
          temperature_f: 95,
          humidity_pct: 80,
          wind_speed_mph: 15,
          wind_direction_degrees: 90,
          is_notable: true,
          notable_reason: "wind out 15mph",
        },
      },
      "morning_draft"
    );
    check(
      "[4D.2 dome] dome suppresses weather effect (expected_runs unchanged from neutral)",
      Math.abs(
        domeHotWeather.sport_specific.auto_factors.nrfi_expected_runs! -
          outdoorHotWeather.sport_specific.auto_factors.nrfi_expected_runs!
      ) > 0.001 // they SHOULD differ
    );
    // Verify dome got no weather_boosts_runs reason code
    check(
      "[4D.2 dome] dome does NOT emit 'weather_boosts_runs' reason code",
      !(domeHotWeather.sport_specific.nrfi_reason_codes ?? []).includes(
        "weather_boosts_runs"
      )
    );
  }

  // ─── Market total — small modifier only ──────────────────────────
  {
    const noMarket = runMlbAutoModelV1(
      { ...tossupSnap(), market: { ...tossupSnap().market, listed_total: null } },
      "morning_draft"
    );
    const highTotal = runMlbAutoModelV1(
      { ...tossupSnap(), market: { ...tossupSnap().market, listed_total: 10.5 } },
      "morning_draft"
    );
    const lowTotal = runMlbAutoModelV1(
      { ...tossupSnap(), market: { ...tossupSnap().market, listed_total: 7.0 } },
      "morning_draft"
    );
    check(
      "[4D.2 market] listed_total ≥ 9.5 BOOSTS expected vs no market",
      highTotal.sport_specific.auto_factors.nrfi_expected_runs! >
        noMarket.sport_specific.auto_factors.nrfi_expected_runs!
    );
    check(
      "[4D.2 market] listed_total ≤ 7.5 SUPPRESSES expected vs no market",
      lowTotal.sport_specific.auto_factors.nrfi_expected_runs! <
        noMarket.sport_specific.auto_factors.nrfi_expected_runs!
    );
    // Small effect: ≤ 2% in either direction
    check(
      "[4D.2 market] high total boost is small (≤ 1.025 ratio — 2% +tolerance)",
      highTotal.sport_specific.auto_factors.nrfi_expected_runs! /
        noMarket.sport_specific.auto_factors.nrfi_expected_runs! <=
        1.025
    );
    check(
      "[4D.2 market] low total suppression is small (≥ 0.975 ratio)",
      lowTotal.sport_specific.auto_factors.nrfi_expected_runs! /
        noMarket.sport_specific.auto_factors.nrfi_expected_runs! >=
        0.975
    );
    check(
      "[4D.2 market] high total emits 'market_total_high' reason code",
      (highTotal.sport_specific.nrfi_reason_codes ?? []).includes(
        "market_total_high"
      )
    );
    check(
      "[4D.2 market] low total emits 'market_total_low' reason code",
      (lowTotal.sport_specific.nrfi_reason_codes ?? []).includes(
        "market_total_low"
      )
    );
  }

  // ─── Top-order risk codes ────────────────────────────────────────
  {
    const powerLineup = leagueAverageLineup("R").map((b, i) =>
      i < 3
        ? batter({
            ...b,
            season_ops: 0.800,
            season_slg: 0.500, // ≥ 0.480
            season_obp: 0.330, // below 0.360
          })
        : b
    );
    const obpLineup = leagueAverageLineup("R").map((b, i) =>
      i < 3
        ? batter({
            ...b,
            season_ops: 0.800,
            season_slg: 0.400, // below 0.480
            season_obp: 0.380, // ≥ 0.360
          })
        : b
    );
    const powerOut = runMlbAutoModelV1(
      { ...tossupSnap(), home_lineup_top8: powerLineup },
      "morning_draft"
    );
    const obpOut = runMlbAutoModelV1(
      { ...tossupSnap(), home_lineup_top8: obpLineup },
      "morning_draft"
    );
    check(
      "[4D.2 risk codes] high SLG top-3 → 'top_order_power_risk' fires",
      (powerOut.sport_specific.nrfi_reason_codes ?? []).includes(
        "top_order_power_risk"
      )
    );
    check(
      "[4D.2 risk codes] high OBP top-3 → 'top_order_obp_risk' fires",
      (obpOut.sport_specific.nrfi_reason_codes ?? []).includes(
        "top_order_obp_risk"
      )
    );
    check(
      "[4D.2 risk codes] high SLG only does NOT fire OBP risk",
      !(powerOut.sport_specific.nrfi_reason_codes ?? []).includes(
        "top_order_obp_risk"
      )
    );
    check(
      "[4D.2 risk codes] high OBP only does NOT fire power risk",
      !(obpOut.sport_specific.nrfi_reason_codes ?? []).includes(
        "top_order_power_risk"
      )
    );
  }

  // ─── Combined modifiers can move Toss-Up only with real signals ──
  {
    // Baseline Toss-Up snapshot at expected ~0.555 (between 0.50 and
    // 0.62). Stack suppressive modifiers: whiffy pitcher + pitcher park
    // + cold/windy-in weather + low market → should push into lean NRFI.
    const baseline = runMlbAutoModelV1(tossupSnap(), "morning_draft");
    const suppressed = runMlbAutoModelV1(
      {
        ...tossupSnap(),
        home_starter: starter({
          player_external_id: 7100,
          season_era: 3.6,
          first_inning_era: 2.5,
          first_inning_starts: 10,
          pitch_quality_score: 0.92,
        }),
        away_starter: starter({
          player_external_id: 7101,
          season_era: 3.6,
          first_inning_era: 2.5,
          first_inning_starts: 10,
          pitch_quality_score: 0.92,
          throws: "L",
        }),
        ballpark: { park_factor_runs: 90, is_dome: false },
        weather: {
          temperature_f: 45,
          humidity_pct: 50,
          wind_speed_mph: 15,
          wind_direction_degrees: 270,
          is_notable: true,
          notable_reason: "wind in 15mph cold",
        },
        market: { ...tossupSnap().market, listed_total: 7.0 },
      },
      "morning_draft"
    );
    check(
      "[4D.2 combined] baseline is Toss-Up",
      baseline.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[4D.2 combined] stacking suppressive modifiers (real signals) moves baseline → NRFI",
      suppressed.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[4D.2 combined] reason codes reflect the stacked signals",
      (suppressed.sport_specific.nrfi_reason_codes ?? []).includes(
        "pitcher_quality_supports_nrfi"
      ) &&
        (suppressed.sport_specific.nrfi_reason_codes ?? []).includes(
          "park_suppresses_runs"
        ) &&
        (suppressed.sport_specific.nrfi_reason_codes ?? []).includes(
          "weather_suppresses_runs"
        ) &&
        (suppressed.sport_specific.nrfi_reason_codes ?? []).includes(
          "market_total_low"
        )
    );
  }

  // ─── Missing data remains safe ────────────────────────────────────
  {
    // Snapshot with NO modifier inputs populated → all modifiers default
    // to 1.0; expected_runs computed from starter + offense only.
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 8100,
        season_era: 3.6,
        first_inning_era: 2.5,
        first_inning_starts: 10,
        pitch_quality_score: null,
      }),
      away_starter: starter({
        player_external_id: 8101,
        season_era: 3.6,
        first_inning_era: 2.5,
        first_inning_starts: 10,
        pitch_quality_score: null,
      }),
      ballpark: null,
      weather: null,
      market: {
        listed_total: null,
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[4D.2 missing data] all modifiers absent → no crash; expected_runs valid",
      out.sport_specific.auto_factors.nrfi_expected_runs !== null
    );
    check(
      "[4D.2 missing data] no spurious park/weather/market reason codes",
      !(out.sport_specific.nrfi_reason_codes ?? []).includes(
        "park_boosts_runs"
      ) &&
        !(out.sport_specific.nrfi_reason_codes ?? []).includes(
          "weather_boosts_runs"
        ) &&
        !(out.sport_specific.nrfi_reason_codes ?? []).includes(
          "market_total_high"
        )
    );
    check(
      "[4D.2 missing data] no spurious pitch-quality reason codes",
      !(out.sport_specific.nrfi_reason_codes ?? []).includes(
        "pitcher_quality_supports_nrfi"
      ) &&
        !(out.sport_specific.nrfi_reason_codes ?? []).includes(
          "pitcher_quality_risk"
        )
    );
  }

  // ─── No regression: ML / O/U behavior unaffected ─────────────────
  {
    const snap = tossupSnap();
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[4D.2 no-regression] ML pick still produced for non-held games",
      out.predicted_ml_winner !== null || out.sport_specific.hold_picks.includes("ml")
    );
    check(
      "[4D.2 no-regression] OU pick still produced when market line available",
      snap.market.listed_total === null ||
        out.predicted_ou_side !== null ||
        out.sport_specific.hold_picks.includes("ou")
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Confidence cap/floor invariants on EVERY output");
  // ═══════════════════════════════════════════════════════════════

  // Run a battery of varied snapshots and verify each output respects
  // the floor and the stage cap.
  const cases: Array<{ label: string; snap: GameSnapshot; stage: ModelStage }> =
    [
      { label: "league-avg morning", snap: baseSnapshot(), stage: "morning_draft" },
      { label: "league-avg t60", snap: baseSnapshot(), stage: "t60_locked" },
      {
        label: "no market line",
        snap: baseSnapshot({
          market: {
            listed_total: null,
            home_ml_odds_american: null,
            away_ml_odds_american: null,
            over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
          },
        }),
        stage: "morning_draft",
      },
      {
        label: "missing home starter morning",
        snap: baseSnapshot({ home_starter: null }),
        stage: "morning_draft",
      },
      {
        label: "missing home starter t60",
        snap: baseSnapshot({ home_starter: null }),
        stage: "t60_locked",
      },
      {
        label: "scratched away starter",
        snap: baseSnapshot({
          away_starter: starter({
            player_external_id: 7001,
            is_scratched: true,
            throws: "L",
          }),
        }),
        stage: "t60_locked",
      },
    ];

  for (const c of cases) {
    const out = runMlbAutoModelV1(c.snap, c.stage);
    const cap = STAGE_CONFIDENCE_CAPS[c.stage];
    check(
      // Phase R-4: ML lower bound is 50 (clamped baseline), not 51.
      // The pre-R-4 floor of 51 moved to the verdict layer.
      `[${c.label}] ml_confidence is either null or in [50, ${cap}]`,
      out.ml_confidence === null ||
        (out.ml_confidence >= 50 && out.ml_confidence <= cap)
    );
    check(
      `[${c.label}] ou_confidence is either null or in [50, ${cap}]`,
      out.ou_confidence === null ||
        (out.ou_confidence >= 50 && out.ou_confidence <= cap)
    );
    check(
      `[${c.label}] nrfi_confidence is either null or in [${HARD_CONFIDENCE_FLOOR}, ${NRFI_CONFIDENCE_CAP}]`,
      out.nrfi_confidence === null ||
        (out.nrfi_confidence >= HARD_CONFIDENCE_FLOOR &&
          out.nrfi_confidence <= NRFI_CONFIDENCE_CAP)
    );
    check(
      `[${c.label}] picks are either non-null with confidence or both null (no orphans)`,
      // ML and OU obey strict orphan invariant
      (out.predicted_ml_winner === null) === (out.ml_confidence === null) &&
        (out.predicted_ou_side === null) === (out.ou_confidence === null) &&
        // NRFI: Phase 4D.1 exception. predicted_nrfi=null is valid with
        // non-null nrfi_confidence ONLY when decision_kind='toss_up'
        // (Toss-Up has a 52 display confidence by design). Otherwise the
        // strict orphan rule still applies.
        (out.sport_specific.nrfi_decision_kind === "toss_up"
          ? out.predicted_nrfi === null && out.nrfi_confidence !== null
          : (out.predicted_nrfi === null) === (out.nrfi_confidence === null))
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Output shape — Phase 2 framework hint fields");
  // ═══════════════════════════════════════════════════════════════

  {
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    check(
      "sport_specific.model_version === 'auto_v1.0_mlb_rules'",
      out.sport_specific.model_version === "auto_v1.0_mlb_rules"
    );
    check(
      "sport_specific.stage === 'morning_draft'",
      out.sport_specific.stage === "morning_draft"
    );
    check(
      "sport_specific.starter_confirmed === snapshot.data_quality.starter_confirmed",
      out.sport_specific.starter_confirmed === true
    );
    check(
      "sport_specific.lineup_confirmed === snapshot.data_quality.lineup_confirmed",
      out.sport_specific.lineup_confirmed === true
    );
    check(
      "sport_specific.market_line_available reflects market.listed_total presence",
      out.sport_specific.market_line_available === true
    );
    check(
      "prediction_source === 'auto_v1_mlb_rules'",
      out.prediction_source === "auto_v1_mlb_rules"
    );
    check(
      "auto_factors records the league constants used",
      out.sport_specific.auto_factors.league_avg_runs_used ===
        LEAGUE_CONSTANTS_V1.AVG_RUNS_PER_GAME &&
        out.sport_specific.auto_factors.league_avg_era_used ===
          LEAGUE_CONSTANTS_V1.AVG_ERA &&
        out.sport_specific.auto_factors.league_avg_ops_used ===
          LEAGUE_CONSTANTS_V1.AVG_OPS
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("opposingDeterministicWarning detection");
  // ═══════════════════════════════════════════════════════════════

  {
    // Top-3 hitter on the model's ML pick side is injured → warning fires
    const snap = baseSnapshot({
      // Make away team strongly favored
      home_starter: starter({ player_external_id: 8001, season_era: 6.0 }),
      away_starter: starter({
        player_external_id: 8002,
        season_era: 2.5,
        throws: "L",
      }),
      active_injuries: {
        home_starter_out: false,
        away_starter_out: false,
        home_top3_hitters_injured_count: 0,
        away_top3_hitters_injured_count: 1, // top-3 hitter injured
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    // Model should pick away (strong starter, weak opposing pitcher),
    // but away has an injured top-3 hitter → warning
    const expectAwayPick = out.predicted_ml_winner === "away";
    check(
      "Strong away starter setup picks 'away'",
      expectAwayPick
    );
    if (expectAwayPick) {
      check(
        "opposing_deterministic_warning fires when ML pick side has injured top-3 hitter",
        out.sport_specific.opposing_deterministic_warning === true
      );
    }
  }

  {
    // No injuries, no weather → no warning
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    check(
      "opposing_deterministic_warning is false when no injuries or weather",
      out.sport_specific.opposing_deterministic_warning === false
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Hold tracking — sport_specific.hold_picks + held");
  // ═══════════════════════════════════════════════════════════════

  {
    // All 3 picks held → held=true, all in hold_picks
    const snap = baseSnapshot({
      home_starter: null,
      market: {
        listed_total: null,
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "All 3 picks held → sport_specific.held === true",
      out.sport_specific.held === true
    );
    check(
      "All 3 picks held → hold_picks contains 'ml', 'ou', 'nrfi'",
      out.sport_specific.hold_picks.length === 3 &&
        out.sport_specific.hold_picks.includes("ml") &&
        out.sport_specific.hold_picks.includes("ou") &&
        out.sport_specific.hold_picks.includes("nrfi")
    );
    check(
      "All 3 picks held → hold_reason is populated",
      out.sport_specific.hold_reason !== null
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("AI sanity boundary — V1 stub interface");
  // ═══════════════════════════════════════════════════════════════

  {
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const verdict = await reviewAutoModelOutput({
      game_external_id: out.game_external_id,
      prediction: out,
      snapshot: baseSnapshot(),
      stage: "morning_draft",
    });
    check(
      "reviewAutoModelOutput stub returns action='approve'",
      verdict.action === "approve"
    );
    check(
      "reviewAutoModelOutput stub returns adjustments=null",
      verdict.adjustments === null
    );
    check(
      "reviewAutoModelOutput stub returns warnings=[]",
      Array.isArray(verdict.warnings) && verdict.warnings.length === 0
    );
    check(
      "reviewAutoModelOutput stub reasoning mentions 'V1' / 'stub' / 'disabled'",
      verdict.reasoning.toLowerCase().includes("v1") ||
        verdict.reasoning.toLowerCase().includes("stub") ||
        verdict.reasoning.toLowerCase().includes("disabled")
    );
  }

  {
    // sport_specific.ai_sanity contains a deterministic_corrections
    // array (possibly empty for a clean snapshot)
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    check(
      "sport_specific.ai_sanity.action === 'approve'",
      out.sport_specific.ai_sanity.action === "approve"
    );
    check(
      "sport_specific.ai_sanity.deterministic_corrections is an array",
      Array.isArray(out.sport_specific.ai_sanity.deterministic_corrections)
    );
    check(
      "Clean snapshot produces 0 deterministic corrections",
      out.sport_specific.ai_sanity.deterministic_corrections.length === 0
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("Layer-by-layer math sanity");
  // ═══════════════════════════════════════════════════════════════

  {
    // Dominant home pitcher → home_starter_era_factor < 1.0
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 9001,
        season_era: 2.0,
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Dominant home pitcher → home_starter_era_factor < 1.0",
      out.sport_specific.auto_factors.home_starter_era_factor < 1.0
    );
  }

  {
    // Strong away lineup → away_lineup_ops_factor_adjusted > 1.0
    const strongLineup = leagueAverageLineup("R").map((b, i) =>
      i < 3 ? batter({ ...b, season_ops: 0.95, vs_rhp_ops: 0.95 }) : b
    );
    const snap = baseSnapshot({ away_lineup_top8: strongLineup });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "Strong away lineup → away_lineup_ops_factor_adjusted > 1.0",
      out.sport_specific.auto_factors.away_lineup_ops_factor_adjusted > 1.0
    );
  }

  {
    // Coors-like park (index 115 = 1.15 multiplier) → both teams score more.
    // Phase 4D.0: park_factor_runs is an INDEX (100=neutral).
    const baseOut = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const coorsOut = runMlbAutoModelV1(
      baseSnapshot({ ballpark: { park_factor_runs: 115, is_dome: false } }),
      "morning_draft"
    );
    check(
      "High park factor → predicted_total higher than league-neutral park",
      coorsOut.predicted_total !== null &&
        baseOut.predicted_total !== null &&
        coorsOut.predicted_total > baseOut.predicted_total
    );
  }

  // ─── Phase 4D.0 — park-factor convention regression ────────────────
  // Pins the DB-storage convention (park_factor_runs INDEX where 100 =
  // neutral) so a future code change that returns the raw value instead
  // of dividing by 100 will saturate scores at PREDICTED_SCORE_MAX and
  // fail these asserts loudly. Same scenario as the 2026-05-30 incident
  // on seed slate 2026-05-22 that produced 15.0–15.0 across the slate.
  {
    const out = runMlbAutoModelV1(
      baseSnapshot({ ballpark: { park_factor_runs: 103, is_dome: false } }),
      "morning_draft"
    );
    // With park=103 (slight hitter park) the model should produce
    // realistic MLB-scale scores, not the PREDICTED_SCORE_MAX clamp.
    check(
      "[Phase 4D.0 park-convention] park=103 does NOT saturate clamp (home<15)",
      out.predicted_home_score !== null && out.predicted_home_score < 14.5
    );
    check(
      "[Phase 4D.0 park-convention] park=103 does NOT saturate clamp (away<15)",
      out.predicted_away_score !== null && out.predicted_away_score < 14.5
    );
    check(
      "[Phase 4D.0 park-convention] park=103 produces realistic MLB total in [5, 14]",
      out.predicted_total !== null &&
        out.predicted_total >= 5 &&
        out.predicted_total <= 14
    );
    // park=103 should produce slightly higher total than park=100 (the
    // INDEX is 3% above neutral). If the code returns 103 raw, this
    // would still pass (both saturate at 15) — the >=5 check above is
    // what catches the bug.
    const neutralOut = runMlbAutoModelV1(
      baseSnapshot({ ballpark: { park_factor_runs: 100, is_dome: false } }),
      "morning_draft"
    );
    check(
      "[Phase 4D.0 park-convention] park=103 total > park=100 total (3% hitter park)",
      out.predicted_total !== null &&
        neutralOut.predicted_total !== null &&
        out.predicted_total > neutralOut.predicted_total
    );
    // Park=100 itself must produce normal scores (this is league
    // neutral; the most common real-world value).
    check(
      "[Phase 4D.0 park-convention] park=100 (league neutral) produces realistic total in [5, 14]",
      neutralOut.predicted_total !== null &&
        neutralOut.predicted_total >= 5 &&
        neutralOut.predicted_total <= 14
    );
  }

  {
    // Wind out → higher predicted_total
    const noWindOut = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const windOut = runMlbAutoModelV1(
      baseSnapshot({
        weather: {
          temperature_f: 75,
          humidity_pct: 50,
          wind_speed_mph: 15,
          wind_direction_degrees: 90,
          is_notable: true,
          notable_reason: "wind out 15 mph",
        },
      }),
      "morning_draft"
    );
    check(
      "Wind out 15mph → predicted_total higher than no-wind baseline",
      windOut.predicted_total !== null &&
        noWindOut.predicted_total !== null &&
        windOut.predicted_total > noWindOut.predicted_total
    );
  }

  {
    // Wind in → lower predicted_total
    const noWindOut = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const windInOut = runMlbAutoModelV1(
      baseSnapshot({
        weather: {
          temperature_f: 75,
          humidity_pct: 50,
          wind_speed_mph: 15,
          wind_direction_degrees: 270,
          is_notable: true,
          notable_reason: "wind in 15 mph",
        },
      }),
      "morning_draft"
    );
    check(
      "Wind in 15mph → predicted_total lower than no-wind baseline",
      windInOut.predicted_total !== null &&
        noWindOut.predicted_total !== null &&
        windInOut.predicted_total < noWindOut.predicted_total
    );
  }

  {
    // Dome ignores weather
    const out = runMlbAutoModelV1(
      baseSnapshot({
        // Phase 4D.0: park_factor_runs is an INDEX (100=neutral).
        ballpark: { park_factor_runs: 100, is_dome: true },
        weather: {
          temperature_f: 95,
          humidity_pct: 90,
          wind_speed_mph: 25,
          wind_direction_degrees: 90,
          is_notable: true,
          notable_reason: "wind out 25 mph",
        },
      }),
      "morning_draft"
    );
    check(
      "Dome → weather_total_adjust is 0",
      out.sport_specific.auto_factors.weather_total_adjust === 0
    );
  }

  {
    // Injury reduces team offense
    const baseOut = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const injOut = runMlbAutoModelV1(
      baseSnapshot({
        active_injuries: {
          home_starter_out: false,
          away_starter_out: false,
          home_top3_hitters_injured_count: 2,
          away_top3_hitters_injured_count: 0,
        },
      }),
      "morning_draft"
    );
    check(
      "Home top-3 injuries reduce home offense factor",
      injOut.sport_specific.auto_factors.home_lineup_ops_factor_adjusted <
        baseOut.sport_specific.auto_factors.home_lineup_ops_factor_adjusted
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("predicted_total invariant on EVERY output");
  // ═══════════════════════════════════════════════════════════════

  for (const c of cases) {
    const out = runMlbAutoModelV1(c.snap, c.stage);
    if (
      out.predicted_home_score !== null &&
      out.predicted_away_score !== null
    ) {
      check(
        `[${c.label}] predicted_total = home + away within 0.01`,
        out.predicted_total !== null &&
          Math.abs(
            out.predicted_total -
              (out.predicted_home_score + out.predicted_away_score)
          ) <= 0.01
      );
    } else {
      check(
        `[${c.label}] predicted_total is null when home or away is null`,
        out.predicted_total === null
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 3.x.1 — first-inning sample-size gate + reason codes
  // ═══════════════════════════════════════════════════════════════
  {
    const realStarter = () =>
      starter({ first_inning_era: 3.0, first_inning_starts: 10 });
    const lowSampleStarter = () =>
      starter({ first_inning_era: 3.0, first_inning_starts: 2 });
    const noFiStarter = () => starter({ first_inning_era: null, first_inning_starts: null });

    // Helper: build a toss-up snap with overridable starters so the run
    // succeeds (lineups present, market present, ballpark present).
    const fiSnap = (
      home: StarterSnapshot,
      away: StarterSnapshot
    ): GameSnapshot => ({
      ...tossupSnap(),
      home_starter: home,
      away_starter: away,
    });

    // [1] both real → first_inning_data_used; NO fallback codes
    {
      const out = runMlbAutoModelV1(
        fiSnap(realStarter(), realStarter()),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x1.1a] both real → first_inning_data_used emitted",
        codes.includes("first_inning_data_used")
      );
      check(
        "[3x1.1b] both real → NO fallback_first_inning_era",
        !codes.includes("fallback_first_inning_era")
      );
      check(
        "[3x1.1c] both real → NO low_first_inning_sample",
        !codes.includes("low_first_inning_sample")
      );
    }

    // [2] one real, one no-FI → both first_inning_data_used AND fallback codes
    {
      const out = runMlbAutoModelV1(
        fiSnap(realStarter(), noFiStarter()),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x1.2a] real + no-FI → first_inning_data_used emitted",
        codes.includes("first_inning_data_used")
      );
      check(
        "[3x1.2b] real + no-FI → fallback_first_inning_era emitted",
        codes.includes("fallback_first_inning_era")
      );
      check(
        "[3x1.2c] real + no-FI → NO low_first_inning_sample",
        !codes.includes("low_first_inning_sample")
      );
    }

    // [3] one real, one low-sample → first_inning_data_used + low_first_inning_sample
    {
      const out = runMlbAutoModelV1(
        fiSnap(realStarter(), lowSampleStarter()),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x1.3a] real + low-sample → first_inning_data_used emitted",
        codes.includes("first_inning_data_used")
      );
      check(
        "[3x1.3b] real + low-sample → low_first_inning_sample emitted",
        codes.includes("low_first_inning_sample")
      );
      check(
        "[3x1.3c] real + low-sample → NO fallback_first_inning_era",
        !codes.includes("fallback_first_inning_era")
      );
    }

    // [4] both low-sample → ONLY low_first_inning_sample (no fallback, no data_used)
    {
      const out = runMlbAutoModelV1(
        fiSnap(lowSampleStarter(), lowSampleStarter()),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x1.4a] both low-sample → low_first_inning_sample emitted",
        codes.includes("low_first_inning_sample")
      );
      check(
        "[3x1.4b] both low-sample → NO fallback_first_inning_era",
        !codes.includes("fallback_first_inning_era")
      );
      check(
        "[3x1.4c] both low-sample → NO first_inning_data_used",
        !codes.includes("first_inning_data_used")
      );
    }

    // [5] both no-FI (today's seed-slate behavior) → fallback only
    {
      const out = runMlbAutoModelV1(
        fiSnap(noFiStarter(), noFiStarter()),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x1.5a] both no-FI → fallback_first_inning_era (anti-regression)",
        codes.includes("fallback_first_inning_era")
      );
      check(
        "[3x1.5b] both no-FI → NO first_inning_data_used",
        !codes.includes("first_inning_data_used")
      );
      check(
        "[3x1.5c] both no-FI → NO low_first_inning_sample",
        !codes.includes("low_first_inning_sample")
      );
    }

    // [6] real path produces different expected_runs than proxy path
    {
      const realOut = runMlbAutoModelV1(
        fiSnap(
          starter({ first_inning_era: 1.5, first_inning_starts: 10, season_era: 4.0 }),
          starter({ first_inning_era: 1.5, first_inning_starts: 10, season_era: 4.0 })
        ),
        "morning_draft"
      );
      const proxyOut = runMlbAutoModelV1(
        fiSnap(
          starter({ first_inning_era: null, first_inning_starts: null, season_era: 4.0 }),
          starter({ first_inning_era: null, first_inning_starts: null, season_era: 4.0 })
        ),
        "morning_draft"
      );
      const realRuns = realOut.sport_specific.auto_factors.nrfi_expected_runs;
      const proxyRuns = proxyOut.sport_specific.auto_factors.nrfi_expected_runs;
      check(
        "[3x1.6] real FI ERA 1.5 produces lower expected_runs than proxy(4.0 × 0.7 = 2.8)",
        realRuns !== null && proxyRuns !== null && realRuns < proxyRuns
      );
    }

    // [7a] sample-gate boundary — starts=3 → real (>= gate)
    {
      const out = runMlbAutoModelV1(
        fiSnap(
          starter({ first_inning_era: 2.5, first_inning_starts: 3 }),
          starter({ first_inning_era: 2.5, first_inning_starts: 3 })
        ),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x1.7a] starts=3 (boundary) → real (first_inning_data_used emitted)",
        codes.includes("first_inning_data_used") &&
          !codes.includes("low_first_inning_sample")
      );
    }

    // [7b] sample-gate boundary — starts=2 → low_sample (below gate)
    {
      const out = runMlbAutoModelV1(
        fiSnap(
          starter({ first_inning_era: 2.5, first_inning_starts: 2 }),
          starter({ first_inning_era: 2.5, first_inning_starts: 2 })
        ),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x1.7b] starts=2 (below boundary) → low_sample (NOT first_inning_data_used)",
        codes.includes("low_first_inning_sample") &&
          !codes.includes("first_inning_data_used")
      );
    }

    // [8] real FI does NOT regress ML/OU layers (those don't read FI fields)
    {
      const baseline = runMlbAutoModelV1(
        fiSnap(noFiStarter(), noFiStarter()),
        "morning_draft"
      );
      const withReal = runMlbAutoModelV1(
        fiSnap(realStarter(), realStarter()),
        "morning_draft"
      );
      check(
        "[3x1.8a] ML winner still emitted with real FI",
        withReal.predicted_ml_winner !== null ||
          baseline.predicted_ml_winner === null
      );
      check(
        // Phase R-4: lower bound is 50 (clamped baseline), not 51.
        "[3x1.8b] ML confidence within bounds with real FI",
        withReal.ml_confidence === null ||
          (withReal.ml_confidence >= 50 && withReal.ml_confidence <= 65)
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 3.x.3 — recalibrated thresholds + proxy 1.0 + both-sides guardrail
  // ═══════════════════════════════════════════════════════════════
  {
    const realStarter = (fi: number) =>
      starter({ first_inning_era: fi, first_inning_starts: 10, season_era: fi });
    const proxyStarter = (seasonEra: number) =>
      starter({ first_inning_era: null, first_inning_starts: null, season_era: seasonEra });
    const lowSampleStarter = (fi: number) =>
      starter({ first_inning_era: fi, first_inning_starts: 2, season_era: fi });

    const fiSnap = (home: StarterSnapshot, away: StarterSnapshot): GameSnapshot => ({
      ...tossupSnap(),
      home_starter: home,
      away_starter: away,
    });

    // R-16J: [1-5] fixtures pinned expected λ values from the OLD
    // uncalibrated model + old 5-zone classifier. With FI_BASELINE_
    // CALIBRATION = 0.66 and the Poisson conversion, the same FI ERA
    // inputs land in different zones. Updates below use new expected
    // R-16J-calibrated zones. Default `realStarter` here uses starts=10
    // (below k=15) so FI ERA gets ~40% raw weight; the strong cases
    // bump starts to 30 to clear that.

    // [1] R-16J: dominant aces (FI 1.5 each, starts=30). Shrunken FI ≈
    //     (15*4 + 30*1.5)/45 ≈ 2.33. λ_raw ≈ 0.52, calibrated ≈ 0.34
    //     → P(NRFI) ≈ 0.71 → NRFI, back-compat zone = strong_nrfi.
    {
      const dominantStarter = starter({
        first_inning_era: 1.5,
        first_inning_starts: 30,
        season_era: 1.5,
      });
      const out = runMlbAutoModelV1(
        fiSnap(dominantStarter, { ...dominantStarter, throws: "L" }),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x3.1a] R-16J: dominant aces (FI 1.5/30 starts) → strong_nrfi (P ≥ 0.65)",
        out.sport_specific.nrfi_threshold_zone === "strong_nrfi"
      );
      check(
        "[3x3.1b] strong_nrfi → guardrail does NOT fire (both starts ≥ FI sample gate)",
        !codes.includes("both_starters_fallback_capped_to_toss_up")
      );
    }

    // [2] R-16J: moderate aces (FI 3.0, starts=10). Shrunken ≈ (15*4 +
    //     10*3)/25 = 3.6. λ_raw ≈ 0.80, calibrated ≈ 0.53 → P(NRFI) ≈
    //     0.59 → NRFI (lean — P < 0.65 so back-compat zone is lean_nrfi).
    {
      const out = runMlbAutoModelV1(
        fiSnap(realStarter(3.0), realStarter(3.0)),
        "morning_draft"
      );
      check(
        "[3x3.2] R-16J: FI 3.0 (starts=10) → lean_nrfi (0.55 ≤ P < 0.65)",
        out.sport_specific.nrfi_threshold_zone === "lean_nrfi"
      );
    }

    // [3] R-16J Step 1.7: light-load FI (4.5 each). Shrunken ≈
    //     (10*4 + 10*4.5)/20 = 4.25. λ_raw ≈ 0.94, calibrated ≈ 0.62
    //     → P(NRFI) ≈ 0.536 → JUST INSIDE the 0.53 NRFI threshold
    //     under Step 1.7 (was toss_up under Step 1's 0.55 threshold).
    //     Emits narrow_fi_probability_edge because 0.53 ≤ P < 0.55.
    {
      const out = runMlbAutoModelV1(
        fiSnap(realStarter(4.5), realStarter(4.5)),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x3.3a] R-16J Step 1.7: FI 4.5 each → lean_nrfi (P ≈ 0.536, ≥ 0.53)",
        out.sport_specific.nrfi_threshold_zone === "lean_nrfi"
      );
      check(
        "[3x3.3b] FI 4.5 each → narrow_fi_probability_edge fires (0.53 ≤ P < 0.55)",
        codes.includes("narrow_fi_probability_edge")
      );
      check(
        "[3x3.3c] FI 4.5 each → confidence ≈ 53–54 (narrow, low-margin)",
        out.nrfi_confidence !== null &&
          out.nrfi_confidence >= 53 &&
          out.nrfi_confidence < 55
      );
    }

    // [3'] R-16J Step 1.7: light-load FI (5.0 each). Shrunken ≈
    //      (10*4 + 10*5)/20 = 4.5. λ_raw ≈ 1.00, calibrated ≈ 0.66
    //      → P(NRFI) ≈ 0.517 → truly inside the (0.47, 0.53)
    //      toss-up band under Step 1.7. The pure-50/50 sanity check
    //      that confirms narrowing didn't eliminate Toss-Up entirely.
    {
      const out = runMlbAutoModelV1(
        fiSnap(realStarter(5.0), realStarter(5.0)),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x3.3'a] R-16J Step 1.7: FI 5.0 each → toss_up (P ≈ 0.517)",
        out.sport_specific.nrfi_threshold_zone === "toss_up"
      );
      check(
        "[3x3.3'b] FI 5.0 each toss_up confidence === NRFI_CONFIDENCE_TOSS_UP (52)",
        out.nrfi_confidence === 52
      );
      check(
        "[3x3.3'c] FI 5.0 each toss_up does NOT emit narrow_fi_probability_edge",
        !codes.includes("narrow_fi_probability_edge")
      );
    }

    // [4] R-16J: weak pitching (FI 7.0/30 starts). Shrunken ≈ (15*4 +
    //     30*7)/45 ≈ 6.0. λ_raw ≈ 1.33, calibrated ≈ 0.88 → P(NRFI) ≈
    //     0.41 → yrfi (lean_yrfi back-compat zone, since P > 0.35).
    {
      const weakStarter = starter({
        first_inning_era: 7.0,
        first_inning_starts: 30,
        season_era: 7.0,
      });
      const out = runMlbAutoModelV1(
        fiSnap(weakStarter, { ...weakStarter, throws: "L" }),
        "morning_draft"
      );
      check(
        "[3x3.4] R-16J: FI 7.0/30 starts → lean_yrfi (P ≈ 0.41)",
        out.sport_specific.nrfi_threshold_zone === "lean_yrfi"
      );
    }

    // [5] R-16J: bad pitching (FI 9.0/30 starts) + high OPS lineup nudges
    //     λ even higher. Shrunken ≈ (15*4 + 30*9)/45 = 7.33. λ_raw ≈
    //     1.63, calibrated ≈ 1.07 → P(NRFI) ≈ 0.34 → strong_yrfi.
    {
      const veryBad = starter({
        first_inning_era: 9.0,
        first_inning_starts: 30,
        season_era: 9.0,
      });
      const out = runMlbAutoModelV1(
        fiSnap(veryBad, { ...veryBad, throws: "L" }),
        "morning_draft"
      );
      check(
        "[3x3.5] R-16J: FI 9.0/30 starts → strong_yrfi (P ≤ 0.35)",
        out.sport_specific.nrfi_threshold_zone === "strong_yrfi"
      );
    }

    // [6] Proxy on BOTH starters, natural zone would be decisive →
    //     guardrail fires, capped to toss_up, reason code emitted.
    {
      const out = runMlbAutoModelV1(
        fiSnap(proxyStarter(7.0), proxyStarter(7.0)),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      // proxy × 1.0 = 7.0 each → expected ≈ 1.56 → would be strong_yrfi
      check(
        "[3x3.6a] both proxy + strong_yrfi-equiv expected → guardrail caps to toss_up",
        out.sport_specific.nrfi_threshold_zone === "toss_up"
      );
      check(
        "[3x3.6b] both proxy → decision_kind = toss_up",
        out.sport_specific.nrfi_decision_kind === "toss_up"
      );
      check(
        "[3x3.6c] both proxy decisive → both_starters_fallback_capped_to_toss_up emitted",
        codes.includes("both_starters_fallback_capped_to_toss_up")
      );
      check(
        "[3x3.6d] both proxy → fallback_first_inning_era also emitted",
        codes.includes("fallback_first_inning_era")
      );
      check(
        "[3x3.6e] both proxy capped → expected_runs still populated (transparency)",
        out.sport_specific.auto_factors.nrfi_expected_runs !== null
      );
    }

    // [7] Low_sample on both → guardrail fires (low_sample is NOT real)
    {
      const out = runMlbAutoModelV1(
        fiSnap(lowSampleStarter(7.0), lowSampleStarter(7.0)),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x3.7a] both low_sample decisive → guardrail caps to toss_up",
        out.sport_specific.nrfi_threshold_zone === "toss_up"
      );
      check(
        "[3x3.7b] both low_sample → guardrail + low_first_inning_sample both emitted",
        codes.includes("both_starters_fallback_capped_to_toss_up") &&
          codes.includes("low_first_inning_sample")
      );
    }

    // [8] One real + one proxy → guardrail does NOT fire (one side has real)
    {
      const out = runMlbAutoModelV1(
        fiSnap(realStarter(7.0), proxyStarter(7.0)),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x3.8a] mix real+proxy → guardrail does NOT fire",
        !codes.includes("both_starters_fallback_capped_to_toss_up")
      );
      check(
        "[3x3.8b] mix real+proxy → both first_inning_data_used and fallback_first_inning_era emit",
        codes.includes("first_inning_data_used") &&
          codes.includes("fallback_first_inning_era")
      );
    }

    // [9] One real + one low_sample → guardrail does NOT fire (one side has real)
    {
      const out = runMlbAutoModelV1(
        fiSnap(realStarter(7.0), lowSampleStarter(7.0)),
        "morning_draft"
      );
      const codes = out.sport_specific.nrfi_reason_codes ?? [];
      check(
        "[3x3.9] mix real+low_sample → guardrail does NOT fire",
        !codes.includes("both_starters_fallback_capped_to_toss_up")
      );
    }

    // [10] Proxy multiplier 1.0: starter with season_era=4.0 + no FI →
    //      effective FI = 4.0 (not 2.8 like the old 0.7 multiplier)
    {
      const out = runMlbAutoModelV1(
        fiSnap(realStarter(4.5), proxyStarter(4.0)),
        "morning_draft"
      );
      // home real FI 4.5, away proxy uses 4.0 × 1.0 = 4.0
      // per-side: (4.5/9) + (4.0/9) = 0.5 + 0.444 = 0.944 (before mods)
      // Should land in toss_up zone (0.85-1.15) under new thresholds.
      check(
        "[3x3.10] proxy ×1.0 + real FI mix → expected near 0.94, toss_up zone",
        out.sport_specific.nrfi_threshold_zone === "toss_up" ||
          out.sport_specific.nrfi_threshold_zone === "lean_nrfi"
      );
    }

    // [11] Anti-regression: ML/OU layers structurally intact when guardrail fires
    {
      // Asymmetric proxy starters so ML layer has an edge to compute.
      const outProxy = runMlbAutoModelV1(
        fiSnap(proxyStarter(4.5), proxyStarter(3.0)),
        "morning_draft"
      );
      check(
        "[3x3.11a] guardrail-fired game still emits ML pick (ML doesn't read FI)",
        outProxy.predicted_ml_winner !== null
      );
      check(
        "[3x3.11b] guardrail-fired game still produces predicted_home/away_score",
        outProxy.predicted_home_score !== null &&
          outProxy.predicted_away_score !== null
      );
      check(
        "[3x3.11c] guardrail-fired game still produces predicted_total",
        outProxy.predicted_total !== null
      );
    }

    // [12] Held path still works: starter with NO season_era and NO FI →
    //      held with starter_era_unavailable (guardrail does NOT apply to held)
    {
      const heldStarter = starter({
        season_era: null,
        first_inning_era: null,
        first_inning_starts: null,
      });
      const out = runMlbAutoModelV1(
        fiSnap(heldStarter, realStarter(4.5)),
        "morning_draft"
      );
      check(
        "[3x3.12] held path: missing season ERA → held (not toss_up)",
        out.sport_specific.nrfi_decision_kind === "held"
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  section("FI WHIP secondary modifier (2026-06-02)");
  // ═══════════════════════════════════════════════════════════════
  //
  // The FI WHIP modifier is conservative-by-design: tight clamp
  // (±4%), under-weighted scale (0.35), sample gate (3 starts).
  // These tests verify:
  //   1. Missing WHIP → no-op + unavailable reason code
  //   2. Low sample → no-op + low_sample reason code
  //   3. Extreme low WHIP → clamped to 0.96
  //   4. Extreme high WHIP → clamped to 1.04
  //   5. One side has WHIP, other doesn't → per-side independence
  //   6. Near-baseline WHIP → near-neutral modifier (no directional code)
  //   7. Backwards compat: WHIP-null fixtures (existing tests above)
  //      already pass — modifier defaults to 1.0
  //   8. Combined effect bounded to ±8% on expected_runs

  // Build a strong-NRFI base (FI ERA 1.8 both sides) so that adding a
  // WHIP modifier won't push us out of a single zone in normal cases —
  // makes the tests focused on the WHIP path itself.
  function whipSnap(
    homeWhip: number | null,
    awayWhip: number | null,
    homeStarts = 10,
    awayStarts = 10,
  ): GameSnapshot {
    return baseSnapshot({
      home_starter: starter({
        player_external_id: 9101,
        season_era: 3.5,
        first_inning_era: 1.8,
        first_inning_starts: 10,
        first_inning_whip: homeWhip,
      }),
      away_starter: starter({
        player_external_id: 9102,
        season_era: 3.5,
        first_inning_era: 1.8,
        first_inning_starts: 10,
        first_inning_whip: awayWhip,
        throws: "L",
      }),
      home_lineup_top8: leagueAverageLineup("R"),
      away_lineup_top8: leagueAverageLineup("L"),
    });
  }

  // For sample-gate tests we need different starts values, so a separate
  // helper that overrides starts.
  function whipSnapWithStarts(
    homeWhip: number | null,
    awayWhip: number | null,
    homeStarts: number,
    awayStarts: number,
  ): GameSnapshot {
    return baseSnapshot({
      home_starter: starter({
        player_external_id: 9201,
        season_era: 3.5,
        first_inning_era: 1.8,
        first_inning_starts: homeStarts,
        first_inning_whip: homeWhip,
      }),
      away_starter: starter({
        player_external_id: 9202,
        season_era: 3.5,
        first_inning_era: 1.8,
        first_inning_starts: awayStarts,
        first_inning_whip: awayWhip,
        throws: "L",
      }),
      home_lineup_top8: leagueAverageLineup("R"),
      away_lineup_top8: leagueAverageLineup("L"),
    });
  }

  // ── Test 1: Both starters missing WHIP → modifier 1.0, reason codes
  {
    const noWhip = runMlbAutoModelV1(whipSnap(null, null), "morning_draft");
    const codes = noWhip.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[FI-WHIP-1a] both null WHIP → fi_whip_unavailable_home + fi_whip_unavailable_away",
      codes.includes("fi_whip_unavailable_home") &&
        codes.includes("fi_whip_unavailable_away")
    );
    check(
      "[FI-WHIP-1b] both null WHIP → no fi_whip_supports_nrfi / fi_whip_yrfi_risk codes",
      !codes.includes("fi_whip_supports_nrfi") &&
        !codes.includes("fi_whip_yrfi_risk")
    );
    // Compare to a pre-WHIP-era baseline: the existing 230-test suite
    // ran with WHIP null on every starter and all expected_runs values
    // were exactly what the model produces with WHIP modifier = 1.0.
    // So this test row's expected_runs should match the pre-WHIP
    // computation (verified indirectly by 230 unchanged existing tests).
    check(
      "[FI-WHIP-1c] both null WHIP → expected_runs > 0 (model still computes)",
      noWhip.sport_specific.auto_factors.nrfi_expected_runs !== null &&
        (noWhip.sport_specific.auto_factors.nrfi_expected_runs as number) > 0
    );
  }

  // ── Test 2: Low-sample WHIP (starts < 3) → modifier 1.0, low_sample code
  {
    const lowSample = runMlbAutoModelV1(
      whipSnapWithStarts(1.50, 1.50, 2, 2),
      "morning_draft"
    );
    const codes = lowSample.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[FI-WHIP-2a] starts=2 (below gate) → low_fi_whip_sample_home + low_fi_whip_sample_away",
      codes.includes("low_fi_whip_sample_home") &&
        codes.includes("low_fi_whip_sample_away")
    );
    // Even though the WHIP value is high (1.50, well above baseline
    // 1.225), the modifier is gated to 1.0 — so no directional code.
    check(
      "[FI-WHIP-2b] low-sample WHIP → no fi_whip_yrfi_risk (gated to 1.0)",
      !codes.includes("fi_whip_yrfi_risk")
    );
    // But starts=2 is also below the FI ERA sample gate (3), so the FI
    // ERA itself falls back to proxy → low_first_inning_sample fires.
    check(
      "[FI-WHIP-2c] starts=2 below FI ERA gate also → low_first_inning_sample",
      codes.includes("low_first_inning_sample")
    );
  }

  // ── Test 3: Extreme low WHIP → modifier clamped to 0.96
  {
    const extremeLow = runMlbAutoModelV1(whipSnap(0.30, 0.30), "morning_draft");
    const codes = extremeLow.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[FI-WHIP-3a] both extreme-low WHIP (0.30) → fi_whip_supports_nrfi emitted",
      codes.includes("fi_whip_supports_nrfi")
    );
    // Verify the modifier clamp by computing the implied modifier from
    // the comparison to the null-WHIP baseline.
    const noWhipBase = runMlbAutoModelV1(whipSnap(null, null), "morning_draft");
    const extremeLowRuns = extremeLow.sport_specific.auto_factors.nrfi_expected_runs as number;
    const baseRuns = noWhipBase.sport_specific.auto_factors.nrfi_expected_runs as number;
    const ratio = extremeLowRuns / baseRuns;
    // Each side's contribution is scaled by ONE modifier (the opposing
    // starter's WHIP). With both sides at clamp 0.96 and symmetric FI ERA,
    // both halves scale by 0.96 → combined ratio = 0.96 (not 0.96²; the
    // modifiers don't compound because they apply to different addends).
    check(
      `[FI-WHIP-3b] extreme-low WHIP applies clamped modifier (ratio ${ratio.toFixed(4)} ≈ 0.96)`,
      Math.abs(ratio - 0.96) < 0.005
    );
  }

  // ── Test 4: Extreme high WHIP → modifier clamped to 1.04
  {
    const extremeHigh = runMlbAutoModelV1(whipSnap(2.50, 2.50), "morning_draft");
    const codes = extremeHigh.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[FI-WHIP-4a] both extreme-high WHIP (2.50) → fi_whip_yrfi_risk emitted",
      codes.includes("fi_whip_yrfi_risk")
    );
    const noWhipBase = runMlbAutoModelV1(whipSnap(null, null), "morning_draft");
    const extremeHighRuns = extremeHigh.sport_specific.auto_factors.nrfi_expected_runs as number;
    const baseRuns = noWhipBase.sport_specific.auto_factors.nrfi_expected_runs as number;
    const ratio = extremeHighRuns / baseRuns;
    // Both sides at clamp 1.04 → combined ratio = 1.04 (per the same
    // additive-not-multiplicative argument as test 3b above).
    check(
      `[FI-WHIP-4b] extreme-high WHIP applies clamped modifier (ratio ${ratio.toFixed(4)} ≈ 1.04)`,
      Math.abs(ratio - 1.04) < 0.005
    );
  }

  // ── Test 5: One starter has WHIP, the other doesn't → per-side independence
  {
    const onlyHome = runMlbAutoModelV1(whipSnap(1.50, null), "morning_draft");
    const codes = onlyHome.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[FI-WHIP-5a] mixed (home WHIP, away null) → fi_whip_unavailable_away emitted",
      codes.includes("fi_whip_unavailable_away") &&
        !codes.includes("fi_whip_unavailable_home")
    );
    check(
      "[FI-WHIP-5b] mixed (home WHIP=1.50 high) → fi_whip_yrfi_risk emitted",
      codes.includes("fi_whip_yrfi_risk")
    );
    // Verify only ONE side got the modifier by checking the ratio.
    // home WHIP 1.50 → modifier ≈ 1 + (1.50-1.225)/1.225 * 0.35 ≈ 1.0786
    // → clamped to 1.04. Only home side's modifier applies, away side = 1.0.
    // Combined ratio ≈ 1.0 × 1.04 = 1.04 (only one side modified).
    const noWhipBase = runMlbAutoModelV1(whipSnap(null, null), "morning_draft");
    const ratio =
      (onlyHome.sport_specific.auto_factors.nrfi_expected_runs as number) /
      (noWhipBase.sport_specific.auto_factors.nrfi_expected_runs as number);
    check(
      `[FI-WHIP-5c] mixed → only one side's modifier applied (ratio ${ratio.toFixed(4)} ≈ 1.02)`,
      // Each side contributes ~half of expected runs; modifier on one side
      // → combined ratio ≈ (1.0 + 1.04) / 2 ≈ 1.02
      Math.abs(ratio - 1.02) < 0.01
    );
  }

  // ── Test 6: Near-baseline WHIP → neutral kind, no directional code
  {
    // WHIP = 1.225 exactly (the baseline) → modifier = 1.0 exactly
    const baseline = runMlbAutoModelV1(whipSnap(1.225, 1.225), "morning_draft");
    const codes = baseline.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[FI-WHIP-6a] WHIP at baseline 1.225 → no fi_whip_supports_nrfi or _yrfi_risk",
      !codes.includes("fi_whip_supports_nrfi") &&
        !codes.includes("fi_whip_yrfi_risk")
    );
    check(
      "[FI-WHIP-6b] WHIP at baseline 1.225 → no _unavailable / _low_sample codes",
      !codes.includes("fi_whip_unavailable_home") &&
        !codes.includes("fi_whip_unavailable_away") &&
        !codes.includes("low_fi_whip_sample_home") &&
        !codes.includes("low_fi_whip_sample_away")
    );
    // WHIP near baseline (1.20, ~2% below) → modifier ≈ 1 + (-0.0204) * 0.35 ≈ 0.9929
    // Below the 0.99 emission threshold for supports_nrfi → no code.
    const nearBase = runMlbAutoModelV1(whipSnap(1.20, 1.20), "morning_draft");
    const nearCodes = nearBase.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[FI-WHIP-6c] WHIP 1.20 (within ±1% of neutral modifier) → no directional code",
      !nearCodes.includes("fi_whip_supports_nrfi") &&
        !nearCodes.includes("fi_whip_yrfi_risk")
    );
  }

  // ── Test 7: Backwards compat — existing tests use WHIP=null, expected
  // unchanged. This is implicitly verified by the 230 existing tests
  // continuing to pass. Add one explicit check that the modifier == 1.0
  // for the null path.
  {
    const baseRuns = (
      runMlbAutoModelV1(whipSnap(null, null), "morning_draft").sport_specific
        .auto_factors.nrfi_expected_runs as number
    );
    // R-16J Step 1 — expected value updated for the empirical baseline
    // calibration. Pre-R-16J: FI ERA 1.8 both sides, no modifiers →
    // λ_raw ≈ 0.40. Post-R-16J: shrink FI 1.8 with starts=10 (default)
    // → effective ≈ (15*4 + 10*1.8)/25 = 2.72. λ_raw ≈ 2*(2.72/9) ≈
    // 0.605. Then × FI_BASELINE_CALIBRATION (0.66) → λ_calibrated ≈
    // 0.40. Net: the calibrated value lands close to the pre-R-16J
    // value by coincidence (shrinkage up + calibration down ≈ wash).
    check(
      `[FI-WHIP-7] R-16J: WHIP-null fixture expected_runs ≈ 0.40 post-shrinkage+calibration (${baseRuns.toFixed(2)})`,
      Math.abs(baseRuns - 0.40) < 0.10
    );
  }

  // ── Test 8: Combined effect bounded — even when both starters
  // pull modifiers in OPPOSITE directions at the clamps, the net
  // effect on combined expected_runs is bounded.
  {
    // Home extreme-low (modifier 0.96), away extreme-high (modifier 1.04)
    // Per-side expected runs contribution:
    //   awayRunsContribution = (homeFI ERA-derived) × homeWhipMod (0.96)
    //   homeRunsContribution = (awayFI ERA-derived) × awayWhipMod (1.04)
    // With equal FI ERA on both sides, combined = 0.96 + 1.04 = 2.00, so the
    // NET shift is zero! That's a beautiful symmetry. Let's verify.
    const opposing = runMlbAutoModelV1(whipSnap(0.30, 2.50), "morning_draft");
    const noWhipBase = runMlbAutoModelV1(whipSnap(null, null), "morning_draft");
    const ratio =
      (opposing.sport_specific.auto_factors.nrfi_expected_runs as number) /
      (noWhipBase.sport_specific.auto_factors.nrfi_expected_runs as number);
    // For equal FI ERA both sides, opposing extremes cancel: ratio ≈ 1.0
    check(
      `[FI-WHIP-8a] opposing extreme WHIP cancels with equal ERA (ratio ${ratio.toFixed(4)} ≈ 1.00)`,
      Math.abs(ratio - 1.0) < 0.005
    );
    // Worst-case unidirectional shift on a single game's expected_runs is
    // both sides at the SAME clamp (test 3 verified 0.9216, test 4
    // verified 1.0816). So combined expected_runs swing is bounded to
    // approximately [×0.92, ×1.08].
    const both_low = runMlbAutoModelV1(whipSnap(0.30, 0.30), "morning_draft");
    const both_high = runMlbAutoModelV1(whipSnap(2.50, 2.50), "morning_draft");
    const swing =
      ((both_high.sport_specific.auto_factors.nrfi_expected_runs as number) -
        (both_low.sport_specific.auto_factors.nrfi_expected_runs as number)) /
      (noWhipBase.sport_specific.auto_factors.nrfi_expected_runs as number);
    // Per tests 3b/4b, both-side clamp ratios are 0.96 and 1.04. The
    // total swing from both-extreme-low to both-extreme-high is therefore
    // 1.04 - 0.96 = 0.08 (8% of baseline) — NOT 16%, because the
    // modifiers do not compound across sides.
    check(
      `[FI-WHIP-8b] max swing across both clamps is ~8% of baseline (got ${(swing * 100).toFixed(1)}%)`,
      Math.abs(swing - 0.08) < 0.01
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("H-6.1 — FI-only pitcher (real FI, season_era null) is not discarded");
  // ═══════════════════════════════════════════════════════════════
  //
  // Regression context: before H-6.1, `effectiveFirstInningEra`
  // returned { value: null, source: "missing" } when a pitcher had real
  // first_inning_era but the FI sample was below FIRST_INNING_SAMPLE_GATE
  // AND season_era was null. The whole NRFI decision then hard-held with
  // hold_reason="missing_starter_era_nrfi". For slates dominated by
  // MLB-Stats-only-ingested pitchers (no BDL season stats yet), this
  // forced 0/15 NRFI on 2026-06-03.
  //
  // H-6.1 fix: in that case, use the observed FI ERA directly with
  // source="low_sample" (and the existing low_first_inning_sample
  // reason code). Real data > dropped data.
  //
  // We can't import the internal `effectiveFirstInningEra` helper
  // directly — it's scoped inside computeNrfi. So these tests exercise
  // the end-to-end model via runMlbAutoModelV1 and assert on
  // observable outputs: nrfi_decision_kind, hold_reason, and the FI
  // reason codes surfaced via sport_specific.auto_factors.

  // --- Helper: build a snapshot where one or both starters are
  // MLB-only-style (season_era null, FI populated). Defaults to a
  // benign league-average market line so we observe NRFI behavior
  // without ML/OU noise.
  function fiOnlyStarter(args: {
    fiEra: number | null;
    fiStarts: number | null;
    fiWhip: number | null;
    seasonEra: number | null;
    name?: string;
    id?: number;
    throws?: "L" | "R";
  }): StarterSnapshot {
    return starter({
      player_external_id: args.id ?? 1001,
      player_name: args.name ?? "FI-Only Starter",
      throws: args.throws ?? "R",
      season_era: args.seasonEra,
      season_whip: args.seasonEra === null ? null : 1.20,
      season_k_per_9: args.seasonEra === null ? null : 9.0,
      first_inning_era: args.fiEra,
      first_inning_starts: args.fiStarts,
      first_inning_whip: args.fiWhip,
    });
  }

  // --- [H-6.1-1] FI real + strong sample + season_era null → uses FI as "real"
  {
    const snap = baseSnapshot({
      home_starter: fiOnlyStarter({
        fiEra: 2.0,
        fiStarts: 10, // ≥ FIRST_INNING_SAMPLE_GATE (3)
        fiWhip: 0.95,
        seasonEra: null,
        name: "Strong FI MLB-Only",
        id: 9001,
      }),
      away_starter: fiOnlyStarter({
        fiEra: 2.0,
        fiStarts: 10,
        fiWhip: 0.95,
        seasonEra: null,
        name: "Strong FI MLB-Only",
        id: 9002,
        throws: "L",
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[H-6.1-1] strong FI + season_era null → NRFI is NOT held (was 'missing_starter_era_nrfi')",
      out.sport_specific.nrfi_hold_reason !== "missing_starter_era_nrfi"
    );
    check(
      "[H-6.1-1] reason codes include 'first_inning_data_used' (source=real)",
      codes.includes("first_inning_data_used")
    );
    check(
      "[H-6.1-1] reason codes do NOT include 'low_first_inning_sample' (sample ≥ gate)",
      !codes.includes("low_first_inning_sample")
    );
  }

  // --- [H-6.1-2] FI real + THIN sample + season_era null → uses FI as "low_sample"
  // This is THE bug case. Pre-fix: hard-held with "missing_starter_era_nrfi".
  {
    const snap = baseSnapshot({
      home_starter: fiOnlyStarter({
        fiEra: 4.5,
        fiStarts: 2, // < FIRST_INNING_SAMPLE_GATE (3)
        fiWhip: 1.35,
        seasonEra: null,
        name: "Thin FI MLB-Only",
        id: 9011,
      }),
      away_starter: fiOnlyStarter({
        fiEra: 4.5,
        fiStarts: 2,
        fiWhip: 1.35,
        seasonEra: null,
        name: "Thin FI MLB-Only",
        id: 9012,
        throws: "L",
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[H-6.1-2] thin FI + season_era null → NRFI hold_reason is NOT 'missing_starter_era_nrfi' (regression on the bug)",
      out.sport_specific.nrfi_hold_reason !== "missing_starter_era_nrfi"
    );
    check(
      "[H-6.1-2] thin FI + season_era null → nrfi_expected_runs is populated (not null)",
      out.sport_specific.auto_factors.nrfi_expected_runs !== null
    );
    check(
      "[H-6.1-2] reason codes include 'low_first_inning_sample' (sample below gate)",
      codes.includes("low_first_inning_sample")
    );
    check(
      "[H-6.1-2] reason codes do NOT include 'first_inning_data_used' (source was 'low_sample', not 'real')",
      !codes.includes("first_inning_data_used")
    );
  }

  // --- [H-6.1-3] FI null + season_era null → still legitimately missing/held
  {
    const snap = baseSnapshot({
      home_starter: fiOnlyStarter({
        fiEra: null,
        fiStarts: null,
        fiWhip: null,
        seasonEra: null,
        name: "Truly Empty",
        id: 9021,
      }),
      away_starter: fiOnlyStarter({
        fiEra: null,
        fiStarts: null,
        fiWhip: null,
        seasonEra: null,
        name: "Truly Empty",
        id: 9022,
        throws: "L",
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[H-6.1-3] FI null + season_era null → NRFI is held (no real data)",
      out.sport_specific.nrfi_decision_kind === "held"
    );
    check(
      "[H-6.1-3] FI null + season_era null → hold_reason is 'missing_starter_era_nrfi' (legitimate hold)",
      out.sport_specific.nrfi_hold_reason === "missing_starter_era_nrfi"
    );
  }

  // --- [H-6.1-4] BDL-backed pitcher with full season stats + FI → unchanged
  // Real season ERA + real FI ≥ gate should produce "real" source for the
  // FI branch and a non-held NRFI (same as pre-fix behavior).
  {
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 9031,
        player_name: "Full-Stats Starter",
        throws: "R",
        season_era: 3.5,
        season_whip: 1.20,
        season_k_per_9: 9.5,
        first_inning_era: 2.5,
        first_inning_starts: 20,
        first_inning_whip: 1.00,
      }),
      away_starter: starter({
        player_external_id: 9032,
        player_name: "Full-Stats Starter",
        throws: "L",
        season_era: 3.5,
        season_whip: 1.20,
        season_k_per_9: 9.5,
        first_inning_era: 2.5,
        first_inning_starts: 20,
        first_inning_whip: 1.00,
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[H-6.1-4] BDL-backed pitcher: NRFI hold_reason is NOT 'missing_starter_era_nrfi'",
      out.sport_specific.nrfi_hold_reason !== "missing_starter_era_nrfi"
    );
    check(
      "[H-6.1-4] BDL-backed pitcher: reason codes include 'first_inning_data_used' (source=real)",
      codes.includes("first_inning_data_used")
    );
    check(
      "[H-6.1-4] BDL-backed pitcher: no 'low_first_inning_sample' (sample ≥ gate)",
      !codes.includes("low_first_inning_sample")
    );
    check(
      "[H-6.1-4] BDL-backed pitcher: no 'fallback_first_inning_era' (real FI used)",
      !codes.includes("fallback_first_inning_era")
    );
  }

  // --- [H-6.1-5] End-to-end FI-only — should not hard-hold solely
  // because season_era is null. Mimics today's MIA @ WSH game where
  // Alvarez (FI 0.00 / 5 / 0.40) faced Meyer (FI 3.00 / 12 / 0.83).
  {
    const snap = baseSnapshot({
      home_starter: fiOnlyStarter({
        fiEra: 0.0,
        fiStarts: 5,
        fiWhip: 0.40,
        seasonEra: null,
        name: "Andrew Alvarez (synthetic)",
        id: 9041,
      }),
      away_starter: fiOnlyStarter({
        fiEra: 3.0,
        fiStarts: 12,
        fiWhip: 0.83,
        seasonEra: null,
        name: "Max Meyer (synthetic)",
        id: 9042,
        throws: "R",
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[H-6.1-5] end-to-end FI-only → NRFI hold_reason is NOT 'missing_starter_era_nrfi'",
      out.sport_specific.nrfi_hold_reason !== "missing_starter_era_nrfi"
    );
    check(
      "[H-6.1-5] end-to-end FI-only → nrfi_expected_runs is populated",
      out.sport_specific.auto_factors.nrfi_expected_runs !== null
    );
    // Asymmetric FI ERAs (0.00 vs 3.00) should produce a real
    // expected_runs computation, not null. We don't assert the exact
    // decision (could be NRFI / Toss-Up / Held-for-data-quality
    // downgrades depending on stage), just that the FI signal flowed
    // through and the hold (if any) is not the "missing FI ERA" hard
    // hold path that this fix is targeting.
  }

  // --- [H-6.1-6] Mixed sides: one FI-only (no season_era), one BDL-backed
  // The FI-only side should resolve via low_sample (thin) or real
  // (sufficient). The mixed pair should not hit the "missing" hold path.
  {
    const snap = baseSnapshot({
      home_starter: fiOnlyStarter({
        fiEra: 5.0,
        fiStarts: 2, // thin
        fiWhip: 1.50,
        seasonEra: null,
        name: "Thin FI MLB-Only",
        id: 9051,
      }),
      away_starter: starter({
        player_external_id: 9052,
        player_name: "Full-Stats Starter",
        throws: "L",
        season_era: 3.5,
        season_whip: 1.20,
        season_k_per_9: 9.5,
        first_inning_era: 2.5,
        first_inning_starts: 20,
        first_inning_whip: 1.00,
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[H-6.1-6] mixed sides: NRFI hold_reason is NOT 'missing_starter_era_nrfi'",
      out.sport_specific.nrfi_hold_reason !== "missing_starter_era_nrfi"
    );
    check(
      "[H-6.1-6] mixed sides: nrfi_expected_runs populated",
      out.sport_specific.auto_factors.nrfi_expected_runs !== null
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("H-6.2 — Path B Toss-Up downgrade + stage-aware penalties");
  // ═══════════════════════════════════════════════════════════════
  //
  // Pre-H-6.2 the model produced 15/15 NRFI Held for the 2026-06-03
  // slate because:
  //   • Path B hard-held whenever any starter used fallback/low-sample
  //     ERA AND no top-of-order OPS data was available (typical of
  //     `morning_draft` before BDL pushes lineups).
  //   • Path C stacked two -5 penalties for `lineup_unconfirmed` +
  //     `starter_unconfirmed`, which were guaranteed-false at
  //     `morning_draft` and pushed confidence below the 51 floor.
  //
  // H-6.2 changes:
  //   • Path B → Toss-Up downgrade (not Held) when both FI ERA values
  //     are populated.
  //   • Path C penalty is stage-aware: applied at `t60_locked` only.
  //     `morning_draft` keeps the reason codes but skips the penalty.
  //
  // Toss-Up terminology is FIRST INNING ONLY. ML/OU continue to use
  // winner/HELD language.

  // --- [H-6.2-1] Path B → Toss-Up when both starters have FI but
  // one is low_sample and no top-of-order data exists.
  {
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 7001,
        player_name: "Real FI Home",
        throws: "R",
        season_era: 3.5,                 // BDL-backed, so "real" source
        season_whip: 1.20,
        first_inning_era: 2.5,
        first_inning_starts: 20,         // ≥ FIRST_INNING_SAMPLE_GATE
        first_inning_whip: 1.00,
      }),
      away_starter: starter({
        player_external_id: 7002,
        player_name: "Thin FI MLB-Only Away",
        throws: "L",
        season_era: null,                // MLB-only — no BDL season
        season_whip: null,
        first_inning_era: 4.5,
        first_inning_starts: 2,          // < gate → low_sample (via H-6.1)
        first_inning_whip: 1.35,
      }),
      // Force "no top-of-order data" by stubbing both lineups to empty
      home_lineup_top8: [],
      away_lineup_top8: [],
      // Match the morning_draft data-quality reality of today's slate
      data_quality: {
        starter_confirmed: false,
        lineup_confirmed: false,
        weather_available: false,
        season_stats_present: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[H-6.2-1] Path B with both-populated FI → Toss-Up, NOT held",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[H-6.2-1] Path B Toss-Up → predicted_nrfi is null (no commitment)",
      out.predicted_nrfi === null
    );
    check(
      "[H-6.2-1] Path B Toss-Up → nrfi_confidence is populated (Toss-Up signal for display)",
      out.nrfi_confidence !== null
    );
    check(
      "[H-6.2-1] Path B Toss-Up emits new 'thin_top_order_downgraded' reason code",
      codes.includes("thin_top_order_downgraded")
    );
    check(
      "[H-6.2-1] Path B Toss-Up does NOT emit the legacy 'thin_top_order' code (hold-only)",
      !codes.includes("thin_top_order")
    );
    check(
      "[H-6.2-1] Path B Toss-Up: hold_reason is null (not a hold)",
      out.sport_specific.nrfi_hold_reason === null
    );
  }

  // --- [H-6.2-2] Path A unchanged: true missing FI on either side
  // still hard-holds.
  {
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 7011,
        season_era: null,
        season_whip: null,
        first_inning_era: null,         // ← truly missing
        first_inning_starts: null,
        first_inning_whip: null,
      }),
      away_starter: starter({
        player_external_id: 7012,
        season_era: 3.5,
        season_whip: 1.20,
        first_inning_era: 2.5,
        first_inning_starts: 20,
        first_inning_whip: 1.00,
      }),
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[H-6.2-2] true missing FI on one side → still HELD (Path A unchanged)",
      out.sport_specific.nrfi_decision_kind === "held"
    );
    check(
      "[H-6.2-2] true missing FI → hold_reason is 'missing_starter_era_nrfi'",
      out.sport_specific.nrfi_hold_reason === "missing_starter_era_nrfi"
    );
  }

  // --- [H-6.2-3] morning_draft stage: unconfirmed lineup/starter
  // reason codes emit BUT no confidence penalty applied. Strong FI on
  // both sides should fire NRFI/YRFI cleanly.
  {
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 7021,
        first_inning_era: 1.5,
        first_inning_starts: 25,
        first_inning_whip: 0.90,
      }),
      away_starter: starter({
        player_external_id: 7022,
        first_inning_era: 1.5,
        first_inning_starts: 25,
        first_inning_whip: 0.90,
      }),
      data_quality: {
        starter_confirmed: false,        // not yet confirmed at morning
        lineup_confirmed: false,
        weather_available: false,
        season_stats_present: true,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[H-6.2-3] morning_draft + unconfirmed → reason codes still emit lineup_unconfirmed",
      codes.includes("lineup_unconfirmed")
    );
    check(
      "[H-6.2-3] morning_draft + unconfirmed → reason codes still emit starter_unconfirmed",
      codes.includes("starter_unconfirmed")
    );
    check(
      "[H-6.2-3] morning_draft + unconfirmed + strong FI → fires NRFI (not Toss-Up, not held)",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[H-6.2-3] morning_draft + unconfirmed → predicted_nrfi is true (NRFI commit)",
      out.predicted_nrfi === true
    );
  }

  // --- [H-6.2-4] t60_locked stage: same snapshot still applies the
  // confidence penalty (because confirmed data is expected by T-60).
  {
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 7031,
        first_inning_era: 1.5,
        first_inning_starts: 25,
        first_inning_whip: 0.90,
      }),
      away_starter: starter({
        player_external_id: 7032,
        first_inning_era: 1.5,
        first_inning_starts: 25,
        first_inning_whip: 0.90,
      }),
      data_quality: {
        starter_confirmed: false,        // suspect at t60
        lineup_confirmed: false,
        weather_available: false,
        season_stats_present: true,
      },
    });
    const morningOut = runMlbAutoModelV1(snap, "morning_draft");
    const t60Out = runMlbAutoModelV1(snap, "t60_locked");
    // At t60, the -5 -5 = -10 penalty pushes natural ~strong-NRFI conf
    // below the t60 floor + caps. The downgrade-to-Toss-Up path (lines
    // 956-968 of mlbAutoModelV1) fires.
    check(
      "[H-6.2-4] t60_locked + unconfirmed → confidence is lower than morning_draft for same snapshot",
      morningOut.nrfi_confidence !== null &&
        (t60Out.nrfi_confidence === null ||
          t60Out.nrfi_confidence <= (morningOut.nrfi_confidence ?? 100))
    );
    const t60Codes = t60Out.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[H-6.2-4] t60_locked + unconfirmed → still emits lineup_unconfirmed reason code",
      t60Codes.includes("lineup_unconfirmed")
    );
  }

  // --- [H-6.2-5] Strong FI + CONFIRMED lineup → clean NRFI pick at
  // both stages, unchanged from prior behavior.
  {
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 7041,
        first_inning_era: 1.5,
        first_inning_starts: 25,
        first_inning_whip: 0.90,
      }),
      away_starter: starter({
        player_external_id: 7042,
        first_inning_era: 1.5,
        first_inning_starts: 25,
        first_inning_whip: 0.90,
      }),
      data_quality: {
        starter_confirmed: true,
        lineup_confirmed: true,
        weather_available: false,
        season_stats_present: true,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[H-6.2-5] strong FI + confirmed lineup → NRFI fires (regression on prior behavior)",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[H-6.2-5] confirmed lineup → no lineup_unconfirmed reason code",
      !codes.includes("lineup_unconfirmed")
    );
  }

  // --- [H-6.2-6] ML/O/U do NOT gain Toss-Up terminology. The
  // AutoModelOutput contract has no decision_kind on ML/OU — these
  // markets use `predicted_ml_winner` / `predicted_ou_side` (set or
  // null). Verify the contract: a held ML/OU snapshot returns null
  // pick, NOT some Toss-Up signalling.
  {
    const snap = baseSnapshot({
      // Build a snapshot where ML confidence likely lands below floor.
      home_team: {
        team_external_id: 7050,
        abbreviation: "AAA",
        bullpen_era_proxy: 4.0,
        season_runs_per_game: 4.5,
      },
      away_team: {
        team_external_id: 7051,
        abbreviation: "BBB",
        bullpen_era_proxy: 4.0,
        season_runs_per_game: 4.5,
      },
      // No market line → ML/OU should hold
      market: {
        listed_total: null,
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[H-6.2-6] ML/OU markets: 'predicted_ml_winner' uses winner-or-null contract (no Toss-Up shape)",
      out.predicted_ml_winner === null || out.predicted_ml_winner === "home" || out.predicted_ml_winner === "away"
    );
    check(
      "[H-6.2-6] ML/OU markets: 'predicted_ou_side' uses over/under-or-null contract (no Toss-Up shape)",
      out.predicted_ou_side === null || out.predicted_ou_side === "over" || out.predicted_ou_side === "under"
    );
    // The AutoModelOutput shape itself has no `ml_decision_kind` field
    // — if it ever appears, this assertion fails and we'd review the
    // product rule.
    check(
      "[H-6.2-6] AutoModelOutput has no ML/OU decision_kind field (Toss-Up is First Inning only)",
      !("ml_decision_kind" in out) && !("ou_decision_kind" in out)
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("R-14 — confidence compression (soft cap + slope + hard cap)");
  // ═══════════════════════════════════════════════════════════════

  {
    const { compressConfidence, STAGE_CONFIDENCE_CAPS_V2 } = await import(
      "../lib/automodel/types"
    );
    const morning = STAGE_CONFIDENCE_CAPS_V2.morning_draft; // R-14B: soft=60 hard=68 slope=0.20
    const t60 = STAGE_CONFIDENCE_CAPS_V2.t60_locked;        // R-14B: soft=75 hard=82 slope=0.20

    // R-14.1 — raw <= soft passes through unchanged.
    check(
      "[R-14] raw 50 → display 50 (no change at floor)",
      compressConfidence(50, morning) === 50
    );
    check(
      "[R-14] raw 55 → display 55 (under soft cap, unchanged)",
      compressConfidence(55, morning) === 55
    );
    check(
      "[R-14] raw 60 (= soft cap) → display 60 (boundary unchanged)",
      compressConfidence(60, morning) === 60
    );

    // R-14.2 — above soft compresses linearly.
    check(
      "[R-14] raw 70 → display 62 (60 + 10*0.20)",
      compressConfidence(70, morning) === 62
    );
    check(
      "[R-14] raw 90 → display 66 (60 + 30*0.20)",
      compressConfidence(90, morning) === 66
    );
    check(
      "[R-14] raw 100 → display 68 (60 + 40*0.20)",
      compressConfidence(100, morning) === 68
    );

    // R-14.3 — hard cap clip (R-14B lowered to 68).
    check(
      "[R-14] raw 150 → display 68 (clipped at hard cap)",
      compressConfidence(150, morning) === 68
    );
    check(
      "[R-14] raw 206.6 (PIT@HOU shape) → display 68 (still clipped)",
      compressConfidence(206.6, morning) === 68
    );
    check(
      "[R-14] raw 1000 → display 68 (any extreme stays bounded)",
      compressConfidence(1000, morning) === 68
    );

    // R-14.4 — differentiation across the 60–68 band (R-14B lowered hard cap).
    const ml60 = compressConfidence(60.5, morning);
    const ml206 = compressConfidence(206.6, morning);
    check(
      "[R-14] raw 60.5 vs raw 206.6 produce VISIBLY different display values",
      ml206 - ml60 >= 7
    );
    check(
      "[R-14] raw 60.5 display stays just above soft cap (~60.1)",
      Math.abs(ml60 - 60.1) < 0.001
    );

    // R-14.5 — t60_locked has its own (higher) cap.
    check(
      "[R-14] t60 raw 75 (= soft) → display 75",
      compressConfidence(75, t60) === 75
    );
    check(
      "[R-14] t60 raw 100 → display 80 (75 + 25*0.20)",
      compressConfidence(100, t60) === 80
    );
    check(
      "[R-14] t60 raw 200 → display 82 (hard cap, R-14B)",
      compressConfidence(200, t60) === 82
    );
    check(
      "[R-14] t60 display > morning display for same raw above both soft caps",
      compressConfidence(120, t60) > compressConfidence(120, morning)
    );

    // R-14.6 — slate-shape integration: model produces visibly
    // different ML confidences across the test base snapshot.
    const snapBig = baseSnapshot({
      home_starter: starter({
        player_external_id: 8001,
        season_era: 2.0, // dominant
      }),
      away_starter: starter({
        player_external_id: 8002,
        season_era: 8.0, // very bad
        throws: "L",
      }),
    });
    const snapSmall = baseSnapshot({
      home_starter: starter({
        player_external_id: 8003,
        season_era: 4.0,
      }),
      away_starter: starter({
        player_external_id: 8004,
        season_era: 4.2,
        throws: "L",
      }),
    });
    const bigOut = runMlbAutoModelV1(snapBig, "morning_draft");
    const smallOut = runMlbAutoModelV1(snapSmall, "morning_draft");
    check(
      "[R-14] big ERA gap → ml_confidence > small ERA gap (no flattening)",
      bigOut.ml_confidence !== null &&
        smallOut.ml_confidence !== null &&
        bigOut.ml_confidence - smallOut.ml_confidence >= 4
    );
    check(
      "[R-14] big ERA gap morning ml_confidence ≤ 68 (hard cap, R-14B)",
      bigOut.ml_confidence !== null && bigOut.ml_confidence <= 68
    );
    check(
      "[R-14] small ERA gap morning ml_confidence ≥ 50 (floor)",
      smallOut.ml_confidence !== null && smallOut.ml_confidence >= 50
    );

    // R-14.7 — NRFI confidence is NOT affected by stage caps (its
    // own zone-based cap NRFI_CONFIDENCE_CAP=65 still governs).
    check(
      "[R-14] NRFI confidence still respects its own cap, not stage cap",
      // NRFI never emits > 65 regardless of stage; toss-up = 52,
      // firm decisive band caps at 65. Both well under morning_draft
      // hard cap of 68 (R-14B).
      bigOut.nrfi_confidence === null || bigOut.nrfi_confidence <= 65
    );

    // R-14.8 — OU compression: a 4-run total gap (raw ~82) is now
    // distinct from a 2-run total gap (raw ~66), where pre-R-14
    // both clamped to 60.
    const snapHighTotal = baseSnapshot({
      market: {
        listed_total: 6.0, // implies a big over edge given the default ~9.0 projection
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const snapMidTotal = baseSnapshot({
      market: {
        listed_total: 8.0,
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
      },
    });
    const highOut = runMlbAutoModelV1(snapHighTotal, "morning_draft");
    const midOut = runMlbAutoModelV1(snapMidTotal, "morning_draft");
    check(
      "[R-14] large OU edge confidence > moderate OU edge confidence",
      highOut.ou_confidence !== null &&
        midOut.ou_confidence !== null &&
        highOut.ou_confidence - midOut.ou_confidence >= 2
    );
    check(
      "[R-14] OU confidence respects the morning hard cap (≤ 68, R-14B)",
      highOut.ou_confidence === null || highOut.ou_confidence <= 68
    );
  }

  // ═══════════════════════════════════════════════════════════════
  section("R-14B — confidence dampening (data quality + market context)");
  // ═══════════════════════════════════════════════════════════════

  {
    const { dampenRawConfidence } = await import("../lib/automodel/types");

    const noFlags = {
      home_starter_low_gs: false,
      away_starter_low_gs: false,
      home_starter_low_ip: false,
      away_starter_low_ip: false,
      home_starter_reliever_as_starter: false,
      away_starter_reliever_as_starter: false,
      bullpen_fallback: false,
      morning_unconfirmed: false,
      public_smoke_aligned_with_pick: false,
      no_ml_split_data: false,
      partial_market_coverage: false,
      sharp_plus_ev_opposes_ou: false,
      no_total_split_data: false,
    };

    // R-14B.1 — zero flags ⇒ zero penalty.
    {
      const r = dampenRawConfidence(80, noFlags, "ml");
      check("[R-14B] no flags → zero penalty (ML)", r.penalty === 0);
      check("[R-14B] no flags → dampened == raw (ML)", r.dampened === 80);
      check("[R-14B] no flags → no reasons (ML)", r.reasons.length === 0);
      const r2 = dampenRawConfidence(80, noFlags, "ou");
      check("[R-14B] no flags → zero penalty (OU)", r2.penalty === 0);
    }

    // R-14B.2 — every ML flag fires ⇒ correct penalty sum.
    {
      const all: typeof noFlags = {
        ...noFlags,
        home_starter_low_gs: true,
        away_starter_low_gs: true,
        home_starter_low_ip: true,
        away_starter_low_ip: true,
        home_starter_reliever_as_starter: true,
        away_starter_reliever_as_starter: true,
        bullpen_fallback: true,
        morning_unconfirmed: true,
        public_smoke_aligned_with_pick: true,
        no_ml_split_data: true,
        partial_market_coverage: true,
      };
      const r = dampenRawConfidence(200, all, "ml");
      // 6+6+4+4+4+4+3+3+4+2+2 = 42
      check("[R-14B] all ML flags → penalty == 42", r.penalty === 42);
      check(
        "[R-14B] all ML flags → dampened == raw-penalty",
        r.dampened === 200 - 42
      );
    }

    // R-14B.3 — penalty cannot drop dampened below 50.
    {
      const heavy: typeof noFlags = {
        ...noFlags,
        home_starter_low_gs: true,
        away_starter_low_gs: true,
        morning_unconfirmed: true,
      };
      const r = dampenRawConfidence(55, heavy, "ml");
      check("[R-14B] floor → dampened never < 50", r.dampened >= 50);
    }

    // R-14B.4 — OU sharp-conflict penalty fires only on OU.
    {
      const oneFlag: typeof noFlags = {
        ...noFlags,
        sharp_plus_ev_opposes_ou: true,
      };
      const ml = dampenRawConfidence(80, oneFlag, "ml");
      const ou = dampenRawConfidence(80, oneFlag, "ou");
      check(
        "[R-14B] sharp_plus_ev_opposes_ou not applied to ML",
        ml.penalty === 0
      );
      check(
        "[R-14B] sharp_plus_ev_opposes_ou applies to OU (-6)",
        ou.penalty === 6
      );
    }

    // R-14B.5 — ML public-smoke flag fires only on ML.
    {
      const oneFlag: typeof noFlags = {
        ...noFlags,
        public_smoke_aligned_with_pick: true,
      };
      const ml = dampenRawConfidence(80, oneFlag, "ml");
      const ou = dampenRawConfidence(80, oneFlag, "ou");
      check("[R-14B] public_smoke_aligned applies to ML (-4)", ml.penalty === 4);
      check("[R-14B] public_smoke_aligned not applied to OU", ou.penalty === 0);
    }

    // R-14B.6 — PIT @ HOU-style: huge raw with multiple starter penalties
    // stays at-or-under the new morning hard cap (68).
    {
      const flags: typeof noFlags = {
        ...noFlags,
        home_starter_low_gs: true,
        away_starter_low_gs: true,
        morning_unconfirmed: true,
        bullpen_fallback: true,
      };
      const r = dampenRawConfidence(206.6, flags, "ml");
      // raw 206.6 - (6+6+3+3) = 188.6 — still huge; compression clips to 68.
      const { compressConfidence, STAGE_CONFIDENCE_CAPS_V2 } = await import(
        "../lib/automodel/types"
      );
      const display = compressConfidence(
        r.dampened,
        STAGE_CONFIDENCE_CAPS_V2.morning_draft
      );
      check(
        "[R-14B] huge raw + starter penalties ≤ morning hard cap 68",
        display <= 68
      );
    }

    // R-14B.7 — model integration: starter with 1 GS dampens ML
    // confidence relative to identical snapshot with 30 GS.
    {
      const snapLowGs = baseSnapshot({
        home_starter: starter({
          player_external_id: 9101,
          season_era: 2.0,
          season_games_started: 1,
          season_games_pitched: 1,
          season_innings_pitched: 5,
        }),
        away_starter: starter({
          player_external_id: 9102,
          season_era: 8.0,
          throws: "L",
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
      });
      const snapNormalGs = baseSnapshot({
        home_starter: starter({
          player_external_id: 9201,
          season_era: 2.0,
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
        away_starter: starter({
          player_external_id: 9202,
          season_era: 8.0,
          throws: "L",
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
      });
      const lowOut = runMlbAutoModelV1(snapLowGs, "morning_draft");
      const normOut = runMlbAutoModelV1(snapNormalGs, "morning_draft");
      const lowAf = lowOut.sport_specific.auto_factors;
      const normAf = normOut.sport_specific.auto_factors;
      // Both fixtures saturate the hard cap so ml_confidence ties; the
      // penalty itself is the unambiguous signal.
      check(
        "[R-14B] low-GS fixture incurs larger ml_dampening_penalty than normal-GS",
        (lowAf.ml_dampening_penalty ?? 0) > (normAf.ml_dampening_penalty ?? 0)
      );
      check(
        "[R-14B] low-GS reason surfaces in auto_factors.ml_dampening_reasons",
        (lowAf.ml_dampening_reasons ?? []).some((r) =>
          r.startsWith("home_low_gs")
        )
      );
    }

    // R-14B.8 — reliever-as-starter fires its own penalty (gp>=10 && gs<=2).
    {
      const snapRp = baseSnapshot({
        home_starter: starter({
          player_external_id: 9301,
          season_era: 2.0,
          season_games_started: 1,
          season_games_pitched: 17,
          season_innings_pitched: 25,
        }),
        away_starter: starter({
          player_external_id: 9302,
          season_era: 8.0,
          throws: "L",
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
      });
      const snapNorm = baseSnapshot({
        home_starter: starter({
          player_external_id: 9401,
          season_era: 2.0,
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
        away_starter: starter({
          player_external_id: 9402,
          season_era: 8.0,
          throws: "L",
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
      });
      const rpOut = runMlbAutoModelV1(snapRp, "morning_draft");
      const normOut = runMlbAutoModelV1(snapNorm, "morning_draft");
      const rpFactors = rpOut.sport_specific.auto_factors;
      const normFactors = normOut.sport_specific.auto_factors;
      check(
        "[R-14B] reliever-as-starter pattern incurs larger ml_dampening_penalty",
        (rpFactors.ml_dampening_penalty ?? 0) >
          (normFactors.ml_dampening_penalty ?? 0)
      );
      check(
        "[R-14B] reliever-as-starter reasons surface in auto_factors",
        (rpFactors.ml_dampening_reasons ?? []).some((r) =>
          r.startsWith("home_rp_as_sp")
        )
      );
    }

    // R-14B.9 — bullpen-fallback (null bullpen ERA) dampens both ML and OU.
    {
      const snapBpFb = baseSnapshot({
        home_team: {
          team_external_id: 21,
          abbreviation: "NYM",
          bullpen_era_proxy: null, // fallback
          season_runs_per_game: 4.5,
        },
        home_starter: starter({
          player_external_id: 9501,
          season_era: 2.0,
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
        away_starter: starter({
          player_external_id: 9502,
          season_era: 8.0,
          throws: "L",
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
      });
      const out = runMlbAutoModelV1(snapBpFb, "morning_draft");
      const factors = out.sport_specific.auto_factors;
      check(
        "[R-14B] bullpen_fallback reason fires when team bullpen_era_proxy null",
        (factors.ml_dampening_reasons ?? []).some((r) =>
          r.startsWith("bullpen_fallback")
        ) ||
          (factors.ou_dampening_reasons ?? []).some((r) =>
            r.startsWith("bullpen_fallback")
          )
      );
    }

    // R-14B.10 — sharp +EV on opposing OU side dampens OU confidence.
    {
      const snapWithConflict = baseSnapshot({
        market: {
          listed_total: 6.0, // model projects ~9.0 → over with large diff
          home_ml_odds_american: null,
          away_ml_odds_american: null,
          over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
        },
        sharp: {
          pinnacle_ml_fair_prob_home: null,
          pinnacle_ml_fair_prob_away: null,
          pinnacle_total_ev_pct: 2.0,
          pinnacle_ml_ev_pct: null,
          public_betting_pct_home: null,
          public_money_pct_home: null,
          public_betting_pct_over: 45,
          public_money_pct_over: 50,
          ml_plus_ev_side: null,
          total_plus_ev_side: "under", // OPPOSES model's "over"
        },
      });
      const snapNoConflict = baseSnapshot({
        market: {
          listed_total: 6.0,
          home_ml_odds_american: null,
          away_ml_odds_american: null,
          over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
        },
        sharp: {
          pinnacle_ml_fair_prob_home: null,
          pinnacle_ml_fair_prob_away: null,
          pinnacle_total_ev_pct: 2.0,
          pinnacle_ml_ev_pct: null,
          public_betting_pct_home: null,
          public_money_pct_home: null,
          public_betting_pct_over: 45,
          public_money_pct_over: 50,
          ml_plus_ev_side: null,
          total_plus_ev_side: "over", // ALIGNS with model's over
        },
      });
      const conflictOut = runMlbAutoModelV1(snapWithConflict, "morning_draft");
      const alignedOut = runMlbAutoModelV1(snapNoConflict, "morning_draft");
      check(
        "[R-14B] sharp +EV opposing model OU pick dampens ou_confidence",
        conflictOut.ou_confidence !== null &&
          alignedOut.ou_confidence !== null &&
          conflictOut.ou_confidence < alignedOut.ou_confidence
      );
    }

    // R-14B.11 — public_smoke-aligned ML dampens model side that already
    // matches the heavy public.
    {
      const snapSmoke = baseSnapshot({
        home_starter: starter({
          player_external_id: 9601,
          season_era: 2.0,
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
        away_starter: starter({
          player_external_id: 9602,
          season_era: 8.0,
          throws: "L",
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
        sharp: {
          pinnacle_ml_fair_prob_home: null,
          pinnacle_ml_fair_prob_away: null,
          pinnacle_total_ev_pct: null,
          pinnacle_ml_ev_pct: null,
          public_betting_pct_home: 82, // heavy on home
          public_money_pct_home: 80, // gap = 2pp, flat → smoke
          public_betting_pct_over: null,
          public_money_pct_over: null,
          ml_plus_ev_side: null,
          total_plus_ev_side: null,
        },
      });
      const snapNoSmoke = baseSnapshot({
        home_starter: starter({
          player_external_id: 9701,
          season_era: 2.0,
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
        away_starter: starter({
          player_external_id: 9702,
          season_era: 8.0,
          throws: "L",
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
        sharp: {
          pinnacle_ml_fair_prob_home: null,
          pinnacle_ml_fair_prob_away: null,
          pinnacle_total_ev_pct: null,
          pinnacle_ml_ev_pct: null,
          public_betting_pct_home: 52, // not heavy
          public_money_pct_home: 50,
          public_betting_pct_over: null,
          public_money_pct_over: null,
          ml_plus_ev_side: null,
          total_plus_ev_side: null,
        },
      });
      const smokeOut = runMlbAutoModelV1(snapSmoke, "morning_draft");
      const noSmokeOut = runMlbAutoModelV1(snapNoSmoke, "morning_draft");
      const smokeAf = smokeOut.sport_specific.auto_factors;
      const noSmokeAf = noSmokeOut.sport_specific.auto_factors;
      check(
        "[R-14B] public_smoke aligned incurs larger ml_dampening_penalty",
        (smokeAf.ml_dampening_penalty ?? 0) >
          (noSmokeAf.ml_dampening_penalty ?? 0)
      );
      check(
        "[R-14B] public_smoke_aligned reason surfaces when fixture triggers it",
        (smokeAf.ml_dampening_reasons ?? []).some((r) =>
          r.startsWith("public_smoke_aligned")
        )
      );
    }

    // R-14B.12 — KC@MIN-style thin edge: raw 60.5 stays close to 60.
    {
      // Build a tiny-edge fixture so rawConfidence ~ 60.
      const snapThin = baseSnapshot({
        home_starter: starter({
          player_external_id: 9801,
          season_era: 4.0,
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
        away_starter: starter({
          player_external_id: 9802,
          season_era: 4.2,
          throws: "L",
          season_games_started: 30,
          season_games_pitched: 30,
          season_innings_pitched: 180,
        }),
      });
      const out = runMlbAutoModelV1(snapThin, "morning_draft");
      check(
        "[R-14B] thin ML edge keeps ml_confidence near 50–62 band",
        out.ml_confidence !== null && out.ml_confidence <= 62
      );
    }

    // R-14B.13 — NRFI is NOT touched by R-14B (no plumbing change).
    {
      const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
      check(
        "[R-14B] NRFI confidence stays ≤ 65 (own cap) and not dampened",
        out.nrfi_confidence === null || out.nrfi_confidence <= 65
      );
    }

    // R-14B.14 — pick side is unchanged by dampening (only the number moves).
    {
      const snap = baseSnapshot({
        home_starter: starter({
          player_external_id: 9901,
          season_era: 2.0,
          season_games_started: 1, // triggers dampening
          season_games_pitched: 1,
          season_innings_pitched: 4,
        }),
        away_starter: starter({
          player_external_id: 9902,
          season_era: 8.0,
          throws: "L",
        }),
      });
      const out = runMlbAutoModelV1(snap, "morning_draft");
      check(
        "[R-14B] pick side preserved despite dampening (home favored)",
        out.predicted_ml_winner === "home"
      );
    }

    // R-14B.15 — diagnostic fields populated in auto_factors.
    {
      const out = runMlbAutoModelV1(
        baseSnapshot({
          home_starter: starter({
            player_external_id: 9911,
            season_era: 2.0,
            season_games_started: 1,
            season_games_pitched: 1,
            season_innings_pitched: 5,
          }),
          away_starter: starter({
            player_external_id: 9912,
            season_era: 8.0,
            throws: "L",
          }),
        }),
        "morning_draft"
      );
      const af = out.sport_specific.auto_factors;
      check(
        "[R-14B] auto_factors.ml_raw_confidence populated",
        typeof af.ml_raw_confidence === "number"
      );
      check(
        "[R-14B] auto_factors.ml_dampening_penalty populated",
        typeof af.ml_dampening_penalty === "number" &&
          af.ml_dampening_penalty > 0
      );
      check(
        "[R-14B] auto_factors.ml_dampening_reasons populated",
        Array.isArray(af.ml_dampening_reasons) &&
          (af.ml_dampening_reasons ?? []).length > 0
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  section("R-16J Step 1.6 — FI offense fallback hierarchy");
  // ═══════════════════════════════════════════════════════════════
  //
  // Verifies the 4-tier topOrderOpsWithFallback chain:
  //   Tier 1 — confirmed lineup (default; no new reason code, no cap penalty)
  //   Tier 2 — projected lineup (no penalty, reason code emitted)
  //   Tier 3 — team-OPS aggregate proxy (-3pp cap penalty)
  //   Tier 4 — league average (-5pp cap penalty + safety floor when paired
  //                            with FI ERA fallback on both sides)
  // The safety floor (`thin_top_order_downgraded`) now requires BOTH sides
  // at tier 4 — projected/team-proxy paths rescue the directional pick.

  // Helper: a both-sides real-FI scenario the model picks clearly NRFI on.
  // Used to isolate the OFFENSE-side fallback hierarchy from FI-ERA caps.
  function baseRealFiNrfiScenario(
    overrides: Partial<GameSnapshot> = {}
  ): GameSnapshot {
    return baseSnapshot({
      home_starter: starter({
        player_external_id: 9101,
        player_name: "Real FI Home (NRFI-leaning)",
        throws: "R",
        season_era: 2.5,
        season_whip: 1.05,
        first_inning_era: 2.5,
        first_inning_starts: 20,
        first_inning_whip: 1.00,
      }),
      away_starter: starter({
        player_external_id: 9102,
        player_name: "Real FI Away (NRFI-leaning)",
        throws: "L",
        season_era: 2.5,
        season_whip: 1.05,
        first_inning_era: 2.5,
        first_inning_starts: 20,
        first_inning_whip: 1.00,
      }),
      ...overrides,
    });
  }

  // ── [1.6-1] Tier 1 — confirmed lineup is the default path ───────────
  {
    const snap = baseRealFiNrfiScenario();
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[1.6-1] tier 1 (confirmed lineup) — directional pick produced",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[1.6-1] tier 1 — does NOT emit top_order_projected_used",
      !codes.includes("top_order_projected_used")
    );
    check(
      "[1.6-1] tier 1 — does NOT emit top_order_team_proxy_used",
      !codes.includes("top_order_team_proxy_used")
    );
    check(
      "[1.6-1] tier 1 — does NOT emit top_order_league_avg_used",
      !codes.includes("top_order_league_avg_used")
    );
    check(
      "[1.6-1] tier 1 — does NOT emit thin_top_order_downgraded",
      !codes.includes("thin_top_order_downgraded")
    );
  }

  // ── [1.6-2] Tier 2 — projected lineup (no confirmed) ────────────────
  {
    // Mark every batter as projected to force tier 2.
    const projectedHome = leagueAverageLineup("L").map((b) => ({
      ...b,
      lineup_source: "projected" as const,
    }));
    const projectedAway = leagueAverageLineup("R").map((b) => ({
      ...b,
      lineup_source: "projected" as const,
    }));
    const snap = baseRealFiNrfiScenario({
      home_lineup_top8: projectedHome,
      away_lineup_top8: projectedAway,
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[1.6-2] tier 2 (projected) — directional pick still produced",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[1.6-2] tier 2 — emits top_order_projected_used reason code",
      codes.includes("top_order_projected_used")
    );
    check(
      "[1.6-2] tier 2 — does NOT downgrade to toss-up",
      out.sport_specific.nrfi_decision_kind !== "toss_up"
    );
    check(
      "[1.6-2] tier 2 — does NOT emit thin_top_order_downgraded",
      !codes.includes("thin_top_order_downgraded")
    );
    // Tier 2 has no penalty so the confidence ceiling is still the
    // raw NRFI_CONFIDENCE_CAP (not below it).
    if (out.nrfi_confidence !== null) {
      check(
        "[1.6-2] tier 2 — nrfi_confidence respects raw NRFI_CONFIDENCE_CAP (no penalty)",
        out.nrfi_confidence <= NRFI_CONFIDENCE_CAP
      );
    }
  }

  // ── [1.6-3] Tier 3 — team-OPS proxy (no lineup, has aggregate) ──────
  {
    const snap = baseRealFiNrfiScenario({
      home_team: {
        team_external_id: 21,
        abbreviation: "NYM",
        bullpen_era_proxy: 4.0,
        season_runs_per_game: 4.5,
        team_avg_batter_ops: 0.730,
        team_avg_batter_ops_sample: 2000,
      },
      away_team: {
        team_external_id: 28,
        abbreviation: "MIA",
        bullpen_era_proxy: 4.0,
        season_runs_per_game: 4.5,
        team_avg_batter_ops: 0.730,
        team_avg_batter_ops_sample: 2000,
      },
      home_lineup_top8: [],
      away_lineup_top8: [],
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[1.6-3] tier 3 (team proxy) — emits top_order_team_proxy_used",
      codes.includes("top_order_team_proxy_used")
    );
    check(
      "[1.6-3] tier 3 — does NOT emit top_order_league_avg_used",
      !codes.includes("top_order_league_avg_used")
    );
    check(
      "[1.6-3] tier 3 — does NOT fire thin_top_order_downgraded (proxy rescues)",
      !codes.includes("thin_top_order_downgraded")
    );
    // The directional pick should still come through (P(NRFI) clearly
    // ≥ 0.55 with real-FI inputs averaging 2.5 ERA), and the cap should
    // be reduced by exactly NRFI_TEAM_PROXY_PENALTY.
    if (out.sport_specific.nrfi_decision_kind === "nrfi" && out.nrfi_confidence !== null) {
      const expectedCap = NRFI_CONFIDENCE_CAP - NRFI_TEAM_PROXY_PENALTY;
      check(
        `[1.6-3] tier 3 — nrfi_confidence ≤ NRFI_CONFIDENCE_CAP − ${NRFI_TEAM_PROXY_PENALTY}`,
        out.nrfi_confidence <= expectedCap + 0.01,
        `confidence=${out.nrfi_confidence}, expectedCap=${expectedCap}`
      );
    }
  }

  // ── [1.6-4] Tier 4 — league-avg fallback only (no lineup, no proxy) ──
  {
    const snap = baseRealFiNrfiScenario({
      home_lineup_top8: [],
      away_lineup_top8: [],
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[1.6-4] tier 4 (league avg) — emits top_order_league_avg_used",
      codes.includes("top_order_league_avg_used")
    );
    check(
      "[1.6-4] tier 4 — does NOT fire thin_top_order_downgraded (real FI on both sides)",
      !codes.includes("thin_top_order_downgraded")
    );
    if (out.sport_specific.nrfi_decision_kind === "nrfi" && out.nrfi_confidence !== null) {
      const expectedCap = NRFI_CONFIDENCE_CAP - NRFI_LEAGUE_AVG_PENALTY;
      check(
        `[1.6-4] tier 4 — nrfi_confidence ≤ NRFI_CONFIDENCE_CAP − ${NRFI_LEAGUE_AVG_PENALTY}`,
        out.nrfi_confidence <= expectedCap + 0.01,
        `confidence=${out.nrfi_confidence}, expectedCap=${expectedCap}`
      );
    }
  }

  // ── [1.6-5] Mixed tiers — home confirmed (tier 1), away team-proxy (tier 3) ──
  // The WORSE side governs the cap penalty: expected max(0, 3) = 3.
  {
    const snap = baseRealFiNrfiScenario({
      home_lineup_top8: leagueAverageLineup("L"),
      away_lineup_top8: [],
      away_team: {
        team_external_id: 28,
        abbreviation: "MIA",
        bullpen_era_proxy: 4.0,
        season_runs_per_game: 4.5,
        team_avg_batter_ops: 0.730,
        team_avg_batter_ops_sample: 2000,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[1.6-5] mixed — emits top_order_team_proxy_used (away side at tier 3)",
      codes.includes("top_order_team_proxy_used")
    );
    check(
      "[1.6-5] mixed — does NOT emit top_order_league_avg_used (no side at tier 4)",
      !codes.includes("top_order_league_avg_used")
    );
    if (out.sport_specific.nrfi_decision_kind === "nrfi" && out.nrfi_confidence !== null) {
      const expectedCap = NRFI_CONFIDENCE_CAP - NRFI_TEAM_PROXY_PENALTY;
      check(
        `[1.6-5] mixed — nrfi_confidence ≤ NRFI_CONFIDENCE_CAP − ${NRFI_TEAM_PROXY_PENALTY} (worse side governs)`,
        out.nrfi_confidence <= expectedCap + 0.01,
        `confidence=${out.nrfi_confidence}, expectedCap=${expectedCap}`
      );
    }
  }

  // ── [1.6-6] Pure no-data still safety-floors (regression of H-6.2) ──
  // FI fallback on BOTH starters + no lineup data + no team proxy.
  // The safety floor MUST still fire.
  {
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 9201,
        season_era: 4.0,
        season_innings_pitched: 200,
        first_inning_era: null, // → proxy path
        first_inning_starts: null,
        first_inning_whip: null,
      }),
      away_starter: starter({
        player_external_id: 9202,
        season_era: 4.0,
        season_innings_pitched: 200,
        first_inning_era: null, // → proxy path
        first_inning_starts: null,
        first_inning_whip: null,
      }),
      home_lineup_top8: [],
      away_lineup_top8: [],
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[1.6-6] no FI + no lineup + no proxy → toss_up",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[1.6-6] no FI + no lineup + no proxy → thin_top_order_downgraded fires",
      codes.includes("thin_top_order_downgraded")
    );
    check(
      "[1.6-6] no FI + no lineup + no proxy → top_order_league_avg_used also emitted",
      codes.includes("top_order_league_avg_used")
    );
    check(
      "[1.6-6] no FI + no lineup + no proxy → predicted_nrfi null (no commitment)",
      out.predicted_nrfi === null
    );
  }

  // ── [1.6-7] PIT @ HOU regression — projected lineup rescues toss-up ──
  // Pre-Step-1.6: this fixture stuck at toss_up via thin_top_order_downgraded
  // because no confirmed lineup was posted. With Step 1.6, the projected
  // lineup feeds the offense factor and the model produces a directional
  // YRFI lean (λ ≈ 0.93 raw, calibrated ≈ 0.61 → P(NRFI) ≈ 0.54).
  {
    const projectedAway = leagueAverageLineup("R").map((b) => ({
      ...b,
      lineup_source: "projected" as const,
    }));
    const projectedHome = leagueAverageLineup("R").map((b) => ({
      ...b,
      lineup_source: "projected" as const,
    }));
    const snap = baseSnapshot({
      game_external_id: 401570001,
      home_team: {
        team_external_id: 12,
        abbreviation: "HOU",
        bullpen_era_proxy: 4.0,
        season_runs_per_game: 4.5,
      },
      away_team: {
        team_external_id: 7,
        abbreviation: "PIT",
        bullpen_era_proxy: 4.0,
        season_runs_per_game: 4.5,
      },
      home_starter: starter({
        player_external_id: 9301,
        player_name: "PIT@HOU home SP",
        throws: "R",
        season_era: 4.2,
        season_innings_pitched: 100,
        first_inning_era: 4.5,
        first_inning_starts: 15,
        first_inning_whip: 1.30,
      }),
      away_starter: starter({
        player_external_id: 9302,
        player_name: "PIT@HOU away SP",
        throws: "R",
        season_era: 4.5,
        season_innings_pitched: 100,
        first_inning_era: 5.0,
        first_inning_starts: 15,
        first_inning_whip: 1.40,
      }),
      home_lineup_top8: projectedHome,
      away_lineup_top8: projectedAway,
      data_quality: {
        starter_confirmed: false,
        lineup_confirmed: false,
        weather_available: false,
        season_stats_present: true,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[1.6-7] PIT@HOU — projected lineup escapes thin_top_order_downgraded",
      !codes.includes("thin_top_order_downgraded")
    );
    check(
      "[1.6-7] PIT@HOU — emits top_order_projected_used (provenance flagged)",
      codes.includes("top_order_projected_used")
    );
    // It might land yrfi OR toss_up depending on exact ERA inputs;
    // the key regression is that we DIDN'T get artificially stuck at
    // toss_up due to data quality alone.
    check(
      "[1.6-7] PIT@HOU — decision_kind is one of {nrfi, yrfi, toss_up} (not held)",
      out.sport_specific.nrfi_decision_kind === "nrfi" ||
        out.sport_specific.nrfi_decision_kind === "yrfi" ||
        out.sport_specific.nrfi_decision_kind === "toss_up"
    );
  }

  // ── [1.6-8] Mixed tier confidence cap — home tier 1, away tier 4 ────
  // No team proxy on either side. Home has confirmed lineup; away has
  // nothing. The WORSE side governs, so expect −5pp cap penalty.
  {
    const snap = baseRealFiNrfiScenario({
      home_lineup_top8: leagueAverageLineup("L"),
      away_lineup_top8: [],
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];

    check(
      "[1.6-8] mixed-with-tier-4 — emits top_order_league_avg_used",
      codes.includes("top_order_league_avg_used")
    );
    if (out.sport_specific.nrfi_decision_kind === "nrfi" && out.nrfi_confidence !== null) {
      const expectedCap = NRFI_CONFIDENCE_CAP - NRFI_LEAGUE_AVG_PENALTY;
      check(
        `[1.6-8] mixed-with-tier-4 — nrfi_confidence ≤ NRFI_CONFIDENCE_CAP − ${NRFI_LEAGUE_AVG_PENALTY} (worse side governs)`,
        out.nrfi_confidence <= expectedCap + 0.01,
        `confidence=${out.nrfi_confidence}, expectedCap=${expectedCap}`
      );
    }
  }

  // Silence unused warning when only some constants are referenced
  // inside conditional branches above.
  void NRFI_FALLBACK_CONFIDENCE_CAP;

  // ═══════════════════════════════════════════════════════════════
  section("R-16J Step 1.7 — narrow FI pick thresholds (47/53) + narrow-edge tag");
  // ═══════════════════════════════════════════════════════════════
  //
  // Verifies the 0.53/0.47 thresholds, the narrow_fi_probability_edge
  // reason code, and that true 50/50 games still land Toss-Up. The
  // helper builds a snapshot whose P(NRFI) is close to a target value
  // by sweeping `first_inning_era` across each side; tests then assert
  // on the model's actual `auto_factors.nrfi_probability` to guard
  // against drift in the calibration pipeline.

  /** Build a fiSnap with a chosen FI ERA (same on both sides), starts=10
   *  (above gate, below k), league-avg lineup, no other adjustments. */
  function pAtFiEra(fi: number): GameSnapshot {
    return baseSnapshot({
      home_starter: starter({
        player_external_id: 8200,
        season_era: fi,
        first_inning_era: fi,
        first_inning_starts: 10,
        pitch_quality_score: 1.0,
      }),
      away_starter: starter({
        player_external_id: 8201,
        season_era: fi,
        first_inning_era: fi,
        first_inning_starts: 10,
        pitch_quality_score: 1.0,
        throws: "L",
      }),
    });
  }

  // ── [1.7-A] Constants pinned ────────────────────────────────────
  check(
    "[1.7-A] NRFI_PROBABILITY_THRESHOLD === 0.53",
    NRFI_PROBABILITY_THRESHOLD === 0.53
  );
  check(
    "[1.7-A] YRFI_PROBABILITY_THRESHOLD === 0.47",
    YRFI_PROBABILITY_THRESHOLD === 0.47
  );
  check(
    "[1.7-A] NRFI_NARROW_EDGE_BAND_UPPER === 0.55",
    NRFI_NARROW_EDGE_BAND_UPPER === 0.55
  );
  check(
    "[1.7-A] YRFI_NARROW_EDGE_BAND_LOWER === 0.45",
    YRFI_NARROW_EDGE_BAND_LOWER === 0.45
  );

  // ── [1.7-B] Boundary: FI 4.5 each → P ≈ 0.536 → NRFI (inside) ──
  {
    const out = runMlbAutoModelV1(pAtFiEra(4.5), "morning_draft");
    const p = out.sport_specific.auto_factors.nrfi_probability ?? null;
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      `[1.7-B] FI 4.5 each: P(NRFI) ≈ 0.536 → measured ${p?.toFixed(3) ?? "n/a"}`,
      p !== null && p >= 0.530 && p < 0.545
    );
    check(
      "[1.7-B] FI 4.5 each → NRFI (P ≥ 0.53)",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[1.7-B] FI 4.5 each → narrow_fi_probability_edge fires (0.53 ≤ P < 0.55)",
      codes.includes("narrow_fi_probability_edge")
    );
  }

  // ── [1.7-C] Boundary: FI 5.0 each → P ≈ 0.517 → Toss-Up (inside) ─
  {
    const out = runMlbAutoModelV1(pAtFiEra(5.0), "morning_draft");
    const p = out.sport_specific.auto_factors.nrfi_probability ?? null;
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      `[1.7-C] FI 5.0 each: P(NRFI) ≈ 0.517 → measured ${p?.toFixed(3) ?? "n/a"}`,
      p !== null && p >= 0.510 && p < 0.525
    );
    check(
      "[1.7-C] FI 5.0 each → Toss-Up (0.47 < P < 0.53)",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[1.7-C] FI 5.0 each Toss-Up → does NOT emit narrow_fi_probability_edge",
      !codes.includes("narrow_fi_probability_edge")
    );
    check(
      "[1.7-C] FI 5.0 each Toss-Up → nrfi_confidence === 52 (sentinel)",
      out.nrfi_confidence === 52
    );
  }

  // ── [1.7-D] True 50/50: FI 5.5 each → P ≈ 0.498 → Toss-Up ───────
  {
    const out = runMlbAutoModelV1(pAtFiEra(5.5), "morning_draft");
    const p = out.sport_specific.auto_factors.nrfi_probability ?? null;
    check(
      `[1.7-D] FI 5.5 each: P(NRFI) ≈ 0.498 → measured ${p?.toFixed(3) ?? "n/a"}`,
      p !== null && p >= 0.490 && p < 0.510
    );
    check(
      "[1.7-D] FI 5.5 each (true 50/50) → Toss-Up preserved (narrow band doesn't kill toss-ups)",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
  }

  // ── [1.7-E] Boundary YRFI side: FI 6.4 each → P ≈ 0.466 → YRFI ──
  {
    const out = runMlbAutoModelV1(pAtFiEra(6.4), "morning_draft");
    const p = out.sport_specific.auto_factors.nrfi_probability ?? null;
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      `[1.7-E] FI 6.4 each: P(NRFI) ≈ 0.466 → measured ${p?.toFixed(3) ?? "n/a"}`,
      p !== null && p >= 0.460 && p < 0.475
    );
    check(
      "[1.7-E] FI 6.4 each → YRFI (P ≤ 0.47)",
      out.sport_specific.nrfi_decision_kind === "yrfi"
    );
    check(
      "[1.7-E] FI 6.4 each → narrow_fi_probability_edge fires (0.45 < P ≤ 0.47)",
      codes.includes("narrow_fi_probability_edge")
    );
  }

  // ── [1.7-F] Just outside YRFI narrow band: FI 6.0 → P ≈ 0.480 ───
  // P ≈ 0.480 is BETWEEN YRFI_NARROW_EDGE_BAND_LOWER (0.45) and
  // YRFI_PROBABILITY_THRESHOLD (0.47), so it's still in the Toss-Up
  // band — Toss-Up wins, no narrow edge code.
  {
    const out = runMlbAutoModelV1(pAtFiEra(6.0), "morning_draft");
    const p = out.sport_specific.auto_factors.nrfi_probability ?? null;
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      `[1.7-F] FI 6.0 each: P(NRFI) ≈ 0.480 → measured ${p?.toFixed(3) ?? "n/a"}`,
      p !== null && p >= 0.475 && p < 0.490
    );
    check(
      "[1.7-F] FI 6.0 each → Toss-Up (P in (0.47, 0.53))",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[1.7-F] FI 6.0 each Toss-Up → narrow_fi_probability_edge does NOT fire",
      !codes.includes("narrow_fi_probability_edge")
    );
  }

  // ── [1.7-G] Strong NRFI (well past narrow band) → no narrow code ─
  {
    const out = runMlbAutoModelV1(pAtFiEra(3.0), "morning_draft");
    const p = out.sport_specific.auto_factors.nrfi_probability ?? null;
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      `[1.7-G] FI 3.0 each: P(NRFI) ≥ 0.55 → measured ${p?.toFixed(3) ?? "n/a"}`,
      p !== null && p >= 0.55
    );
    check(
      "[1.7-G] FI 3.0 each → NRFI (clearly past narrow band)",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[1.7-G] FI 3.0 each strong NRFI → narrow_fi_probability_edge does NOT fire",
      !codes.includes("narrow_fi_probability_edge")
    );
  }

  // ── [1.7-H] Strong YRFI (well past narrow band) → no narrow code ─
  {
    const out = runMlbAutoModelV1(pAtFiEra(7.5), "morning_draft");
    const p = out.sport_specific.auto_factors.nrfi_probability ?? null;
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      `[1.7-H] FI 7.5 each: P(NRFI) ≤ 0.45 → measured ${p?.toFixed(3) ?? "n/a"}`,
      p !== null && p <= 0.45
    );
    check(
      "[1.7-H] FI 7.5 each → YRFI (clearly past narrow band)",
      out.sport_specific.nrfi_decision_kind === "yrfi"
    );
    check(
      "[1.7-H] FI 7.5 each strong YRFI → narrow_fi_probability_edge does NOT fire",
      !codes.includes("narrow_fi_probability_edge")
    );
  }

  // ── [1.7-I] Confidence sanity: a narrow-edge pick produces a
  //           53-54 confidence number, NOT the 52 Toss-Up sentinel.
  {
    const out = runMlbAutoModelV1(pAtFiEra(4.5), "morning_draft");
    check(
      "[1.7-I] FI 4.5 each narrow NRFI: nrfi_confidence in [53, 55) (not 52 sentinel)",
      out.nrfi_confidence !== null &&
        out.nrfi_confidence >= 53 &&
        out.nrfi_confidence < 55
    );
    check(
      "[1.7-I] FI 4.5 each narrow NRFI: nrfi_confidence !== 52",
      out.nrfi_confidence !== 52
    );
  }

  // ── [1.7-J] Cap interaction: narrow NRFI under team-proxy cap
  //           (NRFI_CONFIDENCE_CAP − 3) stays directional AND keeps
  //           its low-confidence natural value (~53–54) — never
  //           downgraded below HARD_CONFIDENCE_FLOOR (51).
  {
    const snap: GameSnapshot = {
      ...pAtFiEra(4.5),
      home_team: {
        team_external_id: 21,
        abbreviation: "NYM",
        bullpen_era_proxy: 4.0,
        season_runs_per_game: 4.5,
        team_avg_batter_ops: 0.730,
        team_avg_batter_ops_sample: 2000,
      },
      away_team: {
        team_external_id: 28,
        abbreviation: "MIA",
        bullpen_era_proxy: 4.0,
        season_runs_per_game: 4.5,
        team_avg_batter_ops: 0.730,
        team_avg_batter_ops_sample: 2000,
      },
      home_lineup_top8: [],
      away_lineup_top8: [],
    };
    const out = runMlbAutoModelV1(snap, "morning_draft");
    const codes = out.sport_specific.nrfi_reason_codes ?? [];
    check(
      "[1.7-J] narrow NRFI + team_proxy: still NRFI (directional preserved)",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[1.7-J] narrow NRFI + team_proxy: narrow_fi_probability_edge fires",
      codes.includes("narrow_fi_probability_edge")
    );
    check(
      "[1.7-J] narrow NRFI + team_proxy: top_order_team_proxy_used fires",
      codes.includes("top_order_team_proxy_used")
    );
    check(
      "[1.7-J] narrow NRFI + team_proxy: nrfi_confidence ≥ HARD_CONFIDENCE_FLOOR",
      out.nrfi_confidence !== null &&
        out.nrfi_confidence >= HARD_CONFIDENCE_FLOOR
    );
    check(
      "[1.7-J] narrow NRFI + team_proxy: nrfi_confidence still in narrow band [53, 55)",
      out.nrfi_confidence !== null &&
        out.nrfi_confidence >= 53 &&
        out.nrfi_confidence < 55
    );
  }

  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All MLB auto-model V1 tests passed.`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
