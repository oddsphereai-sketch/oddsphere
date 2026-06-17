/** READ-ONLY — RETROACTIVE feature attribution by joining recoverable context
 * (park factor, weather, lineup-confirmed) to MLB outcomes. Recovers attribution
 * previously declared "data-blocked". Approximate for stats; exact for park/weather/lineup. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14";
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
type Row = { date: string; market: string; side: string | null; odds: number | null; res: string; park: number | null; temp: number | null; wind: number | null; windDir: number | null; lineupConf: number | null; };
function M(rows: Row[]) { const g = rows.filter(r => r.res === "win" || r.res === "loss"); const w = g.filter(r => r.res === "win").length, l = g.length - w; let net = 0, n = 0; for (const r of g) { if (r.odds !== null) { n++; net += profit(r.odds, r.res === "win"); } } return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0 }; }
function L(label: string, rows: Row[]): string { const a = M(rows); const x = M(rows.filter(r => r.date !== SIX14)); const warn = a.t < 12 ? " ⚠sb" : ""; return `  ${label.padEnd(28)} n=${String(a.t).padEnd(3)} ${`${a.w}-${a.l}(${a.t ? a.pct.toFixed(0) : "--"}%)`.padEnd(13)} ${(a.units >= 0 ? "+" : "") + a.units.toFixed(1)}u/${a.roi.toFixed(0)}%  [exX ${x.t ? x.pct.toFixed(0) : "--"}%/${x.roi.toFixed(0)}%]${warn}`; }

async function main(): Promise<void> {
  const { data: recs } = await supabase.from("prediction_records")
    .select("slate_date, game_id, market, side, odds_american, launch_day, no_bet, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const rows0 = (recs ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(rows0.map((r: any) => r.game_id).filter(Boolean))];

  // join games -> home_team -> ballparks (park factor)
  const { data: games } = await supabase.from("games").select("id, home_team_id").in("id", gids as number[]);
  const gameHome = new Map<number, number>(); for (const g of (games ?? []) as any[]) gameHome.set(g.id, g.home_team_id);
  const { data: parks } = await supabase.from("ballparks").select("team_id, park_factor_runs");
  const parkByTeam = new Map<number, number>(); for (const p of (parks ?? []) as any[]) parkByTeam.set(p.team_id, p.park_factor_runs);
  // weather per game (latest forecast per game)
  const { data: wx } = await supabase.from("weather_forecasts").select("game_id, temperature_f, wind_speed_mph, wind_direction_degrees, fetched_at").in("game_id", gids as number[]).order("fetched_at", { ascending: false });
  const wxByGame = new Map<number, any>(); for (const w of (wx ?? []) as any[]) if (!wxByGame.has(w.game_id)) wxByGame.set(w.game_id, w);
  // lineup confirmed count per game
  const { data: lus } = await supabase.from("lineups").select("game_id, is_confirmed").in("game_id", gids as number[]);
  const luByGame = new Map<number, { conf: number; tot: number }>(); for (const lu of (lus ?? []) as any[]) { const e = luByGame.get(lu.game_id) ?? { conf: 0, tot: 0 }; e.tot++; if (lu.is_confirmed) e.conf++; luByGame.set(lu.game_id, e); }

  const rows: Row[] = rows0.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const home = gameHome.get(r.game_id); const w = wxByGame.get(r.game_id); const lu = luByGame.get(r.game_id); return { date: String(r.slate_date), market: String(r.market), side: r.side, odds: r.odds_american, res: String(gr?.result ?? "").toLowerCase(), park: home != null ? parkByTeam.get(home) ?? null : null, temp: w?.temperature_f ?? null, wind: w?.wind_speed_mph ?? null, windDir: w?.wind_direction_degrees ?? null, lineupConf: lu ? lu.conf : null }; });

  const tot = rows.filter(r => r.market === "total");
  const ml = rows.filter(r => r.market === "moneyline");
  console.log(`\n###### RETROACTIVE ATTRIBUTION (recovered joins; n=${rows.length}) ######`);
  console.log(`coverage: park ${rows.filter(r => r.park != null).length}/${rows.length}  weather ${rows.filter(r => r.temp != null).length}/${rows.length}  lineup ${rows.filter(r => r.lineupConf != null).length}/${rows.length}`);

  console.log(`\n== PARK FACTOR vs TOTALS (park_factor_runs: >1 hitter-friendly) ==`);
  console.log(L("park >=1.03 (hitter)", tot.filter(r => r.park != null && r.park >= 1.03)));
  console.log(L("park 0.97-1.03 (neutral)", tot.filter(r => r.park != null && r.park >= 0.97 && r.park < 1.03)));
  console.log(L("park <0.97 (pitcher)", tot.filter(r => r.park != null && r.park < 0.97)));
  console.log("  -- by side in hitter parks --");
  console.log(L("Over in hitter park", tot.filter(r => r.side === "over" && r.park != null && r.park >= 1.03)));
  console.log(L("Under in hitter park", tot.filter(r => r.side === "under" && r.park != null && r.park >= 1.03)));
  console.log(L("Under in pitcher park", tot.filter(r => r.side === "under" && r.park != null && r.park < 0.97)));

  console.log(`\n== WEATHER vs TOTALS ==`);
  console.log(L("temp >=80F", tot.filter(r => r.temp != null && r.temp >= 80)));
  console.log(L("temp 65-80F", tot.filter(r => r.temp != null && r.temp >= 65 && r.temp < 80)));
  console.log(L("temp <65F", tot.filter(r => r.temp != null && r.temp < 65)));
  console.log(L("wind >=12mph", tot.filter(r => r.wind != null && r.wind >= 12)));
  console.log(L("wind <12mph", tot.filter(r => r.wind != null && r.wind < 12)));
  console.log(L("Under + wind>=12", tot.filter(r => r.side === "under" && r.wind != null && r.wind >= 12)));

  console.log(`\n== LINEUP CONFIRMED vs ML/OU ==`);
  console.log(L("lineup conf>=14 (both posted)", rows.filter(r => r.lineupConf != null && r.lineupConf >= 14)));
  console.log(L("lineup conf 1-13 (partial)", rows.filter(r => r.lineupConf != null && r.lineupConf >= 1 && r.lineupConf < 14)));
  console.log(L("lineup conf 0 (none)", rows.filter(r => r.lineupConf === 0)));
  console.log(L("ML lineup conf>=14", ml.filter(r => r.lineupConf != null && r.lineupConf >= 14)));
  console.log(L("ML lineup conf 0", ml.filter(r => r.lineupConf === 0)));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
