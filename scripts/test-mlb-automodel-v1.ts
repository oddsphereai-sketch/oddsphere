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
    ballpark: { park_factor_runs: 1.0, is_dome: false },
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
      }),
      away_starter: starter({
        player_external_id: 3002,
        season_era: 1.8,
        first_inning_era: 1.8,
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
      }),
      away_starter: starter({
        player_external_id: 4002,
        season_era: 6.0,
        first_inning_era: 6.0,
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
    // Middling pitchers + middling lineups → no-play
    const snap = baseSnapshot(); // all league-average
    const out = runMlbAutoModelV1(snap, "morning_draft");
    check(
      "League-average inputs → NRFI in no-play zone (predicted_nrfi=null)",
      out.predicted_nrfi === null
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
      (out.predicted_ml_winner === null) === (out.ml_confidence === null) &&
        (out.predicted_ou_side === null) === (out.ou_confidence === null) &&
        (out.predicted_nrfi === null) === (out.nrfi_confidence === null)
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
    // Coors-like park (factor 1.15) → both teams score more
    const baseOut = runMlbAutoModelV1(baseSnapshot(), "morning_draft");
    const coorsOut = runMlbAutoModelV1(
      baseSnapshot({ ballpark: { park_factor_runs: 1.15, is_dome: false } }),
      "morning_draft"
    );
    check(
      "High park factor → predicted_total higher than league-neutral park",
      coorsOut.predicted_total !== null &&
        baseOut.predicted_total !== null &&
        coorsOut.predicted_total > baseOut.predicted_total
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
        ballpark: { park_factor_runs: 1.0, is_dome: true },
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
