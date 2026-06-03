/**
 * Phase 4C — pure unit tests for buildSnapshotStash.
 *
 * No DB, no env. Verifies the 10-primitive projection from
 * GameSnapshot → SnapshotStash plus defensive null handling for
 * missing starters / missing sharp / missing injuries.
 *
 * Runs via:
 *   npx tsx scripts/test-automodel-snapshot-stash.ts
 */

import { buildSnapshotStash } from "../lib/automodel/snapshotStash";
import type { GameSnapshot } from "../lib/automodel/types";

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

// ─── Fixture builders ────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  const base: GameSnapshot = {
    game_external_id: 18599100,
    slate_date: "2026-05-22",
    game_date: "2026-05-22T20:00:00Z",
    home_team: {
      team_external_id: 1,
      abbreviation: "HOM",
      bullpen_era_proxy: 4.0,
      season_runs_per_game: 4.5,
    },
    away_team: {
      team_external_id: 2,
      abbreviation: "AWY",
      bullpen_era_proxy: 4.0,
      season_runs_per_game: 4.5,
    },
    home_starter: {
      player_external_id: 100,
      player_name: "H. Pitcher",
      throws: "R",
      season_era: 3.5,
      season_whip: 1.2,
      season_k_per_9: 9.0,
      last30_era: 3.6,
      pitch_quality_score: 1.0,
      is_confirmed: true,
      is_scratched: false,
      first_inning_era: null,
      first_inning_starts: null,
      first_inning_whip: null,
    },
    away_starter: {
      player_external_id: 200,
      player_name: "A. Pitcher",
      throws: "L",
      season_era: 4.0,
      season_whip: 1.3,
      season_k_per_9: 8.0,
      last30_era: 4.2,
      pitch_quality_score: 0.98,
      is_confirmed: true,
      is_scratched: false,
      first_inning_era: null,
      first_inning_starts: null,
      first_inning_whip: null,
    },
    home_lineup_top8: [],
    away_lineup_top8: [],
    ballpark: null,
    weather: null,
    market: {
      listed_total: 8.5,
      home_ml_odds_american: -130,
      away_ml_odds_american: +110,
      has_pinnacle_total: true,
    },
    sharp: {
      pinnacle_ml_fair_prob_home: 55.0,
      pinnacle_ml_fair_prob_away: 45.0,
      pinnacle_total_ev_pct: 1.2,
      pinnacle_ml_ev_pct: 2.5,
      public_betting_pct_home: 60.0,
      public_money_pct_home: 58.0,
      public_betting_pct_over: 55.0,
      public_money_pct_over: 52.0,
    },
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
  };
  return { ...base, ...overrides };
}

// ─── Happy path ──────────────────────────────────────────────────────
section("Happy path — all fields populated");

const fullSnap = makeSnapshot();
const fullStash = buildSnapshotStash(fullSnap);

check(
  "stash has exactly 10 keys (bounded shape)",
  Object.keys(fullStash).length === 10
);
check(
  "home_starter_was_scratched === false (healthy starter)",
  fullStash.home_starter_was_scratched === false
);
check(
  "away_starter_was_scratched === false",
  fullStash.away_starter_was_scratched === false
);
check(
  "home_top3_hitters_injured_count === 0",
  fullStash.home_top3_hitters_injured_count === 0
);
check(
  "away_top3_hitters_injured_count === 0",
  fullStash.away_top3_hitters_injured_count === 0
);
check(
  "pinnacle_ml_fair_prob_home === 55.0",
  fullStash.pinnacle_ml_fair_prob_home === 55.0
);
check(
  "pinnacle_ml_ev_pct === 2.5",
  fullStash.pinnacle_ml_ev_pct === 2.5
);
check(
  "public_betting_pct_home === 60.0",
  fullStash.public_betting_pct_home === 60.0
);
check(
  "public_money_pct_home === 58.0",
  fullStash.public_money_pct_home === 58.0
);
check(
  "public_betting_pct_over === 55.0",
  fullStash.public_betting_pct_over === 55.0
);
check(
  "public_money_pct_over === 52.0",
  fullStash.public_money_pct_over === 52.0
);

// ─── Scratched starters ──────────────────────────────────────────────
section("Scratched starters propagate to was_scratched booleans");

const homeScratched = buildSnapshotStash(
  makeSnapshot({
    home_starter: {
      ...makeSnapshot().home_starter!,
      is_scratched: true,
    },
  })
);
check(
  "home is_scratched=true → home_starter_was_scratched=true",
  homeScratched.home_starter_was_scratched === true
);
check(
  "away unaffected when only home scratched",
  homeScratched.away_starter_was_scratched === false
);

// ─── Missing starters (null) — defensive false ───────────────────────
section("Missing starters → was_scratched=false (defensive)");

const noStarters = buildSnapshotStash(
  makeSnapshot({ home_starter: null, away_starter: null })
);
check(
  "null home_starter → home_starter_was_scratched=false",
  noStarters.home_starter_was_scratched === false
);
check(
  "null away_starter → away_starter_was_scratched=false",
  noStarters.away_starter_was_scratched === false
);

// ─── Top-3 injury counts ─────────────────────────────────────────────
section("Top-3 injury counts passed through");

const injuredHome = buildSnapshotStash(
  makeSnapshot({
    active_injuries: {
      home_starter_out: false,
      away_starter_out: false,
      home_top3_hitters_injured_count: 2,
      away_top3_hitters_injured_count: 0,
    },
  })
);
check(
  "home_top3 count 2 propagated",
  injuredHome.home_top3_hitters_injured_count === 2
);
check(
  "away_top3 count 0 propagated",
  injuredHome.away_top3_hitters_injured_count === 0
);

// ─── Missing sharp → all Pinnacle/public fields null ─────────────────
section("Missing sharp → all 6 sharp/public fields are null");

const noSharp = buildSnapshotStash(makeSnapshot({ sharp: null }));
check(
  "sharp=null → pinnacle_ml_fair_prob_home=null",
  noSharp.pinnacle_ml_fair_prob_home === null
);
check(
  "sharp=null → pinnacle_ml_ev_pct=null",
  noSharp.pinnacle_ml_ev_pct === null
);
check(
  "sharp=null → public_betting_pct_home=null",
  noSharp.public_betting_pct_home === null
);
check(
  "sharp=null → public_money_pct_home=null",
  noSharp.public_money_pct_home === null
);
check(
  "sharp=null → public_betting_pct_over=null",
  noSharp.public_betting_pct_over === null
);
check(
  "sharp=null → public_money_pct_over=null",
  noSharp.public_money_pct_over === null
);

// ─── Partial sharp (some fields null) ────────────────────────────────
section("Partial sharp — nulls propagate, present values pass through");

const partialSharp = buildSnapshotStash(
  makeSnapshot({
    sharp: {
      pinnacle_ml_fair_prob_home: 52.0,
      pinnacle_ml_fair_prob_away: 48.0,
      pinnacle_total_ev_pct: null,
      pinnacle_ml_ev_pct: null,
      public_betting_pct_home: null,
      public_money_pct_home: null,
      public_betting_pct_over: 75.0,
      public_money_pct_over: 70.0,
    },
  })
);
check(
  "partial: fair_prob set, ev null",
  partialSharp.pinnacle_ml_fair_prob_home === 52.0 &&
    partialSharp.pinnacle_ml_ev_pct === null
);
check(
  "partial: home public null, over public set",
  partialSharp.public_betting_pct_home === null &&
    partialSharp.public_betting_pct_over === 75.0
);

// ─── Bounded shape (no nested data) ──────────────────────────────────
section("Bounded shape — JSON-serializable + flat");

const json = JSON.stringify(fullStash);
const parsed = JSON.parse(json);
check(
  "stash round-trips through JSON cleanly",
  Object.keys(parsed).length === 10
);
check(
  "all stash values are primitive (number | boolean | null)",
  Object.values(fullStash).every((v) => {
    const t = typeof v;
    return t === "number" || t === "boolean" || v === null;
  })
);
// Bound check: serialized size stays well below the "bloat" threshold.
// Full GameSnapshot serializes to ~10 KB; the stash should stay under 1 KB.
check(
  `serialized stash ≤ 500 bytes (got ${json.length})`,
  json.length <= 500
);

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All snapshot-stash tests passed.`);
