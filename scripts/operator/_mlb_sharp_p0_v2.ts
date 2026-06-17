/** READ-ONLY — MLB Sharp Data Reality (P0) v2 with full pagination. */
import { supabase } from "../../lib/db/supabase";
import { isBlockedSportsbook } from "../../lib/config/blockedSportsbooks";
const START = "2026-06-07";
const now = Date.now();
const ageMin = (iso: string|null) => iso ? (now - new Date(iso).getTime())/60000 : null;

async function pageAll(table: string, cols: string, gids: number[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < gids.length; i += 40) {
    const chunk = gids.slice(i, i+40);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase.from(table).select(cols).in("game_id", chunk).range(from, from+999);
      if (error) { console.error(`${table} err:`, error.message); break; }
      const rows = (data ?? []) as any[];
      out.push(...rows);
      if (rows.length < 1000) break;
      from += 1000;
    }
  }
  return out;
}

async function main() {
  const { data: games } = await supabase.from("games").select("id, game_date, slate_date, status").eq("sport","mlb").gte("slate_date", START);
  const grows = (games ?? []) as any[];
  const gids = grows.map(g=>g.id);
  const futureUnlocked = new Set(grows.filter(g=>(new Date(g.game_date).getTime()-60*60000)>now).map(g=>g.id));
  console.log(`MLB games ${START}..: ${grows.length}  (future-unlocked: ${futureUnlocked.size})`);

  const lines = (await pageAll("lines","game_id, market_type, sportsbook, side, odds_american, fetched_at, player_id", gids)).filter(r=>r.player_id==null);
  const lh = await pageAll("line_history","game_id, market_type, side, sportsbook, odds_american, is_opener, recorded_at", gids);
  const ss = await pageAll("sharp_signals","game_id, market_type, public_betting_pct, public_money_pct, has_steam_move, has_reverse_line_movement, is_plus_ev, computed_at", gids);
  console.log(`fully paginated: lines=${lines.length}  line_history=${lh.length}  sharp_signals=${ss.length}\n`);

  // coverage
  const setOf = (rows:any[]) => new Set(rows.map(r=>r.game_id));
  console.log(`--- COVERAGE (% of ${grows.length} games) ---`);
  console.log(`  lines:        ${setOf(lines).size} (${(100*setOf(lines).size/grows.length).toFixed(0)}%)`);
  console.log(`  line_history: ${setOf(lh).size} (${(100*setOf(lh).size/grows.length).toFixed(0)}%)`);
  console.log(`  sharp_signals:${setOf(ss).size} (${(100*setOf(ss).size/grows.length).toFixed(0)}%)`);

  // line_history movement reconstructability per ML market
  const lhByGM = new Map<string,any[]>();
  for (const r of lh) { const k=`${r.game_id}::${r.market_type}`; (lhByGM.get(k)??lhByGM.set(k,[]).get(k)!).push(r); }
  const mlKeys=[...lhByGM.keys()].filter(k=>k.endsWith("::moneyline"));
  const snaps=(k:string)=>new Set(lhByGM.get(k)!.map(r=>r.recorded_at)).size;
  const mlSnap=mlKeys.map(snaps);
  const openerFlagged = lh.filter(r=>r.is_opener).length;
  console.log(`\n--- LINE MOVEMENT (line_history) ---`);
  console.log(`  rows=${lh.length}  is_opener flagged=${openerFlagged} (${lh.length?(100*openerFlagged/lh.length).toFixed(0):0}%)`);
  console.log(`  ML markets w/ history: ${mlKeys.length}/${grows.length}  avg snapshots=${mlSnap.length?(mlSnap.reduce((a,b)=>a+b,0)/mlSnap.length).toFixed(1):"—"}`);
  console.log(`  ML games w/ >=2 snapshots: ${mlSnap.filter(c=>c>=2).length}  >=5: ${mlSnap.filter(c=>c>=5).length}`);
  // distinct books per game in line_history (multi-book movement?)
  const lhBooksPerGame = [...setOf(lh)].map(g => new Set(lh.filter(r=>r.game_id===g).map(r=>r.sportsbook)).size);
  console.log(`  distinct books/game in line_history: avg=${lhBooksPerGame.length?(lhBooksPerGame.reduce((a,b)=>a+b,0)/lhBooksPerGame.length).toFixed(1):"—"} max=${lhBooksPerGame.length?Math.max(...lhBooksPerGame):"—"}`);

  // freshness future-unlocked
  const futAges = lines.filter(r=>futureUnlocked.has(r.game_id)).map(r=>ageMin(r.fetched_at)).filter((a):a is number=>a!=null).sort((a,b)=>a-b);
  console.log(`\n--- FRESHNESS (future-unlocked lines, n=${futAges.length}) ---`);
  console.log(`  median=${futAges.length?futAges[Math.floor(futAges.length*.5)].toFixed(0):"—"}min  p90=${futAges.length?futAges[Math.floor(futAges.length*.9)].toFixed(0):"—"}min  max=${futAges.length?futAges[futAges.length-1].toFixed(0):"—"}min  >60min=${futAges.filter(a=>a>60).length}`);

  // sharp_signals quality (future-unlocked subset for freshness)
  const ssF = ss.filter(r=>futureUnlocked.has(r.game_id));
  const cnt=(rows:any[],f:(r:any)=>boolean)=>rows.filter(f).length;
  console.log(`\n--- SHARP_SIGNALS quality (all n=${ss.length}) ---`);
  console.log(`  public_betting_pct: ${(100*cnt(ss,r=>r.public_betting_pct!=null)/ss.length).toFixed(0)}%  public_money_pct: ${(100*cnt(ss,r=>r.public_money_pct!=null)/ss.length).toFixed(0)}%`);
  console.log(`  steam: ${(100*cnt(ss,r=>r.has_steam_move)/ss.length).toFixed(0)}%  rlm: ${(100*cnt(ss,r=>r.has_reverse_line_movement)/ss.length).toFixed(0)}%  is_plus_ev: ${(100*cnt(ss,r=>r.is_plus_ev)/ss.length).toFixed(0)}%`);
  const ssFAges = ssF.map(r=>ageMin(r.computed_at)).filter((a):a is number=>a!=null).sort((a,b)=>a-b);
  console.log(`  [future-unlocked] freshness median=${ssFAges.length?ssFAges[Math.floor(ssFAges.length*.5)].toFixed(0):"—"}min max=${ssFAges.length?ssFAges[ssFAges.length-1].toFixed(0):"—"}min`);

  // book hierarchy full
  const books=new Map<string,number>(); for (const r of lines) books.set(r.sportsbook,(books.get(r.sportsbook)??0)+1);
  console.log(`\n--- BOOKS in lines (full) ---`);
  for (const [b,c] of [...books.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${b.padEnd(20)} ${c}${isBlockedSportsbook(b)?"  <-- BLOCKED":""}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
