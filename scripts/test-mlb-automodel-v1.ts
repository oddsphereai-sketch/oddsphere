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
      has_pinnacle_total: true,
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
      "When out has predicted scores, ML winner matches higher side",
      out.predicted_home_score === null ||
        out.predicted_away_score === null ||
        out.predicted_ml_winner === null ||
        (out.predicted_home_score > out.predicted_away_score
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
    // Tied scores → null ML
    const out = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const bad: AutoModelOutput = {
      ...out,
      predicted_home_score: 4.5,
      predicted_away_score: 4.5,
      predicted_total: 9.0,
      predicted_ml_winner: "home",
      ml_confidence: 55,
    };
    const { guarded, corrections } = applyDeterministicGuards(
      bad,
      baseSnapshot(),
      "morning_draft"
    );
    check(
      "Guard 2 nulls ML pick when projected scores are equal",
      guarded.predicted_ml_winner === null
    );
    check(
      "Guard 2 records the tie correction",
      corrections.some((c) => c.includes("projected scores are equal"))
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
        has_pinnacle_total: false,
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
  section("Guard 4 — confidence floor (HARD_CONFIDENCE_FLOOR = 51)");
  // ═══════════════════════════════════════════════════════════════

  {
    // Construct a synthetic output that passes Guards 1-3 (so we can
    // isolate Guard 4). Scores asymmetric, ML winner matches higher
    // side, OU has a market line. All three confidences below floor.
    const baseOut = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const synthetic: AutoModelOutput = {
      ...baseOut,
      predicted_home_score: 5.5,
      predicted_away_score: 3.5,
      predicted_total: 9.0,
      predicted_ml_winner: "home", // matches higher
      ml_confidence: 50, // below floor
      predicted_ou_side: "over",
      ou_confidence: 50, // below floor
      predicted_nrfi: true,
      nrfi_confidence: 50, // below floor
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
      "Guard 4 nulls ML pick when ml_confidence < 51",
      guarded.predicted_ml_winner === null && guarded.ml_confidence === null
    );
    check(
      "Guard 4 nulls O/U pick when ou_confidence < 51",
      guarded.predicted_ou_side === null && guarded.ou_confidence === null
    );
    check(
      "Guard 4 nulls NRFI pick when nrfi_confidence < 51",
      guarded.predicted_nrfi === null && guarded.nrfi_confidence === null
    );
    check(
      "Guard 4 records floor-below corrections for all three picks",
      corrections.filter((c) => c.includes("below floor")).length === 3
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
        has_pinnacle_total: false,
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
        has_pinnacle_total: false,
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
    // Predicted total ≈ market line → low confidence, possibly null
    const snap = baseSnapshot({
      market: {
        listed_total: 9.0, // matches expected ~9
        home_ml_odds_american: null,
        away_ml_odds_american: null,
        has_pinnacle_total: false,
      },
    });
    const out = runMlbAutoModelV1(snap, "morning_draft");
    // When |predicted_total - market_line| ≈ 0, raw confidence = 50,
    // below the 51 floor → null
    check(
      "Predicted total ≈ market line → O/U held (below confidence floor)",
      out.predicted_ou_side === null
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
    const snap = baseSnapshot({
      home_starter: starter({
        player_external_id: 4001,
        season_era: 6.0,
        first_inning_era: 6.0,
        first_inning_starts: 10,
      }),
      away_starter: starter({
        player_external_id: 4002,
        season_era: 6.0,
        first_inning_era: 6.0,
        first_inning_starts: 10,
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
    // Phase 4D.1: with the 5-zone framework, league-average ERA 4.0 (fallback
    // proxy 2.8 per pitcher / 9 IP = 0.311 × 2 = 0.622) lands in lean_yrfi.
    // This used to be "no-play" under the old 2-threshold scheme; now it's
    // a lean YRFI pick. Test updated to reflect the new behavior.
    const snap = baseSnapshot(); // all league-average
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "[Phase 4D.1] league-average inputs → predicted_nrfi=false (lean YRFI zone)",
      out.predicted_nrfi === false
    );
    check(
      "[Phase 4D.1] league-avg lean YRFI: nrfi_decision_kind === 'yrfi'",
      out.sport_specific.nrfi_decision_kind === "yrfi"
    );
    check(
      "[Phase 4D.1] league-avg lean YRFI: nrfi_threshold_zone === 'lean_yrfi'",
      out.sport_specific.nrfi_threshold_zone === "lean_yrfi"
    );
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

  // ─── Zone 1: strong NRFI (expected ≤ 0.40) ───────────────────────
  {
    // Two aces — FI 1.5 each, top-of-order 0.700. Expected ≈
    // 2 × (1.5/9 × (0.700/0.73)) ≈ 0.32 → strong_nrfi
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 1.5, awayFI: 1.5, topOps: 0.7 }),
      "morning_draft"
    );
    check(
      "[Phase 4D.1 zone] strong NRFI: predicted_nrfi === true",
      out.predicted_nrfi === true
    );
    check(
      "[Phase 4D.1 zone] strong NRFI: nrfi_decision_kind === 'nrfi'",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[Phase 4D.1 zone] strong NRFI: nrfi_threshold_zone === 'strong_nrfi'",
      out.sport_specific.nrfi_threshold_zone === "strong_nrfi"
    );
    check(
      "[Phase 4D.1 zone] strong NRFI: confidence in [57, 62]",
      out.nrfi_confidence !== null &&
        out.nrfi_confidence >= 57 &&
        out.nrfi_confidence <= 62
    );
  }

  // ─── Zone 2: lean NRFI (0.40 < expected ≤ 0.50) ──────────────────
  {
    // FI 2.0 each, league-avg top-of-order (0.73). Expected =
    // 2 × (2.0/9 × 1.0) = 0.444 → lean_nrfi
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 2.0, awayFI: 2.0, topOps: 0.73 }),
      "morning_draft"
    );
    check(
      "[Phase 4D.1 zone] lean NRFI: predicted_nrfi === true",
      out.predicted_nrfi === true
    );
    check(
      "[Phase 4D.1 zone] lean NRFI: nrfi_decision_kind === 'nrfi'",
      out.sport_specific.nrfi_decision_kind === "nrfi"
    );
    check(
      "[Phase 4D.1 zone] lean NRFI: nrfi_threshold_zone === 'lean_nrfi'",
      out.sport_specific.nrfi_threshold_zone === "lean_nrfi"
    );
    check(
      "[Phase 4D.1 zone] lean NRFI: confidence in [53, 56]",
      out.nrfi_confidence !== null &&
        out.nrfi_confidence >= 53 &&
        out.nrfi_confidence <= 56
    );
  }

  // ─── Zone 3: Toss-Up (0.50 < expected < 0.62) ────────────────────
  {
    // FI 2.5 each, league-avg top-of-order. Expected =
    // 2 × (2.5/9 × 1.0) = 0.556 → toss_up
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 2.5, awayFI: 2.5, topOps: 0.73 }),
      "morning_draft"
    );
    check(
      "[Phase 4D.1 zone] Toss-Up: predicted_nrfi === null (no side)",
      out.predicted_nrfi === null
    );
    check(
      "[Phase 4D.1 zone] Toss-Up: nrfi_decision_kind === 'toss_up'",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[Phase 4D.1 zone] Toss-Up: nrfi_threshold_zone === 'toss_up'",
      out.sport_specific.nrfi_threshold_zone === "toss_up"
    );
    check(
      "[Phase 4D.1 zone] Toss-Up: nrfi_confidence === 52 (display value)",
      out.nrfi_confidence === 52
    );
    check(
      "[Phase 4D.1 zone] Toss-Up: nrfi_hold_reason === null (NOT a hold)",
      out.sport_specific.nrfi_hold_reason === null
    );
    check(
      "[Phase 4D.1 zone] Toss-Up: 'nrfi' included in hold_picks (for write path)",
      out.sport_specific.hold_picks.includes("nrfi")
    );
  }

  // ─── Zone 4: lean YRFI (0.62 ≤ expected < 0.72) ──────────────────
  {
    // FI 3.0 each, league-avg top-of-order. Expected =
    // 2 × (3.0/9 × 1.0) = 0.667 → lean_yrfi
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 3.0, awayFI: 3.0, topOps: 0.73 }),
      "morning_draft"
    );
    check(
      "[Phase 4D.1 zone] lean YRFI: predicted_nrfi === false",
      out.predicted_nrfi === false
    );
    check(
      "[Phase 4D.1 zone] lean YRFI: nrfi_decision_kind === 'yrfi'",
      out.sport_specific.nrfi_decision_kind === "yrfi"
    );
    check(
      "[Phase 4D.1 zone] lean YRFI: nrfi_threshold_zone === 'lean_yrfi'",
      out.sport_specific.nrfi_threshold_zone === "lean_yrfi"
    );
    check(
      "[Phase 4D.1 zone] lean YRFI: confidence in [53, 56]",
      out.nrfi_confidence !== null &&
        out.nrfi_confidence >= 53 &&
        out.nrfi_confidence <= 56
    );
  }

  // ─── Zone 5: strong YRFI (expected ≥ 0.72) ───────────────────────
  {
    // FI 5.0 each, top-of-order 0.85. Expected =
    // 2 × (5.0/9 × (0.85/0.73)) = 2 × 0.647 = 1.293 → strong_yrfi
    const out = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 5.0, awayFI: 5.0, topOps: 0.85 }),
      "morning_draft"
    );
    check(
      "[Phase 4D.1 zone] strong YRFI: predicted_nrfi === false",
      out.predicted_nrfi === false
    );
    check(
      "[Phase 4D.1 zone] strong YRFI: nrfi_decision_kind === 'yrfi'",
      out.sport_specific.nrfi_decision_kind === "yrfi"
    );
    check(
      "[Phase 4D.1 zone] strong YRFI: nrfi_threshold_zone === 'strong_yrfi'",
      out.sport_specific.nrfi_threshold_zone === "strong_yrfi"
    );
    check(
      "[Phase 4D.1 zone] strong YRFI: confidence in [57, 62]",
      out.nrfi_confidence !== null &&
        out.nrfi_confidence >= 57 &&
        out.nrfi_confidence <= 62
    );
  }

  // ─── Toss-Up vs Held distinctness ────────────────────────────────
  {
    // Toss-Up case: data adequate, expected lands in toss_up zone
    const tossOut = runMlbAutoModelV1(
      nrfiSnap({ homeFI: 2.5, awayFI: 2.5, topOps: 0.73 }),
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
    // Setup that would normally produce a lean NRFI (FI 2.0/2.0, league-
    // avg ops, expected ≈ 0.444 → lean_nrfi at confidence ~54.5).
    // Then layer on data-quality penalties: fallback ERA (cap=60),
    // unconfirmed lineup (-5), unconfirmed starter (-5) → cap=50,
    // which is below floor → downgrade to Toss-Up.
    const snap: GameSnapshot = {
      ...nrfiSnap({ homeFI: null, awayFI: null, homeSeason: 2.857, awaySeason: 2.857, topOps: 0.73 }),
      data_quality: {
        starter_confirmed: false, // -5
        lineup_confirmed: false,  // -5
        weather_available: false,
        season_stats_present: true,
      },
    };
    const out = runMlbAutoModelV1(snap, "morning_draft");
    // After caps: 60 (fallback) - 5 (lineup) - 5 (starter) = 50 < 51 floor
    // → downgrade to Toss-Up
    check(
      "[Phase 4D.1] data-quality downgrade: predicted_nrfi=null when caps drop below floor",
      out.predicted_nrfi === null
    );
    check(
      "[Phase 4D.1] data-quality downgrade: decision_kind='toss_up'",
      out.sport_specific.nrfi_decision_kind === "toss_up"
    );
    check(
      "[Phase 4D.1] data-quality downgrade: zone='below_floor'",
      out.sport_specific.nrfi_threshold_zone === "below_floor"
    );
    check(
      "[Phase 4D.1] data-quality downgrade: reason_codes include lineup_unconfirmed + starter_unconfirmed",
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
  // baseline (expected ~0.55), so modifier shifts move it across zones.
  function tossupSnap(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
    return baseSnapshot({
      home_starter: starter({
        player_external_id: 7100,
        season_era: 3.6,
        first_inning_era: 2.5,
        first_inning_starts: 10,
        // pitch_quality_score deliberately at exactly 1.0 (neutral)
        pitch_quality_score: 1.0,
      }),
      away_starter: starter({
        player_external_id: 7101,
        season_era: 3.6,
        first_inning_era: 2.5,
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
    const whiffy = runMlbAutoModelV1(
      tossupSnap({
        home_starter: starter({
          player_external_id: 7100,
          season_era: 3.6,
          first_inning_era: 2.5,
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
          season_era: 3.6,
          first_inning_era: 2.5,
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
        has_pinnacle_total: false,
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
            has_pinnacle_total: false,
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
      `[${c.label}] ml_confidence is either null or in [${HARD_CONFIDENCE_FLOOR}, ${cap}]`,
      out.ml_confidence === null ||
        (out.ml_confidence >= HARD_CONFIDENCE_FLOOR && out.ml_confidence <= cap)
    );
    check(
      `[${c.label}] ou_confidence is either null or in [${HARD_CONFIDENCE_FLOOR}, ${cap}]`,
      out.ou_confidence === null ||
        (out.ou_confidence >= HARD_CONFIDENCE_FLOOR && out.ou_confidence <= cap)
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
        has_pinnacle_total: false,
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
        "[3x1.8b] ML confidence within bounds with real FI",
        withReal.ml_confidence === null ||
          (withReal.ml_confidence >= 51 && withReal.ml_confidence <= 65)
      );
    }
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
