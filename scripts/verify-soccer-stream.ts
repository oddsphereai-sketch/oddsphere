/**
 * Verify WC/soccer WebSocket streaming after the Render subscription is added
 * (STREAM_SUBSCRIPTIONS=baseball:mlb,soccer:fifa_world_cup_matches) and the
 * worker redeploys. Read-only.
 *
 *   npx tsx --env-file=.env.local scripts/verify-soccer-stream.ts
 *
 * Checks (per step-7 contract):
 *   • soccer rows in odds_events_raw (+ accepted/unresolved breakdown)
 *   • soccer rows in odds_current_stream
 *   • soccer rows in line_movements
 *   • soccer market_type distribution (match_result/total/btts/double_chance)
 *   • no unresolved-soccer spike
 *   • MLB stream still writing (freshness)
 */
import { supabase } from "../lib/db/supabase";

async function sportOf(gameIds: number[]): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  const ids = Array.from(new Set(gameIds));
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = (await supabase.from("games").select("id, sport").in("id", ids.slice(i, i + 200))) as { data: { id: number; sport: string }[] | null };
    for (const r of data ?? []) m.set(r.id, r.sport);
  }
  return m;
}

async function recent(table: string, tsCol: string, limit = 3000) {
  const { data, error } = (await supabase.from(table).select(`game_id, market_type, side, ${tsCol}`).order(tsCol, { ascending: false }).limit(limit)) as { data: Record<string, unknown>[] | null; error: unknown };
  if (error) { console.log(`  ${table}: ERROR ${(error as { message?: string }).message}`); return [] as Record<string, unknown>[]; }
  return data ?? [];
}

async function main() {
  // 1) odds_events_raw — soccer presence + status breakdown (resolution health).
  console.log("=== odds_events_raw (resolution health) ===");
  {
    const { data } = (await supabase.from("odds_events_raw").select("game_id, sport, status, market_type, created_at").order("created_at", { ascending: false }).limit(4000)) as { data: { game_id: number | null; sport: string | null; status: string; market_type: string | null; created_at: string }[] | null };
    const rows = data ?? [];
    const soccer = rows.filter((r) => (r.sport ?? "").toLowerCase() === "soccer");
    const byStatus = new Map<string, number>();
    for (const r of soccer) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    console.log(`  soccer raw rows (recent 4k): ${soccer.length}`);
    console.log(`  status: ${[...byStatus].map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);
    const unresolved = byStatus.get("unresolved") ?? 0;
    const accepted = byStatus.get("accepted") ?? 0;
    if (unresolved > 0 && unresolved >= accepted) console.log(`  ⚠ UNRESOLVED SPIKE — check SharpAPI team-name spellings vs the alias map (matchSoccerTeamId).`);
  }

  // 2+3) odds_current_stream + line_movements — soccer presence + market dist.
  for (const [table, tsCol] of [["odds_current_stream", "observed_at"], ["line_movements", "moved_at"]] as const) {
    console.log(`\n=== ${table} ===`);
    const rows = await recent(table, tsCol);
    const sportById = await sportOf(rows.map((r) => r.game_id as number));
    const soccer = rows.filter((r) => (sportById.get(r.game_id as number) ?? "") === "soccer");
    const mlb = rows.filter((r) => (sportById.get(r.game_id as number) ?? "") === "mlb");
    const mlbLatest = mlb.map((r) => String(r[tsCol] ?? "")).sort().at(-1) ?? "(none)";
    const soccerLatest = soccer.map((r) => String(r[tsCol] ?? "")).sort().at(-1) ?? "(none)";
    const dist = new Map<string, number>();
    for (const r of soccer) dist.set(String(r.market_type), (dist.get(String(r.market_type)) ?? 0) + 1);
    console.log(`  soccer rows: ${soccer.length}  latest=${soccerLatest}`);
    console.log(`  soccer market_type: ${[...dist].map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);
    for (const want of ["match_result", "total", "btts", "double_chance"]) {
      console.log(`    ${dist.has(want) ? "✓" : "·"} ${want}${dist.has(want) ? "" : " (none yet — ok if book didn't price it)"}`);
    }
    console.log(`  MLB rows: ${mlb.length}  latest=${mlbLatest}  ${mlb.length > 0 ? "✓ MLB still writing" : "⚠ NO MLB — regression?"}`);
  }
  console.log("\nNote: soccer rows only appear after the Render worker redeploys with the new subscription.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
