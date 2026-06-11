/**
 * WC-4 Launch rollback — deletes the soccer rows applied by Phase B + C.
 *
 * Surgical, scoped to sport='soccer'. NEVER touches MLB / NBA / NHL.
 *
 * Order (FK-safe):
 *   1. prediction_records  WHERE sport='soccer' AND model_version='soccer_dixon_coles_v1'
 *                            AND slate_date=<date>
 *   2. games               WHERE sport='soccer' AND external_id IN (<game ext ids>)
 *   3. teams               WHERE sport='soccer' AND external_id IN (<team ext ids>)
 *
 * Read-only by default. Requires --apply to actually delete.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/rollback-soccer-launch.ts \
 *     [--date YYYY-MM-DD] [--apply]
 *
 * Defaults:
 *   --date  today (UTC)
 *   --apply off — DRY-RUN
 */

import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let date = new Date().toISOString().split("T")[0];
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) date = argv[++i];
    else if (argv[i] === "--apply") apply = true;
  }

  const mode = apply ? "APPLY (delete)" : "DRY-RUN (read-only)";
  console.log(`\n═══ SOCCER LAUNCH ROLLBACK — ${new Date().toISOString()} ═══`);
  console.log(`  date=${date}  mode=${mode}\n`);

  // 1. List prediction_records that would be deleted.
  const { data: preds } = await supabase
    .from("prediction_records")
    .select("id, game_id, market, pick, held, hold_reason, slate_date")
    .eq("sport", "soccer")
    .eq("model_version", "soccer_dixon_coles_v1")
    .eq("slate_date", date);
  const predRows = (preds as Array<{ id: number; game_id: number; market: string; pick: string; held: boolean; hold_reason: string | null; slate_date: string }> | null) ?? [];
  console.log(`prediction_records to delete: ${predRows.length}`);
  for (const r of predRows) {
    console.log(`  id=${r.id} game_id=${r.game_id} market=${r.market} pick=${r.pick} held=${r.held} reason=${r.hold_reason ?? "-"}`);
  }

  // 2. List games that would be deleted (any soccer game on this slate_date).
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, slate_date, status, venue")
    .eq("sport", "soccer")
    .eq("slate_date", date);
  const gameRows = (games as Array<{ id: number; external_id: number; slate_date: string; status: string | null; venue: string | null }> | null) ?? [];
  console.log(`\ngames to delete: ${gameRows.length}`);
  for (const r of gameRows) {
    console.log(`  id=${r.id} ext=${r.external_id} slate=${r.slate_date} status=${r.status} venue=${r.venue ?? "-"}`);
  }

  // 3. Teams referenced by those games.
  const teamIds = new Set<number>();
  for (const r of gameRows) {
    // Need home_team_id + away_team_id — fetch separately.
  }
  const { data: gamesFull } = await supabase
    .from("games")
    .select("home_team_id, away_team_id")
    .eq("sport", "soccer")
    .eq("slate_date", date);
  for (const r of (gamesFull as Array<{ home_team_id: number | null; away_team_id: number | null }> | null) ?? []) {
    if (r.home_team_id !== null) teamIds.add(r.home_team_id);
    if (r.away_team_id !== null) teamIds.add(r.away_team_id);
  }
  let teamRows: Array<{ id: number; external_id: number; abbreviation: string; name: string }> = [];
  if (teamIds.size > 0) {
    const { data: teams } = await supabase
      .from("teams")
      .select("id, external_id, abbreviation, name")
      .eq("sport", "soccer")
      .in("id", [...teamIds]);
    teamRows = (teams as Array<{ id: number; external_id: number; abbreviation: string; name: string }> | null) ?? [];
  }
  console.log(`\nteams to delete: ${teamRows.length}`);
  for (const r of teamRows) {
    console.log(`  id=${r.id} ext=${r.external_id} abbr=${r.abbreviation} name=${r.name}`);
  }

  if (!apply) {
    console.log(`\n[dry-run] No deletes performed. Re-run with --apply to execute.`);
    return;
  }

  console.log(`\nDeleting...`);
  // FK-safe order: predictions → games → teams.
  if (predRows.length > 0) {
    const ids = predRows.map((r) => r.id);
    const { error } = await supabase.from("prediction_records").delete().in("id", ids);
    if (error !== null) throw new Error(`delete prediction_records: ${error.message}`);
    console.log(`  ✓ deleted ${predRows.length} prediction_records row(s)`);
  }
  if (gameRows.length > 0) {
    const ids = gameRows.map((r) => r.id);
    const { error } = await supabase.from("games").delete().in("id", ids);
    if (error !== null) throw new Error(`delete games: ${error.message}`);
    console.log(`  ✓ deleted ${gameRows.length} games row(s)`);
  }
  if (teamRows.length > 0) {
    const ids = teamRows.map((r) => r.id);
    const { error } = await supabase.from("teams").delete().in("id", ids);
    if (error !== null) throw new Error(`delete teams: ${error.message}`);
    console.log(`  ✓ deleted ${teamRows.length} teams row(s)`);
  }
  console.log(`\nRollback complete.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
