/**
 * Push 3B-2 — FI market coverage audit operator (read-only).
 *
 * For the requested MLB slate, prints which expected games have
 * first_inning_total market lines in our `lines` table, which books
 * provide them, how many over/under sides per game, and what the
 * no-vig NRFI/YRFI probabilities resolve to via the model's market
 * baseline helper.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/audit-fi-market-coverage.ts \
 *     --sport mlb --date 2026-06-06 [--verbose]
 *
 * READ-ONLY. No DB writes. No model writes. No provider calls.
 */

import { supabase } from "../../lib/db/supabase";
import { computeFiMarketBaseline, type FiLineRow } from "../../lib/automodel/mlbFirstInningMarketBaseline";
import type { Sport } from "../../lib/types/domain/Sport";

function parseArgs(argv: string[]): { sport: Sport; date: string; verbose: boolean } {
  let date: string | null = null;
  let sport: Sport = "mlb";
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--verbose") { verbose = true; continue; }
    if (a === "--apply") { console.error("✗ --apply not supported (read-only operator)."); process.exit(2); }
  }
  if (!date) {
    console.error("Usage: audit-fi-market-coverage.ts --sport mlb --date YYYY-MM-DD [--verbose]");
    process.exit(1);
  }
  return { sport, date, verbose };
}

async function main() {
  const opts = parseArgs(process.argv);
  console.log(`\n━━━ FI MARKET COVERAGE · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`         READ-ONLY · NO DB WRITES\n`);

  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id")
    .eq("slate_date", opts.date)
    .eq("sport", opts.sport)
    .order("game_date");
  if (!games || games.length === 0) {
    console.log("No games on slate. Done.");
    return;
  }
  const { data: teams } = await supabase.from("teams").select("id, abbreviation");
  const abbr = new Map((teams ?? []).map((t) => [t.id as number, t.abbreviation as string]));

  const gameIds = games.map((g) => g.id as number);
  const { data: rows } = await supabase
    .from("lines")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at")
    .in("game_id", gameIds)
    .eq("market_type", "first_inning_total");
  const linesByGame = new Map<number, FiLineRow[]>();
  for (const r of rows ?? []) {
    const arr = linesByGame.get(r.game_id as number) ?? [];
    arr.push({
      market_type: r.market_type as string,
      sportsbook: r.sportsbook as string,
      side: (r.side as string | null) ?? null,
      line_value: (r.line_value as number | null) ?? null,
      odds_american: (r.odds_american as number | null) ?? null,
      fetched_at: (r.fetched_at as string | null) ?? null,
    });
    linesByGame.set(r.game_id as number, arr);
  }

  // Per-game report
  console.log("matchup    | rows | books                          | over/under sides | mkt result | NRFI no-vig | YRFI no-vig | freshness UTC      | reason");
  console.log("─".repeat(170));
  let coveredCount = 0, missingCount = 0, oneSidedCount = 0;
  const bookFreq: Record<string, number> = {};
  for (const g of games) {
    const arr = linesByGame.get(g.id as number) ?? [];
    const matchup = `${abbr.get(g.away_team_id as number) ?? "?"}@${abbr.get(g.home_team_id as number) ?? "?"}`;
    const overs = arr.filter((r) => (r.side ?? "").toLowerCase() === "over").length;
    const unders = arr.filter((r) => (r.side ?? "").toLowerCase() === "under").length;
    const books = Array.from(new Set(arr.map((r) => r.sportsbook.toLowerCase())));
    for (const b of books) bookFreq[b] = (bookFreq[b] ?? 0) + 1;
    const baseline = computeFiMarketBaseline(arr);
    const result = baseline.data_quality;
    if (result === "ok") coveredCount++;
    else if (overs > 0 || unders > 0) oneSidedCount++;
    else missingCount++;
    const nrfi = baseline.nrfi_no_vig_prob !== null ? (baseline.nrfi_no_vig_prob * 100).toFixed(1) + "%" : "—";
    const yrfi = baseline.yrfi_no_vig_prob !== null ? (baseline.yrfi_no_vig_prob * 100).toFixed(1) + "%" : "—";
    const fresh = baseline.freshness ? baseline.freshness.slice(0, 19) : "—";
    console.log(
      `${matchup.padEnd(10)} | ${String(arr.length).padStart(4)} | ${books.join(",").padEnd(30).slice(0, 30)} | ${(overs + "/" + unders).padEnd(16)} | ${result.padEnd(10)} | ${nrfi.padStart(11)} | ${yrfi.padStart(11)} | ${fresh.padEnd(19)} | ${baseline.reason}`,
    );
    if (opts.verbose) {
      for (const r of arr) {
        console.log(`           | sb=${r.sportsbook} side=${r.side} line=${r.line_value} odds=${r.odds_american} fetched=${r.fetched_at}`);
      }
    }
  }

  console.log(`\n━━━ Aggregate ━━━`);
  console.log(`  Total games:            ${games.length}`);
  console.log(`  Covered (over+under):   ${coveredCount}`);
  console.log(`  One-sided only:         ${oneSidedCount}`);
  console.log(`  Missing entirely:       ${missingCount}`);
  console.log(`  Book frequency (games per book):`);
  for (const [k, v] of Object.entries(bookFreq).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(14)} ${v}`);
  }
  console.log(`\nREAD-ONLY — no DB writes performed.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
