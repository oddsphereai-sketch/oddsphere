/**
 * Read-only audit: for each locked MLB record today, list what IS
 * captured in snapshot_json vs what the route is currently free to
 * pull from live tables for the same game.
 */
import { createClient } from "@supabase/supabase-js";
const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const { data: recs } = await sb.from("prediction_records")
    .select("id, game_id, market, pick, side, no_bet, play_grade, best_angle, confidence, odds_american, line_value, locked_at, snapshot_json, model_probability, market_probability, edge")
    .eq("sport", "mlb").eq("slate_date", ET_TODAY)
    .in("market", ["moneyline", "total"]).order("game_id").order("market");
  if (!recs?.length) { console.log("no rows"); return; }
  const gameIds = Array.from(new Set(recs.map(r => r.game_id)));
  const { data: games } = await sb.from("games")
    .select("id, status, home_score, away_score").in("id", gameIds);
  const gameMap = new Map((games ?? []).map((g: any) => [g.id, g]));

  console.log(`\n═══════ Daily Edge lock audit · ${ET_TODAY} ═══════\n`);
  console.log("rec game  mkt  pick locked? status  has snapshot fields:");
  let hasPublicSplits = 0, hasLineMovement = 0, hasDataIntegrity = 0, hasV22 = 0, total = 0;
  for (const r of recs) {
    total++;
    const g = gameMap.get(r.game_id);
    const sp = r.snapshot_json ?? {};
    const flags = {
      v22: !!sp.v2_2_audit,
      public_splits: Array.isArray(sp.public_splits) && sp.public_splits.length > 0,
      line_movement: !!sp.line_movement && typeof sp.line_movement === "object",
      data_integrity: !!sp.data_integrity,
      fi_v2_audit: !!sp.fi_v2_audit,
    };
    if (flags.v22) hasV22++;
    if (flags.public_splits) hasPublicSplits++;
    if (flags.line_movement) hasLineMovement++;
    if (flags.data_integrity) hasDataIntegrity++;
    const status = g?.status ?? "?";
    const lock = r.locked_at?.slice(11, 19) ?? "no";
    console.log(`${String(r.id).padStart(3)} ${r.game_id} ${r.market.slice(0,4).padEnd(4)} ${(r.pick ?? "?").padEnd(5)} ${lock.padEnd(8)} ${status.padEnd(18)} v22=${flags.v22} splits=${flags.public_splits} line_mvmt=${flags.line_movement} data_int=${flags.data_integrity}`);
  }
  console.log(`\nSummary across ${total} ML/OU rows today:`);
  console.log(`  v2_2_audit present:    ${hasV22}/${total}`);
  console.log(`  public_splits present: ${hasPublicSplits}/${total}`);
  console.log(`  line_movement present: ${hasLineMovement}/${total}`);
  console.log(`  data_integrity present: ${hasDataIntegrity}/${total}`);
}
main();
