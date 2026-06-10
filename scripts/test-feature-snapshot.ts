/**
 * Phase 3B — Live integration test for featureSnapshot.ts.
 *
 * Reads against the production Supabase DB (read-only). Verifies that
 * buildFeatureSnapshots produces well-formed GameSnapshot[] for today's
 * MLB slate, with honest null fallbacks for missing data.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-feature-snapshot.ts
 */

import {
  buildFeatureSnapshots,
  __TEST__ as fs,
} from "../lib/automodel/featureSnapshot";
import type { GameSnapshot } from "../lib/automodel/types";
import { supabase } from "../lib/db/supabase";

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

async function tableRowCount(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    throw new Error(`count(${table}) failed: ${error.message}`);
  }
  return count ?? 0;
}

async function main() {
  section("Phase 3B offline helpers");

  // deriveSeason
  check(
    'deriveSeason("2026-05-29") === 2026',
    fs.deriveSeason("2026-05-29") === 2026
  );
  check(
    'deriveSeason("2025-09-15") === 2025',
    fs.deriveSeason("2025-09-15") === 2025
  );
  check(
    "deriveSeason on a malformed date falls back to CURRENT_SEASON_FALLBACK",
    fs.deriveSeason("not-a-date") === fs.CURRENT_SEASON_FALLBACK
  );

  // computePitchQualityScore (sign-corrected formula)
  check(
    "computePitchQualityScore returns null with fewer than 3 pitch rows",
    fs.computePitchQualityScore([
      { whiff_rate: 0.3, pct_of_total: 0.5 },
      { whiff_rate: 0.2, pct_of_total: 0.3 },
    ]) === null
  );
  {
    // High whiff rate → score LOWER than 1.0 (better pitcher, fewer
    // runs allowed when multiplied into era_factor).
    const highWhiff = fs.computePitchQualityScore([
      { whiff_rate: 0.32, pct_of_total: 0.4 },
      { whiff_rate: 0.3, pct_of_total: 0.35 },
      { whiff_rate: 0.28, pct_of_total: 0.25 },
    ]);
    check(
      `high-whiff weighted average → pitch_quality_score < 1.0 (got ${highWhiff})`,
      highWhiff !== null && highWhiff < 1.0
    );
  }
  {
    // Low whiff → score > 1.0 (worse pitcher)
    const lowWhiff = fs.computePitchQualityScore([
      { whiff_rate: 0.12, pct_of_total: 0.4 },
      { whiff_rate: 0.1, pct_of_total: 0.35 },
      { whiff_rate: 0.14, pct_of_total: 0.25 },
    ]);
    check(
      `low-whiff weighted average → pitch_quality_score > 1.0 (got ${lowWhiff})`,
      lowWhiff !== null && lowWhiff > 1.0
    );
  }
  {
    // League-average whiff (~0.22) → score ≈ 1.0
    const avgWhiff = fs.computePitchQualityScore([
      { whiff_rate: 0.22, pct_of_total: 0.5 },
      { whiff_rate: 0.22, pct_of_total: 0.3 },
      { whiff_rate: 0.22, pct_of_total: 0.2 },
    ]);
    check(
      `league-average whiff → pitch_quality_score ≈ 1.0 (got ${avgWhiff})`,
      avgWhiff !== null && Math.abs(avgWhiff - 1.0) < 0.001
    );
  }
  check(
    "clamp upper bound: pitch_quality_score never exceeds 1.08",
    fs.computePitchQualityScore([
      { whiff_rate: 0.0, pct_of_total: 0.5 }, // very low whiff → high score
      { whiff_rate: 0.0, pct_of_total: 0.3 },
      { whiff_rate: 0.0, pct_of_total: 0.2 },
    ]) !== null &&
      fs.computePitchQualityScore([
        { whiff_rate: 0.0, pct_of_total: 0.5 },
        { whiff_rate: 0.0, pct_of_total: 0.3 },
        { whiff_rate: 0.0, pct_of_total: 0.2 },
      ])! <= 1.08
  );
  check(
    "clamp lower bound: pitch_quality_score never goes below 0.92",
    fs.computePitchQualityScore([
      { whiff_rate: 0.6, pct_of_total: 0.5 }, // very high whiff → low score
      { whiff_rate: 0.6, pct_of_total: 0.3 },
      { whiff_rate: 0.6, pct_of_total: 0.2 },
    ]) !== null &&
      fs.computePitchQualityScore([
        { whiff_rate: 0.6, pct_of_total: 0.5 },
        { whiff_rate: 0.6, pct_of_total: 0.3 },
        { whiff_rate: 0.6, pct_of_total: 0.2 },
      ])! >= 0.92
  );

  // ── pickListedTotal — 2026-06-09 phantom-alt-line corroboration rules ──
  // Helper: build a both-sided real-book row pair.
  const ou = (book: string, line: number, gameId = 1) => [
    { game_id: gameId, market_type: "total", sportsbook: book, side: "over",  line_value: line, odds_american: -110 },
    { game_id: gameId, market_type: "total", sportsbook: book, side: "under", line_value: line, odds_american: -110 },
  ];
  {
    // 2-real-book main-line: pinnacle + draftkings both at 8.5 → real_book
    const lines = [...ou("pinnacle", 8.5), ...ou("draftkings", 8.5)];
    const r = fs.pickListedTotal(lines);
    check(
      "pickListedTotal: 2 priority real-books at 8.5 → real_book, pinnacle preferred",
      r.listed_total === 8.5 && r.has_pinnacle_total === true && r.source === "real_book" && r.agreement_count === 2 && r.book === "pinnacle"
    );
  }
  {
    // 1 real-book + splits_consensus at same line → real_book
    const lines = [
      ...ou("ballybet", 8.5),
      { game_id: 1, market_type: "total", sportsbook: "splits_consensus", side: "over",  line_value: 8.5, odds_american: null },
      { game_id: 1, market_type: "total", sportsbook: "splits_consensus", side: "under", line_value: 8.5, odds_american: null },
    ];
    const r = fs.pickListedTotal(lines);
    check(
      "pickListedTotal: 1 real-book + consensus at same line → real_book",
      r.listed_total === 8.5 && r.source === "real_book" && r.agreement_count === 1 && r.consensus_at_same_line === true && r.book === "ballybet"
    );
  }
  {
    // ALT-LINE NOISE: Kalshi binary contracts at every 0.5 line, no
    // other real-book → must NOT be selected; falls to consensus or unavailable.
    const lines = [];
    for (const ln of [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5]) {
      lines.push(...ou("kalshi", ln));
    }
    const r = fs.pickListedTotal(lines as any);
    check(
      "pickListedTotal: Kalshi alt-line noise solo → real_book ONLY if a single Kalshi both-sided line passes the ≥2 corroborator bar (it shouldn't here without other books)",
      // Every Kalshi line shows both over+under in our fixture, so each line has agreement=1.
      // No second real-book corroborates and no consensus given → all candidates fail the ≥2 bar
      // → fall through to "unavailable".
      r.source === "unavailable" && r.listed_total === null && r.book === null
    );
  }
  {
    // consensus_fallback: only splits_consensus exists → consensus_fallback
    const lines = [
      { game_id: 1, market_type: "total", sportsbook: "splits_consensus", side: "over",  line_value: 9, odds_american: null },
      { game_id: 1, market_type: "total", sportsbook: "splits_consensus", side: "under", line_value: 9, odds_american: null },
    ];
    const r = fs.pickListedTotal(lines);
    check(
      "pickListedTotal: only splits_consensus → consensus_fallback",
      r.source === "consensus_fallback" && r.listed_total === 9 && r.book === "splits_consensus" && r.agreement_count === 0
    );
  }
  {
    // Mixed real-book disagreement: ballybet at 8.5 (both sides),
    // betmgm at 9 (both sides) → no line has ≥2 corroborators →
    // falls to consensus (if any) → here no consensus → unavailable.
    const lines = [...ou("ballybet", 8.5), ...ou("betmgm", 9)];
    const r = fs.pickListedTotal(lines);
    check(
      "pickListedTotal: mixed disagreement, no consensus → unavailable",
      r.source === "unavailable" && r.listed_total === null
    );
  }
  {
    // Same disagreement BUT splits_consensus at 9 → consensus tips betmgm 9 over ballybet 8.5
    const lines = [
      ...ou("ballybet", 8.5),
      ...ou("betmgm", 9),
      { game_id: 1, market_type: "total", sportsbook: "splits_consensus", side: "over",  line_value: 9, odds_american: null },
      { game_id: 1, market_type: "total", sportsbook: "splits_consensus", side: "under", line_value: 9, odds_american: null },
    ];
    const r = fs.pickListedTotal(lines);
    check(
      "pickListedTotal: mixed disagreement + consensus at 9 → real_book 9 (consensus tips)",
      r.source === "real_book" && r.listed_total === 9 && r.book === "betmgm" && r.consensus_at_same_line === true
    );
  }
  {
    // Kalshi alt-line corroborated by another real-book at same line → accepted as real_book.
    // Kalshi posts alt-lines at 7.5, 8.5, 9.5; betmgm has main at 8.5.
    const lines = [
      ...ou("kalshi", 7.5),
      ...ou("kalshi", 8.5),
      ...ou("kalshi", 9.5),
      ...ou("betmgm", 8.5),
    ];
    const r = fs.pickListedTotal(lines);
    check(
      "pickListedTotal: Kalshi alt-line corroborated by another real-book at 8.5 → real_book",
      r.source === "real_book" && r.listed_total === 8.5 && r.agreement_count === 2
    );
  }
  {
    // splits_consensus is NEVER counted as a real-book corroborator on its own.
    const lines = [
      { game_id: 1, market_type: "total", sportsbook: "splits_consensus", side: "over",  line_value: 8.5, odds_american: null },
      { game_id: 1, market_type: "total", sportsbook: "splits_consensus", side: "under", line_value: 8.5, odds_american: null },
    ];
    const r = fs.pickListedTotal(lines);
    check(
      "pickListedTotal: splits_consensus excluded from real-book set → consensus_fallback",
      r.source === "consensus_fallback" && r.book === "splits_consensus"
    );
  }
  {
    // Single real-book both-sided line WITHOUT consensus support → fails ≥2 bar → unavailable
    const lines = [...ou("betmgm", 8.5)];
    const r = fs.pickListedTotal(lines);
    check(
      "pickListedTotal: single real-book without consensus → unavailable (no corroboration)",
      r.source === "unavailable" && r.listed_total === null
    );
  }
  {
    const r = fs.pickListedTotal([]);
    check(
      "pickListedTotal: empty lines → unavailable",
      r.listed_total === null && r.source === "unavailable" && r.has_pinnacle_total === false
    );
  }

  // ── Live DB integration tests ──────────────────────────────────
  section("Live DB integration — buildFeatureSnapshots");

  const today = new Date().toISOString().slice(0, 10);

  // No-write proof: capture row counts before and after the call.
  const rowCountsBefore = {
    games: await tableRowCount("games"),
    game_predictions: await tableRowCount("game_predictions"),
    lineups: await tableRowCount("lineups"),
    player_season_stats: await tableRowCount("player_season_stats"),
    sharp_signals: await tableRowCount("sharp_signals"),
    lines: await tableRowCount("lines"),
    scores_model_runs: await tableRowCount("scores_model_runs"),
  };

  let snapshots: GameSnapshot[];
  try {
    snapshots = await buildFeatureSnapshots("mlb", today);
    check(
      `buildFeatureSnapshots('mlb', '${today}') returned array (got ${snapshots.length} snapshots)`,
      Array.isArray(snapshots)
    );
  } catch (e) {
    console.log(
      `  ✗ buildFeatureSnapshots threw: ${e instanceof Error ? e.message : e}`
    );
    fail++;
    snapshots = [];
  }

  // No-write proof: capture row counts after and assert no change.
  const rowCountsAfter = {
    games: await tableRowCount("games"),
    game_predictions: await tableRowCount("game_predictions"),
    lineups: await tableRowCount("lineups"),
    player_season_stats: await tableRowCount("player_season_stats"),
    sharp_signals: await tableRowCount("sharp_signals"),
    lines: await tableRowCount("lines"),
    scores_model_runs: await tableRowCount("scores_model_runs"),
  };

  section("Read-only proof — row counts unchanged");
  for (const table of Object.keys(rowCountsBefore) as Array<
    keyof typeof rowCountsBefore
  >) {
    check(
      `${table}: row count unchanged (${rowCountsBefore[table]} → ${rowCountsAfter[table]})`,
      rowCountsBefore[table] === rowCountsAfter[table]
    );
  }

  // Cross-sport gate
  {
    const empty = await buildFeatureSnapshots("nba", today);
    check(
      "buildFeatureSnapshots('nba', today) returns [] (V1 MLB-only sport gate)",
      empty.length === 0
    );
  }

  // Snapshot shape checks (only when slate has data)
  if (snapshots.length > 0) {
    section(`Snapshot shape (sampled first snapshot, slate=${today})`);
    const s = snapshots[0]!;
    check(
      "snapshot has game_external_id, slate_date, game_date",
      typeof s.game_external_id === "number" &&
        typeof s.slate_date === "string" &&
        typeof s.game_date === "string"
    );
    check(
      "snapshot has both home_team and away_team",
      typeof s.home_team === "object" && typeof s.away_team === "object"
    );
    check(
      "snapshot.home_team has abbreviation + team_external_id",
      typeof s.home_team.abbreviation === "string" &&
        typeof s.home_team.team_external_id === "number"
    );
    check(
      "snapshot.market has all 4 fields (listed_total/ml_odds/has_pinnacle)",
      "listed_total" in s.market &&
        "home_ml_odds_american" in s.market &&
        "away_ml_odds_american" in s.market &&
        "has_pinnacle_total" in s.market
    );
    check(
      "snapshot.data_quality has all 4 flags",
      typeof s.data_quality.starter_confirmed === "boolean" &&
        typeof s.data_quality.lineup_confirmed === "boolean" &&
        typeof s.data_quality.weather_available === "boolean" &&
        typeof s.data_quality.season_stats_present === "boolean"
    );
    check(
      "snapshot.active_injuries has all 4 fields",
      typeof s.active_injuries.home_starter_out === "boolean" &&
        typeof s.active_injuries.away_starter_out === "boolean" &&
        typeof s.active_injuries.home_top3_hitters_injured_count === "number" &&
        typeof s.active_injuries.away_top3_hitters_injured_count === "number"
    );
    check(
      "snapshot.home_lineup_top8 is an array (possibly empty if lineups not posted)",
      Array.isArray(s.home_lineup_top8)
    );
    check(
      "snapshot.away_lineup_top8 is an array",
      Array.isArray(s.away_lineup_top8)
    );

    // Honest null discipline
    check(
      "snapshot.home_team.season_runs_per_game is null (V1: no team_season_stats table)",
      s.home_team.season_runs_per_game === null
    );
    check(
      "snapshot.away_team.season_runs_per_game is null (V1)",
      s.away_team.season_runs_per_game === null
    );
    if (s.home_starter !== null) {
      check(
        "home_starter.last30_era is null (V1: no rolling 30-day table)",
        s.home_starter.last30_era === null
      );
      check(
        "home_starter.first_inning_era is null (V1: no BDL plays integration)",
        s.home_starter.first_inning_era === null
      );
    } else {
      console.log("  ! home_starter is null (probable starter not posted)");
    }

    // Sharp snapshot — Phase 1.6 enriched fields
    if (s.sharp !== null) {
      check(
        "sharp.public_betting_pct_home is present (may be null if no ML row from /splits)",
        "public_betting_pct_home" in s.sharp
      );
      check(
        "sharp.public_money_pct_home is present",
        "public_money_pct_home" in s.sharp
      );
    } else {
      console.log("  ! sharp is null (no sharp_signals rows for game)");
    }

    // Listed total — derived from priority chain
    check(
      "snapshot.market.listed_total is number-or-null (honest fallback)",
      s.market.listed_total === null ||
        typeof s.market.listed_total === "number"
    );

    // If lineups are posted, top-8 should be ordered by batting_position
    if (s.home_lineup_top8.length >= 2) {
      const positions = s.home_lineup_top8
        .map((b) => b.batting_position)
        .filter((p): p is number => p !== null);
      let sorted = true;
      for (let i = 1; i < positions.length; i++) {
        if (positions[i]! < positions[i - 1]!) {
          sorted = false;
          break;
        }
      }
      check(
        "home_lineup_top8 is sorted by batting_position ascending",
        sorted
      );
    }
  } else {
    section(
      `(No MLB games on slate ${today} — DB integration tests for non-empty slate skipped. The 'no-write' proof above still ran.)`
    );
  }

  // ── Phase 3.x.1 — FI columns flow through SELECT ───────────────
  section("Phase 3.x.1 first-inning column read path");
  {
    // Exercise the same SELECT shape featureSnapshot uses. Confirms the
    // new FI columns are in the projection and that the 2 backfilled
    // fixtures (Crochet 6272 / Bradish 6274) return populated values.
    const { data, error } = await supabase
      .from("player_season_stats")
      .select(
        "player_id, season, season_type, pitching_era, pitching_whip, pitching_k_per_9, " +
          "batting_obp, batting_slg, batting_ops, " +
          "first_inning_era, first_inning_starts"
      )
      .in("player_id", [6272, 6274, 6271])
      .eq("season", 2025)
      .eq("season_type", "regular");
    check(
      "SELECT including FI columns succeeds",
      error === null,
      error?.message
    );
    const rows = ((data ?? []) as unknown) as Array<{
      player_id: number;
      first_inning_era: number | null;
      first_inning_starts: number | null;
      pitching_era: number | null;
    }>;
    const crochet = rows.find((r) => r.player_id === 6272);
    const bradish = rows.find((r) => r.player_id === 6274);
    const cole = rows.find((r) => r.player_id === 6271);
    check(
      "Crochet (6272) FI columns populated by Phase 3.x.0d backfill",
      crochet !== undefined &&
        Number(crochet.first_inning_era) === 2.25 &&
        crochet.first_inning_starts === 32
    );
    check(
      "Bradish (6274) FI columns populated by Phase 3.x.0d backfill",
      bradish !== undefined &&
        Number(bradish.first_inning_era) === 4.5 &&
        bradish.first_inning_starts === 6
    );
    check(
      "non-backfilled pitcher's FI columns remain NULL (cleanly handled)",
      cole === undefined ||
        (cole.first_inning_era === null && cole.first_inning_starts === null)
    );
    check(
      "Crochet's pitching_era preserved (non-FI columns untouched by 3.x.0d)",
      crochet !== undefined && crochet.pitching_era !== null
    );
  }

  // ── Summary ────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All feature-snapshot tests passed.`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
