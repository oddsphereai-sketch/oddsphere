/**
 * Read-only deep probe for SEA@BAL (game_id=14948).
 * Compare every input the auto-model needs against a working game (BOS@TB).
 */
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const SEABAL = 14948;
const BOSTB = 14949;

async function probe(label: string, gid: number) {
  console.log(`\n─── ${label}  game_id=${gid} ───`);

  const { data: g } = await sb.from("games").select("*").eq("id", gid).maybeSingle();
  console.log(`games: external_id=${(g as any)?.external_id} status=${(g as any)?.status} slate_status=${(g as any)?.slate_status} home_team_id=${(g as any)?.home_team_id} away_team_id=${(g as any)?.away_team_id} game_date=${(g as any)?.game_date} home_pitcher_id=${(g as any)?.home_pitcher_id} away_pitcher_id=${(g as any)?.away_pitcher_id} home_starter_id=${(g as any)?.home_starter_id ?? "?"} away_starter_id=${(g as any)?.away_starter_id ?? "?"}`);

  const { data: pred } = await sb.from("game_predictions").select("id, predicted_ml_winner, ml_confidence, sport_specific, prediction_source").eq("game_id", gid).maybeSingle();
  console.log(`game_predictions: ${pred ? `id=${(pred as any).id} src=${(pred as any).prediction_source}` : "NONE"}`);

  // starter rows
  const homeStarter = (g as any)?.home_starter_id;
  const awayStarter = (g as any)?.away_starter_id;
  if (homeStarter) {
    const { data: hp } = await sb.from("players").select("id, full_name, team_id").eq("id", homeStarter).maybeSingle();
    console.log(`home_starter row: ${hp ? `${(hp as any).full_name} (team_id=${(hp as any).team_id})` : "MISSING"}`);
    const { data: hps } = await sb.from("pitcher_season_stats").select("player_id, era, k_pct, season").eq("player_id", homeStarter).order("season", { ascending: false }).limit(1).maybeSingle();
    console.log(`home_starter pitcher_season_stats: ${hps ? `era=${(hps as any).era} season=${(hps as any).season}` : "MISSING"}`);
  } else {
    console.log(`home_starter_id is null`);
  }
  if (awayStarter) {
    const { data: ap } = await sb.from("players").select("id, full_name, team_id").eq("id", awayStarter).maybeSingle();
    console.log(`away_starter row: ${ap ? `${(ap as any).full_name} (team_id=${(ap as any).team_id})` : "MISSING"}`);
    const { data: aps } = await sb.from("pitcher_season_stats").select("player_id, era, k_pct, season").eq("player_id", awayStarter).order("season", { ascending: false }).limit(1).maybeSingle();
    console.log(`away_starter pitcher_season_stats: ${aps ? `era=${(aps as any).era} season=${(aps as any).season}` : "MISSING"}`);
  } else {
    console.log(`away_starter_id is null`);
  }

  // team stats
  const homeId = (g as any)?.home_team_id;
  const awayId = (g as any)?.away_team_id;
  if (homeId) {
    const { data: hts } = await sb.from("team_stats").select("team_id, season, runs, ops").eq("team_id", homeId).order("season", { ascending: false }).limit(1).maybeSingle();
    console.log(`home team_stats: ${hts ? `team_id=${(hts as any).team_id} season=${(hts as any).season} runs=${(hts as any).runs}` : "MISSING"}`);
  }
  if (awayId) {
    const { data: ats } = await sb.from("team_stats").select("team_id, season, runs, ops").eq("team_id", awayId).order("season", { ascending: false }).limit(1).maybeSingle();
    console.log(`away team_stats: ${ats ? `team_id=${(ats as any).team_id} season=${(ats as any).season} runs=${(ats as any).runs}` : "MISSING"}`);
  }

  // lines / odds
  const { data: lines } = await sb.from("lines").select("market_type, side, sportsbook, odds_american, line_value").eq("game_id", gid).is("player_id", null);
  const mlBooks = (lines ?? []).filter((l: any) => l.market_type === "moneyline" && l.odds_american !== null).length;
  const ouBooks = (lines ?? []).filter((l: any) => l.market_type === "total" && l.odds_american !== null).length;
  const fiBooks = (lines ?? []).filter((l: any) => l.market_type === "first_inning_total" && l.odds_american !== null).length;
  console.log(`lines: ml=${mlBooks} books  ou=${ouBooks} books  fi=${fiBooks} books`);

  // weather
  const { data: weather } = await sb.from("game_weather").select("game_id, temperature_f, wind_mph, fetched_at").eq("game_id", gid).maybeSingle();
  console.log(`weather: ${weather ? `temp=${(weather as any).temperature_f}°F wind=${(weather as any).wind_mph}mph fetched=${(weather as any).fetched_at?.slice(0,19)}` : "MISSING"}`);

  // lineups
  const { data: lineups } = await sb.from("game_lineups").select("team_side, confirmed_at, player_id").eq("game_id", gid);
  const lineupCount = (lineups ?? []).length;
  const confirmed = (lineups ?? []).filter((l: any) => l.confirmed_at !== null).length;
  console.log(`lineups: ${lineupCount} rows, confirmed=${confirmed}`);

  // sharp signals
  const { data: signals } = await sb.from("sharp_signals").select("market_type, side").eq("game_id", gid);
  console.log(`sharp_signals: ${(signals ?? []).length} rows`);
}

async function main() {
  console.log("═══════ SEA/BAL deep probe vs working BOS/TB ═══════");
  await probe("SEA@BAL", SEABAL);
  await probe("BOS@TB (working reference)", BOSTB);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
