/**
 * Push 3B — FI V2 shadow operator (read-only).
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/first-inning-v2-shadow.ts --date 2026-06-06
 *
 * READ-ONLY. Runs FI V2 against every MLB game on the supplied slate
 * and emits a per-game table + aggregate report. No DB writes. No
 * prediction changes. No model_used change.
 *
 * Pulls the slate's `first_inning_total` lines and passes them to the
 * model as the market baseline.
 */

import { supabase } from "../../lib/db/supabase";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbFirstInningModelV2 } from "../../lib/automodel/mlbFirstInningModelV2";
import type { FiLineRow } from "../../lib/automodel/mlbFirstInningMarketBaseline";
import type { Sport } from "../../lib/types/domain/Sport";

function parseArgs(argv: string[]): { sport: Sport; date: string } {
  let date: string | null = null;
  let sport: Sport = "mlb";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
  }
  if (!date) {
    console.error("Usage: first-inning-v2-shadow.ts --date YYYY-MM-DD [--sport mlb]");
    process.exit(1);
  }
  return { sport, date };
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return (n * 100).toFixed(1) + "%";
}
function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(d);
}

async function main() {
  const opts = parseArgs(process.argv);
  console.log(`\n━━━ FI V2 shadow · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`         DRY RUN — READ-ONLY — NO DB WRITES\n`);

  // Load all snapshots once.
  const snapshots = await buildFeatureSnapshots(opts.sport, opts.date);
  console.log(`Loaded ${snapshots.length} snapshots.\n`);
  if (snapshots.length === 0) {
    console.log("No games on slate. Done.");
    return;
  }

  // Load games + FI lines for the slate in one pass.
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id")
    .eq("slate_date", opts.date)
    .eq("sport", opts.sport);
  const dbIdByExt = new Map((games ?? []).map((g) => [g.external_id as number, g.id as number]));
  const dbGameIds = (games ?? []).map((g) => g.id as number);

  const { data: lineRows } = await supabase
    .from("lines")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, updated_at")
    .in("game_id", dbGameIds)
    .eq("market_type", "first_inning_total");
  const linesByGameId = new Map<number, FiLineRow[]>();
  for (const r of lineRows ?? []) {
    const id = r.game_id as number;
    const arr = linesByGameId.get(id) ?? [];
    arr.push({
      market_type: r.market_type as string,
      sportsbook: r.sportsbook as string,
      side: (r.side as string | null) ?? null,
      line_value: (r.line_value as number | null) ?? null,
      odds_american: (r.odds_american as number | null) ?? null,
      updated_at: (r.updated_at as string | null) ?? null,
    });
    linesByGameId.set(id, arr);
  }

  // Per-game header
  console.log("matchup    | tier     | indep N | mkt N   | post N  | pick     | conf | edge   | grade       | reasons");
  console.log("─".repeat(140));

  const pickCounts: Record<string, number> = { NRFI: 0, YRFI: 0, "Toss-Up": 0, Held: 0 };
  const tierCounts: Record<string, number> = {};
  const gradeCounts: Record<string, number> = {};
  let baCount = 0, provisionalCount = 0, marketMissingCount = 0, fallbackTierCount = 0;
  let cappedCount = 0;
  const reasonTotals: Record<string, number> = {};

  for (const snap of snapshots) {
    const dbId = dbIdByExt.get(snap.game_external_id);
    const lines = dbId !== undefined ? linesByGameId.get(dbId) ?? [] : [];
    const out = runMlbFirstInningModelV2(snap, lines);
    const a = out.fiV2Audit;
    const matchup = `${snap.away_team.abbreviation}@${snap.home_team.abbreviation}`;

    pickCounts[a.fi_pick] = (pickCounts[a.fi_pick] ?? 0) + 1;
    tierCounts[a.data_quality_tier] = (tierCounts[a.data_quality_tier] ?? 0) + 1;
    gradeCounts[a.fi_play_grade] = (gradeCounts[a.fi_play_grade] ?? 0) + 1;
    if (a.fi_best_angle_eligible) baCount++;
    if (a.provisional) provisionalCount++;
    if (a.market_data_quality !== "ok") marketMissingCount++;
    if (a.data_quality_tier === "fallback") fallbackTierCount++;
    if (a.posterior_capped) cappedCount++;
    for (const r of a.feature_audit.reason_codes) {
      reasonTotals[r] = (reasonTotals[r] ?? 0) + 1;
    }

    const edge = a.fi_edge_pct === null ? "—" : (a.fi_edge_pct >= 0 ? "+" : "") + a.fi_edge_pct.toFixed(1) + "%";
    const reasons = a.feature_audit.reason_codes.slice(0, 4).join(",").slice(0, 50);
    console.log(
      `${matchup.padEnd(10)} | ${a.data_quality_tier.padEnd(8)} | ${pct(a.independent_p_nrfi).padStart(7)} | ${pct(a.market_nrfi_no_vig).padStart(7)} | ${pct(a.posterior_p_nrfi).padStart(7)} | ${a.fi_pick.padEnd(8)} | ${String(a.fi_confidence).padStart(4)} | ${edge.padStart(6)} | ${a.fi_play_grade.padEnd(11)} | ${reasons}`,
    );
    if (a.integrity_notes.length > 0) {
      console.log(`           | ↳ ${a.integrity_notes.join(" | ")}`);
    }
  }

  console.log(`\n━━━ Aggregate ━━━`);
  console.log(`  Games:                        ${snapshots.length}`);
  console.log(`  Pick distribution:            ${JSON.stringify(pickCounts)}`);
  console.log(`  Tier distribution:            ${JSON.stringify(tierCounts)}`);
  console.log(`  Play grade distribution:      ${JSON.stringify(gradeCounts)}`);
  console.log(`  Best Angle count:             ${baCount}`);
  console.log(`  Provisional:                  ${provisionalCount}`);
  console.log(`  Fallback tier:                ${fallbackTierCount}`);
  console.log(`  Missing FI market:            ${marketMissingCount}`);
  console.log(`  Posterior capped:             ${cappedCount}`);

  console.log(`\n  Reason-code frequencies:`);
  for (const [k, v] of Object.entries(reasonTotals).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${v.toString().padStart(3)} × ${k}`);
  }

  console.log(`\n  READ-ONLY — NO DB WRITES PERFORMED.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
