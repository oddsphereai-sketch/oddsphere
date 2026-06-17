/** READ-ONLY — MLB Sharp Data Reality Check (P0).
 * Answers: odds freshness, line-movement reconstructability, source coverage,
 * book hierarchy, public-splits reality. No writes. */
import { supabase } from "../../lib/db/supabase";
import { isBlockedSportsbook } from "../../lib/config/blockedSportsbooks";

const START = "2026-06-07";
const now = Date.now();
const ageMin = (iso: string | null) => iso ? (now - new Date(iso).getTime()) / 60000 : null;

async function main() {
  // ===== games in window =====
  const { data: games } = await supabase.from("games")
    .select("id, game_date, slate_date, status")
    .eq("sport", "mlb").gte("slate_date", START).order("slate_date");
  const grows = (games ?? []) as any[];
  const gids = grows.map(g => g.id);
  console.log(`=== MLB games ${START}..now: ${grows.length} (gids ${gids.length}) ===`);

  // ===== 1. ODDS FRESHNESS (lines table) =====
  const linesByGameMkt = new Map<string, any[]>();
  const allBooks = new Map<string, number>();
  for (let i = 0; i < gids.length; i += 100) {
    const { data: ln } = await supabase.from("lines")
      .select("game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at, player_id")
      .in("game_id", gids.slice(i, i + 100) as number[]);
    for (const r of (ln ?? []) as any[]) {
      if (r.player_id != null) continue; // exclude props
      allBooks.set(r.sportsbook, (allBooks.get(r.sportsbook) ?? 0) + 1);
      const k = `${r.game_id}::${r.market_type}`;
      if (!linesByGameMkt.has(k)) linesByGameMkt.set(k, []);
      linesByGameMkt.get(k)!.push(r);
    }
  }
  const freshAges: number[] = [];
  for (const [, rows] of linesByGameMkt) for (const r of rows) { const a = ageMin(r.fetched_at); if (a != null) freshAges.push(a); }
  freshAges.sort((a, b) => a - b);
  const pct = (p: number) => freshAges.length ? freshAges[Math.floor(freshAges.length * p)].toFixed(0) : "—";
  console.log(`\n--- 1. ODDS FRESHNESS (lines.fetched_at age in min, n=${freshAges.length}) ---`);
  console.log(`  median=${pct(0.5)}  p75=${pct(0.75)}  p90=${pct(0.9)}  max=${freshAges.length ? freshAges[freshAges.length-1].toFixed(0) : "—"}`);
  console.log(`  >30min: ${freshAges.filter(a=>a>30).length}  >60min: ${freshAges.filter(a=>a>60).length}  >120min: ${freshAges.filter(a=>a>120).length}`);
  console.log(`  NOTE: includes locked/final games (their odds are intentionally frozen). Freshness only meaningful for UNLOCKED future games:`);
  const futureUnlocked = new Set(grows.filter(g => (new Date(g.game_date).getTime() - 60*60000) > now).map(g => g.id)); // unlocked approx = before T-60
  const futAges: number[] = [];
  for (const [k, rows] of linesByGameMkt) { const gid = Number(k.split("::")[0]); if (!futureUnlocked.has(gid)) continue; for (const r of rows) { const a = ageMin(r.fetched_at); if (a != null) futAges.push(a); } }
  futAges.sort((a,b)=>a-b);
  console.log(`  [future-unlocked only n=${futAges.length}] median=${futAges.length?futAges[Math.floor(futAges.length*0.5)].toFixed(0):"—"} max=${futAges.length?futAges[futAges.length-1].toFixed(0):"—"} >60min=${futAges.filter(a=>a>60).length}`);

  // ===== 2. LINE MOVEMENT RECONSTRUCTABILITY (line_history) =====
  const lhByGameMkt = new Map<string, any[]>();
  let lhTotal = 0, openerFlagged = 0;
  for (let i = 0; i < gids.length; i += 80) {
    const { data: lh } = await supabase.from("line_history")
      .select("game_id, market_type, side, sportsbook, odds_american, line_value, is_opener, recorded_at")
      .in("game_id", gids.slice(i, i + 80) as number[]);
    for (const r of (lh ?? []) as any[]) {
      lhTotal++; if (r.is_opener) openerFlagged++;
      const k = `${r.game_id}::${r.market_type}`;
      if (!lhByGameMkt.has(k)) lhByGameMkt.set(k, []);
      lhByGameMkt.get(k)!.push(r);
    }
  }
  // per ML market: how many distinct timestamps (movement points)?
  const mlKeys = [...lhByGameMkt.keys()].filter(k => k.endsWith("::moneyline"));
  const totKeys = [...lhByGameMkt.keys()].filter(k => k.endsWith("::total"));
  const snapCounts = (keys: string[]) => keys.map(k => new Set(lhByGameMkt.get(k)!.map(r => r.recorded_at)).size);
  const mlSnaps = snapCounts(mlKeys), totSnaps = snapCounts(totKeys);
  const avg = (a: number[]) => a.length ? (a.reduce((x,y)=>x+y,0)/a.length).toFixed(1) : "—";
  console.log(`\n--- 2. LINE MOVEMENT (line_history) ---`);
  console.log(`  total rows=${lhTotal}  is_opener flagged=${openerFlagged} (${lhTotal?(100*openerFlagged/lhTotal).toFixed(0):0}%)`);
  console.log(`  ML markets with history: ${mlKeys.length}/${grows.length} games — avg distinct snapshots/game=${avg(mlSnaps)} (1=single point, no movement reconstructable)`);
  console.log(`  Total markets with history: ${totKeys.length} — avg distinct snapshots/game=${avg(totSnaps)}`);
  console.log(`  ML games with >=2 snapshots (movement visible): ${mlSnaps.filter(c=>c>=2).length}  >=3: ${mlSnaps.filter(c=>c>=3).length}`);

  // ===== 3. SOURCE COVERAGE =====
  console.log(`\n--- 3. SOURCE COVERAGE (% of games) ---`);
  const gWithLines = new Set([...linesByGameMkt.keys()].map(k=>Number(k.split("::")[0])));
  const gWithLH = new Set([...lhByGameMkt.keys()].map(k=>Number(k.split("::")[0])));
  console.log(`  lines: ${gWithLines.size}/${grows.length} (${(100*gWithLines.size/grows.length).toFixed(0)}%)`);
  console.log(`  line_history: ${gWithLH.size}/${grows.length} (${(100*gWithLH.size/grows.length).toFixed(0)}%)`);
  // sharp_signals
  const ssByGame = new Map<number, any[]>();
  let ssPubBets = 0, ssPubMoney = 0, ssSteam = 0, ssRlm = 0, ssPlusEv = 0, ssTotal = 0;
  for (let i = 0; i < gids.length; i += 100) {
    const { data: ss } = await supabase.from("sharp_signals")
      .select("game_id, market_type, side, public_betting_pct, public_money_pct, has_steam_move, has_reverse_line_movement, is_plus_ev, pinnacle_fair_probability, computed_at")
      .in("game_id", gids.slice(i, i+100) as number[]);
    for (const r of (ss ?? []) as any[]) {
      ssTotal++;
      if (r.public_betting_pct != null) ssPubBets++;
      if (r.public_money_pct != null) ssPubMoney++;
      if (r.has_steam_move) ssSteam++;
      if (r.has_reverse_line_movement) ssRlm++;
      if (r.is_plus_ev) ssPlusEv++;
      if (!ssByGame.has(r.game_id)) ssByGame.set(r.game_id, []);
      ssByGame.get(r.game_id)!.push(r);
    }
  }
  console.log(`  sharp_signals: ${ssByGame.size}/${grows.length} (${(100*ssByGame.size/grows.length).toFixed(0)}%) — ${ssTotal} rows`);
  console.log(`    public_betting_pct present: ${ssPubBets}/${ssTotal} (${ssTotal?(100*ssPubBets/ssTotal).toFixed(0):0}%)`);
  console.log(`    public_money_pct present:   ${ssPubMoney}/${ssTotal} (${ssTotal?(100*ssPubMoney/ssTotal).toFixed(0):0}%)`);
  console.log(`    has_steam_move:             ${ssSteam}/${ssTotal} (${ssTotal?(100*ssSteam/ssTotal).toFixed(0):0}%)`);
  console.log(`    has_reverse_line_movement:  ${ssRlm}/${ssTotal} (${ssTotal?(100*ssRlm/ssTotal).toFixed(0):0}%)`);
  console.log(`    is_plus_ev:                 ${ssPlusEv}/${ssTotal} (${ssTotal?(100*ssPlusEv/ssTotal).toFixed(0):0}%)`);
  const ssAges: number[] = [];
  for (const [,rows] of ssByGame) for (const r of rows) { const a = ageMin(r.computed_at); if (a!=null) ssAges.push(a); }
  ssAges.sort((a,b)=>a-b);
  console.log(`    computed_at age (min): median=${ssAges.length?ssAges[Math.floor(ssAges.length*0.5)].toFixed(0):"—"} max=${ssAges.length?ssAges[ssAges.length-1].toFixed(0):"—"}`);

  // ===== 4. BOOK HIERARCHY =====
  console.log(`\n--- 4. BOOK HIERARCHY (sportsbooks seen in lines, by row count) ---`);
  const sortedBooks = [...allBooks.entries()].sort((a,b)=>b[1]-a[1]);
  for (const [b, c] of sortedBooks) console.log(`  ${b.padEnd(22)} ${c}${isBlockedSportsbook(b) ? "  <-- BLOCKED" : ""}`);
  const blockedSeen = sortedBooks.filter(([b])=>isBlockedSportsbook(b));
  console.log(`  blocked books still present in lines: ${blockedSeen.length ? blockedSeen.map(([b])=>b).join(", ") : "NONE ✅"}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
