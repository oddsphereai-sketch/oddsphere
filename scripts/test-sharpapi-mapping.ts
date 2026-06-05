/**
 * Phase 4.2.C.1.R-17 Step 2D — pure unit tests for SharpAPI market /
 * sportsbook / side mapping helpers.
 *
 * Pinning regression cases for the dropped-market list confirmed by
 * the 2026-06-05 audit, so future tweaks to `mapMarketType` can't
 * accidentally accept a non-first-inning market as our NRFI/YRFI
 * surface (or accept a player-prop / team-total as a full-game
 * market).
 *
 * Pure tests — no network, no DB, no SHARPAPI_KEY gate. Always runs
 * in CI regardless of environment.
 *
 * Run: npx tsx scripts/test-sharpapi-mapping.ts
 */

import { __TEST__ } from "../lib/providers/real_api/SharpAPIOddsProvider";
const { mapMarketType, mapSportsbook, mapSide } = __TEST__;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

function main() {
  section("mapMarketType — accepted markets (full-game)");
  check(`"moneyline" → "moneyline"`, mapMarketType("moneyline") === "moneyline");
  check(`"h2h" → "moneyline"`, mapMarketType("h2h") === "moneyline");
  check(`"ml" → "moneyline"`, mapMarketType("ml") === "moneyline");
  check(`"total" → "total"`, mapMarketType("total") === "total");
  check(`"totals" → "total"`, mapMarketType("totals") === "total");
  check(`"total_runs" → "total"`, mapMarketType("total_runs") === "total");
  check(`"over_under" → "total"`, mapMarketType("over_under") === "total");
  check(`"ou" → "total"`, mapMarketType("ou") === "total");
  check(`"spread" → "spread"`, mapMarketType("spread") === "spread");
  check(`"spreads" → "spread"`, mapMarketType("spreads") === "spread");
  check(`"runline" → "spread"`, mapMarketType("runline") === "spread");
  check(`"run_line" → "spread"`, mapMarketType("run_line") === "spread");

  section("mapMarketType — accepted first-inning total (NRFI/YRFI surface)");
  check(
    `"1st_inning_total_runs" → "first_inning_total"`,
    mapMarketType("1st_inning_total_runs") === "first_inning_total"
  );
  check(
    `"first_inning_total" → "first_inning_total"`,
    mapMarketType("first_inning_total") === "first_inning_total"
  );
  check(
    `"1st_inning_total" → "first_inning_total"`,
    mapMarketType("1st_inning_total") === "first_inning_total"
  );

  section("mapMarketType — INTENTIONALLY DROPPED (pinned regressions)");
  // The 2026-06-05 audit confirmed these raw market_types appear in
  // SharpAPI's /odds responses. Each is intentionally NOT mapped to
  // any of our markets — accepting them would mis-grade picks.
  check(
    `"1st_inning_moneyline_3-way" → null (3-way ML, NOT NRFI)`,
    mapMarketType("1st_inning_moneyline_3-way") === null
  );
  check(
    `"1st_5_innings_total_runs" → null (F5 window, NOT first inning)`,
    mapMarketType("1st_5_innings_total_runs") === null
  );
  check(
    `"1st_3_innings_total_runs" → null (F3 window, NOT first inning)`,
    mapMarketType("1st_3_innings_total_runs") === null
  );
  check(
    `"1st_3_innings_moneyline_3-way" → null`,
    mapMarketType("1st_3_innings_moneyline_3-way") === null
  );
  check(
    `"1st_5_innings_moneyline_3-way" → null`,
    mapMarketType("1st_5_innings_moneyline_3-way") === null
  );
  check(
    `"1st_3_innings_run_line" → null`,
    mapMarketType("1st_3_innings_run_line") === null
  );
  check(
    `"1st_5_innings_run_line" → null`,
    mapMarketType("1st_5_innings_run_line") === null
  );
  check(
    `"team_total" → null (team-side O/U, NOT game total)`,
    mapMarketType("team_total") === null
  );
  check(
    `"moneyline_3-way" → null (3-outcome ML, NOT MLB ML)`,
    mapMarketType("moneyline_3-way") === null
  );
  check(
    `"player_hits" → null (player prop)`,
    mapMarketType("player_hits") === null
  );
  check(
    `"game_prop" → null`,
    mapMarketType("game_prop") === null
  );

  section("mapMarketType — defensive: null + whitespace + case");
  check("null input → null", mapMarketType(null) === null);
  check(
    "uppercase 'MONEYLINE' normalized → 'moneyline'",
    mapMarketType("MONEYLINE") === "moneyline"
  );
  check(
    "whitespace ' moneyline ' normalized → 'moneyline'",
    mapMarketType("  moneyline  ") === "moneyline"
  );
  check(
    "unknown future market_type → null (safe drop)",
    mapMarketType("home_run_derby_odds") === null
  );

  section("mapSportsbook — pass-through (no allow-list)");
  // The 2026-06-05 audit confirmed `mapSportsbook` is intentionally a
  // pass-through with NO allow-list — every book name SharpAPI emits
  // is accepted. Today's MLB slate exposed: fliff, kalshi, ballybet,
  // bet365 us. Major books (Pinnacle/DK/FD/MGM/Caesars) are absent
  // from SharpAPI MLB at intra-day fetch times; pin behavior so we
  // catch any future "drop major books by allow-list" regression.
  check(
    `"pinnacle" → "pinnacle"`,
    mapSportsbook("pinnacle") === "pinnacle"
  );
  check(
    `"draftkings" → "draftkings"`,
    mapSportsbook("draftkings") === "draftkings"
  );
  check(
    `"fanduel" → "fanduel"`,
    mapSportsbook("fanduel") === "fanduel"
  );
  check(
    `"betmgm" → "betmgm"`,
    mapSportsbook("betmgm") === "betmgm"
  );
  check(
    `"caesars" → "caesars"`,
    mapSportsbook("caesars") === "caesars"
  );
  check(
    `"fliff" → "fliff"`,
    mapSportsbook("fliff") === "fliff"
  );
  check(
    `"kalshi" → "kalshi"`,
    mapSportsbook("kalshi") === "kalshi"
  );
  check(
    `"ballybet" → "ballybet"`,
    mapSportsbook("ballybet") === "ballybet"
  );
  check(
    `mixed-case "Pinnacle" → lowercased "pinnacle"`,
    mapSportsbook("Pinnacle") === "pinnacle"
  );
  check(
    `whitespace " pinnacle " → "pinnacle"`,
    mapSportsbook("  pinnacle  ") === "pinnacle"
  );
  check(
    `null input → null`,
    mapSportsbook(null) === null
  );
  check(
    `empty string → null`,
    mapSportsbook("") === null
  );
  check(
    `unrecognized "new_book_2027" still passes through`,
    mapSportsbook("new_book_2027") === "new_book_2027"
  );

  section("mapSide — selection_type → side");
  check(`"home" → "home"`, mapSide("home") === "home");
  check(`"away" → "away"`, mapSide("away") === "away");
  check(`"over" → "over"`, mapSide("over") === "over");
  check(`"under" → "under"`, mapSide("under") === "under");
  check(`"yes" → "yes"`, mapSide("yes") === "yes");
  check(`"no" → "no"`, mapSide("no") === "no");
  check(`uppercase "HOME" → "home"`, mapSide("HOME") === "home");
  check(`unknown "tie" → null`, mapSide("tie") === null);
  check(`null → null`, mapSide(null) === null);
  check(`number → null`, mapSide(42) === null);

  // ── Summary ─────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All sharpapi-mapping tests passed.`);
}

main();
