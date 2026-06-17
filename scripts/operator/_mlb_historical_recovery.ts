/** READ-ONLY — historical recovery map: what model inputs are recoverable
 * for past MLB games (6/7-6/15). Probes each table's columns + date coverage. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07";

async function cols(table: string): Promise<string[]> {
  const { data, error } = await supabase.from(table).select("*").limit(1);
  if (error) return [`ERR:${error.message.slice(0, 40)}`];
  return data && data[0] ? Object.keys(data[0]) : [];
}
async function count(table: string): Promise<number> {
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
  return count ?? -1;
}

async function main(): Promise<void> {
  const tables = ["player_season_stats", "player_splits", "pitcher_pitch_stats", "hitter_pitch_stats", "lineups", "ballparks", "weather_forecasts", "line_history", "lines", "sharp_signals"];
  for (const t of tables) {
    const c = await cols(t);
    const n = await count(t);
    // detect date-ish columns
    const dateCols = c.filter(k => /date|_at|fetched|recorded|forecast|asof|as_of|snapshot|updated/i.test(k));
    console.log(`\n### ${t}  rows=${n}`);
    console.log(`  cols: ${c.slice(0, 24).join(", ")}${c.length > 24 ? " ..." : ""}`);
    console.log(`  date-ish cols: ${dateCols.join(", ") || "(none → likely current-state, overwritten)"}`);
    // for the first date col, show min/max + recent-window coverage
    if (dateCols.length) {
      const dc = dateCols[0];
      const { data: mn } = await supabase.from(t).select(dc).order(dc, { ascending: true }).limit(1);
      const { data: mx } = await supabase.from(t).select(dc).order(dc, { ascending: false }).limit(1);
      const { count: recent } = await supabase.from(t).select("*", { count: "exact", head: true }).gte(dc, START);
      console.log(`  ${dc}: min=${(mn?.[0] as any)?.[dc]} max=${(mx?.[0] as any)?.[dc]}  rows>=${START}: ${recent}`);
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
