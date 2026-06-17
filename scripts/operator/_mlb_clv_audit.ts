/** READ-ONLY — Expected CLV audit (Part C). For MLB ML picks: did the line move
 * TOWARD our side (opener→lock) and does that predict wins/ROI? Uses line_history. */
import { supabase } from "../../lib/db/supabase";
import { isBlockedSportsbook } from "../../lib/config/blockedSportsbooks";
const START = "2026-06-07", SIX14 = "2026-06-14";
function impl(o: number): number { return o > 0 ? 100 / (o + 100) : -o / (-o + 100); }
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }

async function main() {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, game_id, pick, odds_american, play_grade, best_angle, launch_day, no_bet, prediction_grades(result)")
    .eq("sport", "mlb").eq("market", "moneyline").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  // line_history for ML, picked side
  const lhByGame = new Map<number, any[]>();
  for (let i = 0; i < gids.length; i += 100) {
    const { data: lh } = await supabase.from("line_history").select("game_id, side, sportsbook, odds_american, recorded_at, is_opener").eq("market_type", "moneyline").in("game_id", gids.slice(i, i + 100) as number[]);
    for (const r of (lh ?? []) as any[]) { if (isBlockedSportsbook(r.sportsbook)) continue; (lhByGame.get(r.game_id) ?? lhByGame.set(r.game_id, []).get(r.game_id)!).push(r); }
  }
  type Row = { date: string; pick: string; odds: number | null; res: string; openImpl: number | null; lockImpl: number | null; clv: number | null };
  const rows: Row[] = [];
  for (const r of recs as any[]) {
    const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    const lh = (lhByGame.get(r.game_id) ?? []).filter((x: any) => x.side === r.pick && x.odds_american != null);
    if (!lh.length) { continue; }
    lh.sort((a: any, b: any) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    const open = lh.find((x: any) => x.is_opener) ?? lh[0];
    const lock = lh[lh.length - 1];
    const openImpl = impl(open.odds_american), lockImpl = impl(lock.odds_american);
    rows.push({ date: String(r.slate_date), pick: r.pick, odds: r.odds_american, res: String(g?.result ?? "").toLowerCase(), openImpl, lockImpl, clv: lockImpl - openImpl });
  }
  const dec = rows.filter(r => r.res === "win" || r.res === "loss");
  console.log(`\n=== EXPECTED-CLV AUDIT (MLB ML, ${dec.length} picks with line_history) ===`);
  function wl(arr: Row[]) { const w = arr.filter(r => r.res === "win").length, l = arr.length - w; let net = 0, n = 0; for (const r of arr) { if (r.odds != null) { n++; net += profit(r.odds, r.res === "win"); } } return `${w}-${l} (${arr.length ? (100 * w / arr.length).toFixed(0) : "--"}%) ${n ? (net >= 0 ? "+" : "") + net.toFixed(1) + "u/" + (100 * net / n).toFixed(0) + "%" : ""}`; }
  // CLV = our side's implied prob rose opener→lock (line moved toward us = positive CLV)
  console.log(`line moved TOWARD pick (CLV>+1pp):  ${wl(dec.filter(r => (r.clv ?? 0) > 0.01))}  [exX ${wl(dec.filter(r => r.date !== SIX14 && (r.clv ?? 0) > 0.01))}]`);
  console.log(`line ~flat (|CLV|<=1pp):             ${wl(dec.filter(r => Math.abs(r.clv ?? 0) <= 0.01))}`);
  console.log(`line moved AGAINST pick (CLV<-1pp):  ${wl(dec.filter(r => (r.clv ?? 0) < -0.01))}  [exX ${wl(dec.filter(r => r.date !== SIX14 && (r.clv ?? 0) < -0.01))}]`);
  const avgClv = dec.reduce((s, r) => s + (r.clv ?? 0), 0) / dec.length;
  console.log(`\navg CLV (our side implied move): ${(100 * avgClv).toFixed(2)}pp  (positive = market moved toward our picks on average = we lead the move)`);
  // does positive CLV correlate with winning?
  const toward = dec.filter(r => (r.clv ?? 0) > 0.01), against = dec.filter(r => (r.clv ?? 0) < -0.01);
  console.log(`\nVERDICT: toward-pick win% ${toward.length ? (100 * toward.filter(r => r.res === "win").length / toward.length).toFixed(0) : "--"} vs against-pick ${against.length ? (100 * against.filter(r => r.res === "win").length / against.length).toFixed(0) : "--"}  (gap = CLV predictive power; small n caveat)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
