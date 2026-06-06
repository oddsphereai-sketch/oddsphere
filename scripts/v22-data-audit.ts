/**
 * V2.2 data-path audit (read-only).
 *
 * Goal: for 2026-06-06 MLB slate, prove what's actually in the DB
 * vs what V2.2's feature audit calls "missing".
 */
import { supabase } from "../lib/db/supabase";
import { buildFeatureSnapshots } from "../lib/automodel/featureSnapshot";
import { projectIndependent } from "../lib/automodel/mlbIndependentProjection";

const DATE = "2026-06-06";

function tag(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toFixed(2);
  return String(v);
}

async function main() {
  // ─── 1. Raw DB row probe ───────────────────────────────────────────
  console.log(`\n━━━ Raw DB row probe — ${DATE} ━━━\n`);
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, slate_date, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id")
    .eq("slate_date", DATE)
    .eq("sport", "mlb");
  console.log(`games: ${games?.length ?? 0}`);
  if (!games || games.length === 0) return;
  const gameIds = games.map((g) => g.id as number);
  const teamIds = new Set<number>();
  const pitcherIds = new Set<number>();
  const parkIds = new Set<number>();
  for (const g of games) {
    teamIds.add(g.home_team_id as number);
    teamIds.add(g.away_team_id as number);
    if (g.home_pitcher_id) pitcherIds.add(g.home_pitcher_id as number);
    if (g.away_pitcher_id) pitcherIds.add(g.away_pitcher_id as number);
    if (g.ballpark_id) parkIds.add(g.ballpark_id as number);
  }
  const { data: teams } = await supabase.from("teams").select("id, abbreviation").in("id", Array.from(teamIds));
  const teamAbbrById = new Map((teams ?? []).map((t) => [t.id as number, t.abbreviation as string]));

  // ballparks
  const { data: parks } = await supabase
    .from("ballparks")
    .select("id, park_factor_runs, is_dome")
    .in("id", Array.from(parkIds));
  const parksById = new Map((parks ?? []).map((p) => [p.id as number, p]));

  // weather
  const { data: weather } = await supabase
    .from("game_weather_forecasts")
    .select("game_id, temperature_f, wind_speed_mph, wind_direction_degrees, humidity_pct, is_notable, notable_reason")
    .in("game_id", gameIds);
  const weatherByGame = new Map((weather ?? []).map((w) => [w.game_id as number, w]));

  // lines for each game
  const { data: lines } = await supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, line_value, odds_american")
    .in("game_id", gameIds);
  const linesByGame = new Map<number, typeof lines>();
  for (const l of lines ?? []) {
    const arr = linesByGame.get(l.game_id as number) ?? [];
    arr.push(l);
    linesByGame.set(l.game_id as number, arr as typeof lines);
  }

  // sharp signals for each game
  const { data: sigs } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type, side, pinnacle_fair_probability, is_plus_ev, ev_pct, public_betting_pct, public_money_pct")
    .in("game_id", gameIds);
  const sigsByGame = new Map<number, typeof sigs>();
  for (const s of sigs ?? []) {
    const arr = sigsByGame.get(s.game_id as number) ?? [];
    arr.push(s);
    sigsByGame.set(s.game_id as number, arr as typeof sigs);
  }

  // pitcher stats
  const { data: pSeason } = await supabase
    .from("player_season_stats")
    .select("player_id, season, pitching_era, pitching_whip, pitching_k_per_9, pitching_gs, pitching_ip")
    .in("player_id", Array.from(pitcherIds))
    .eq("season", 2026);
  const pSeasonByPlayer = new Map((pSeason ?? []).map((s) => [s.player_id as number, s]));

  // pitcher pitch stats (for pitch_quality_score)
  const { data: pitchStats } = await supabase
    .from("pitcher_pitch_stats")
    .select("player_id, pitch_type, whiff_rate")
    .in("player_id", Array.from(pitcherIds));
  const pitchStatsByPlayer = new Map<number, typeof pitchStats>();
  for (const ps of pitchStats ?? []) {
    const arr = pitchStatsByPlayer.get(ps.player_id as number) ?? [];
    arr.push(ps);
    pitchStatsByPlayer.set(ps.player_id as number, arr as typeof pitchStats);
  }

  // Team-level bullpen — check both team-stat tables possibilities
  // (we'll check what the snapshot ends up with from buildFeatureSnapshots
  // since the real source of truth is what flows into the model)

  // ─── 2. Snapshot-level audit via featureSnapshot itself ────────────
  console.log(`\n━━━ Snapshot audit (buildFeatureSnapshots → projectIndependent) ━━━\n`);
  const snaps = await buildFeatureSnapshots("mlb", DATE);
  console.log(`snapshots: ${snaps.length}`);
  console.log(
    `Header: matchup | team_ops_h/a | runs/g_h/a | bp_era_h/a | sterERA_h/a | sterPQ_h/a | sterHand_h/a | park | wx | conf_lineup_h/a | mkt_total | mkt_ml_h/a | sharp | tier | provis | miss | present`,
  );
  let totalMiss = 0, totalPres = 0;
  const featureStats = {
    team_ops_present: 0,
    runs_per_game_present: 0,
    bullpen_present: 0,
    starter_era_present: 0,
    starter_pq_present: 0,
    starter_hand_present: 0,
    park_present: 0,
    weather_present: 0,
    lineup_confirmed_present: 0,
    market_present: 0,
    sharp_present: 0,
  };
  for (const s of snaps) {
    const proj = projectIndependent(s);
    const a = proj.feature_audit;
    const opsH = tag(s.home_team.team_avg_batter_ops);
    const opsA = tag(s.away_team.team_avg_batter_ops);
    const rH = tag(s.home_team.season_runs_per_game);
    const rA = tag(s.away_team.season_runs_per_game);
    const bpH = tag(s.home_team.bullpen_era_proxy);
    const bpA = tag(s.away_team.bullpen_era_proxy);
    const seH = tag(s.home_starter?.season_era);
    const seA = tag(s.away_starter?.season_era);
    const pqH = tag(s.home_starter?.pitch_quality_score);
    const pqA = tag(s.away_starter?.pitch_quality_score);
    const thH = s.home_starter?.throws ?? "—";
    const thA = s.away_starter?.throws ?? "—";
    const pf = tag(s.ballpark?.park_factor_runs);
    const wx = s.weather ? `T${tag(s.weather.temperature_f)}/W${tag(s.weather.wind_speed_mph)}@${tag(s.weather.wind_direction_degrees)}` : "—";
    const lh = s.data_quality.lineup_confirmed ? "Y" : "N";
    const mt = tag(s.market.listed_total);
    const mlH = tag(s.market.home_ml_odds_american);
    const mlA = tag(s.market.away_ml_odds_american);
    const sh = s.sharp ? "Y" : "N";
    const matchup = `${s.away_team.abbreviation}@${s.home_team.abbreviation}`;
    console.log(
      `${matchup.padEnd(8)} | ${opsH}/${opsA} | ${rH}/${rA} | ${bpH}/${bpA} | ${seH}/${seA} | ${pqH}/${pqA} | ${thH}/${thA} | ${pf} | ${wx} | ${lh}/${lh} | ${mt} | ${mlH}/${mlA} | ${sh} | ` +
      `tier=${proj.data_quality_tier} miss=${a.missing_count}/14 pres=${a.present_count}`,
    );
    totalMiss += a.missing_count;
    totalPres += a.present_count;
    if (s.home_team.team_avg_batter_ops !== null && s.away_team.team_avg_batter_ops !== null) featureStats.team_ops_present++;
    if (s.home_team.season_runs_per_game !== null && s.away_team.season_runs_per_game !== null) featureStats.runs_per_game_present++;
    if (s.home_team.bullpen_era_proxy !== null && s.away_team.bullpen_era_proxy !== null) featureStats.bullpen_present++;
    if (s.home_starter?.season_era !== null && s.away_starter?.season_era !== null) featureStats.starter_era_present++;
    if (s.home_starter?.pitch_quality_score !== null && s.away_starter?.pitch_quality_score !== null) featureStats.starter_pq_present++;
    if (s.home_starter?.throws !== null && s.away_starter?.throws !== null) featureStats.starter_hand_present++;
    if (s.ballpark?.park_factor_runs !== null) featureStats.park_present++;
    if (s.weather !== null) featureStats.weather_present++;
    if (s.data_quality.lineup_confirmed) featureStats.lineup_confirmed_present++;
    if (s.market.listed_total !== null) featureStats.market_present++;
    if (s.sharp !== null) featureStats.sharp_present++;
  }

  console.log(`\n━━━ Aggregate (out of ${snaps.length} games) ━━━`);
  console.log(`Team OPS both sides present:        ${featureStats.team_ops_present}`);
  console.log(`Team runs/game both sides present:  ${featureStats.runs_per_game_present}  ← featureSnapshot hardcodes null`);
  console.log(`Bullpen ERA both sides present:     ${featureStats.bullpen_present}`);
  console.log(`Starter ERA both sides present:     ${featureStats.starter_era_present}`);
  console.log(`Starter pitch_quality both sides:   ${featureStats.starter_pq_present}`);
  console.log(`Starter handedness both sides:      ${featureStats.starter_hand_present}`);
  console.log(`Park factor present:                ${featureStats.park_present}`);
  console.log(`Weather row present:                ${featureStats.weather_present}`);
  console.log(`Lineup CONFIRMED both sides:        ${featureStats.lineup_confirmed_present}  ← joint AND of both teams`);
  console.log(`Market listed_total present:        ${featureStats.market_present}`);
  console.log(`Sharp signals row present:          ${featureStats.sharp_present}`);
  console.log(`\nAvg missing per game: ${(totalMiss / snaps.length).toFixed(1)} / 16`);
  console.log(`Avg present per game: ${(totalPres / snaps.length).toFixed(1)} / 16`);

  // ─── 3. Raw DB existence vs snapshot pass-through ──────────────────
  console.log(`\n━━━ Raw DB has rows for: ━━━`);
  console.log(`  game_weather_forecasts:      ${weather?.length ?? 0}  (one per game expected)`);
  console.log(`  ballparks lookups:           ${parks?.length ?? 0}`);
  console.log(`  lines rows total:            ${lines?.length ?? 0}`);
  console.log(`  sharp_signals rows total:    ${sigs?.length ?? 0}`);
  console.log(`  player_season_stats (2026):  ${pSeason?.length ?? 0}`);
  console.log(`  pitcher_pitch_stats rows:    ${pitchStats?.length ?? 0}`);

  // weather column completeness probe
  if (weather && weather.length > 0) {
    let tempPres = 0, windPres = 0, dirPres = 0, notable = 0;
    for (const w of weather) {
      if (w.temperature_f !== null) tempPres++;
      if (w.wind_speed_mph !== null) windPres++;
      if (w.wind_direction_degrees !== null) dirPres++;
      if (w.is_notable === true) notable++;
    }
    console.log(`\n  weather column completeness (of ${weather.length} rows):`);
    console.log(`    temperature_f non-null:       ${tempPres}`);
    console.log(`    wind_speed_mph non-null:      ${windPres}`);
    console.log(`    wind_direction_degrees:       ${dirPres}`);
    console.log(`    is_notable=true:              ${notable}`);
  }
  console.log(`  (${parksById.size} ${weatherByGame.size} ${linesByGame.size} ${sigsByGame.size} ${pSeasonByPlayer.size} ${pitchStatsByPlayer.size} ${teamAbbrById.size}) sanity-only`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
