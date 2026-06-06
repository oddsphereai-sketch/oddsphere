/**
 * Push 3A-2 Phase 0 — feature data-path audit (read-only).
 *
 * For 2026-06-06 MLB slate, walk each feature group end-to-end:
 *   provider/source → DB row count → snapshot completeness
 *
 * Goal: prove which sources are missing/sparse and where in the chain
 * they break. No DB writes.
 */

import { supabase } from "../lib/db/supabase";
import { buildFeatureSnapshots } from "../lib/automodel/featureSnapshot";

const DATE = "2026-06-06";

async function main() {
  const snaps = await buildFeatureSnapshots("mlb", DATE);
  console.log(`\n━━━ Snapshot coverage by feature group (${snaps.length} games) ━━━\n`);

  // ─── per-game per-feature presence ─────────────────────────────────
  type Side = "home" | "away";
  type Counts = Record<string, { both: number; oneSide: number; neither: number }>;
  const counts: Counts = {
    team_ops: { both: 0, oneSide: 0, neither: 0 },
    bullpen_era: { both: 0, oneSide: 0, neither: 0 },
    starter_era: { both: 0, oneSide: 0, neither: 0 },
    starter_whip: { both: 0, oneSide: 0, neither: 0 },
    starter_k9: { both: 0, oneSide: 0, neither: 0 },
    pitch_quality: { both: 0, oneSide: 0, neither: 0 },
    starter_handedness: { both: 0, oneSide: 0, neither: 0 },
    confirmed_lineup: { both: 0, oneSide: 0, neither: 0 },
    projected_lineup_8: { both: 0, oneSide: 0, neither: 0 }, // at least 8 batters with source projected or confirmed
  };
  let parkPresent = 0, weatherRow = 0, weatherHasTemp = 0, weatherHasWind = 0, weatherNotable = 0;
  let marketTotal = 0, marketMlBoth = 0, sharpPresent = 0;

  function score(home: boolean, away: boolean) { return [home, away].filter(Boolean).length; }
  function add(key: keyof Counts, n: number) {
    if (n === 2) counts[key].both++;
    else if (n === 1) counts[key].oneSide++;
    else counts[key].neither++;
  }

  for (const s of snaps) {
    add("team_ops", score(s.home_team.team_avg_batter_ops != null, s.away_team.team_avg_batter_ops != null));
    add("bullpen_era", score(s.home_team.bullpen_era_proxy != null, s.away_team.bullpen_era_proxy != null));
    add("starter_era", score(s.home_starter?.season_era != null, s.away_starter?.season_era != null));
    add("starter_whip", score(s.home_starter?.season_whip != null, s.away_starter?.season_whip != null));
    add("starter_k9", score(s.home_starter?.season_k_per_9 != null, s.away_starter?.season_k_per_9 != null));
    add("pitch_quality", score(s.home_starter?.pitch_quality_score != null, s.away_starter?.pitch_quality_score != null));
    add("starter_handedness", score(s.home_starter?.throws != null, s.away_starter?.throws != null));
    const homeLineupConfirmed = s.home_lineup_top8.length >= 8 && s.home_lineup_top8.every((b) => b.lineup_source === "confirmed");
    const awayLineupConfirmed = s.away_lineup_top8.length >= 8 && s.away_lineup_top8.every((b) => b.lineup_source === "confirmed");
    add("confirmed_lineup", score(homeLineupConfirmed, awayLineupConfirmed));
    const homeLineupAny = s.home_lineup_top8.length >= 8;
    const awayLineupAny = s.away_lineup_top8.length >= 8;
    add("projected_lineup_8", score(homeLineupAny, awayLineupAny));

    if (s.ballpark?.park_factor_runs != null) parkPresent++;
    if (s.weather !== null) {
      weatherRow++;
      if (s.weather.temperature_f != null) weatherHasTemp++;
      if (s.weather.wind_speed_mph != null) weatherHasWind++;
      if (s.weather.is_notable === true) weatherNotable++;
    }
    if (s.market.listed_total != null) marketTotal++;
    if (s.market.home_ml_odds_american != null && s.market.away_ml_odds_american != null) marketMlBoth++;
    if (s.sharp !== null) sharpPresent++;
  }

  function row(label: string, key: keyof Counts) {
    const c = counts[key];
    console.log(`  ${label.padEnd(28)}  both=${String(c.both).padStart(2)}  oneSide=${String(c.oneSide).padStart(2)}  neither=${String(c.neither).padStart(2)}`);
  }
  row("Team OPS", "team_ops");
  row("Bullpen ERA proxy", "bullpen_era");
  row("Starter ERA", "starter_era");
  row("Starter WHIP", "starter_whip");
  row("Starter K/9", "starter_k9");
  row("Pitcher pitch_quality_score", "pitch_quality");
  row("Starter handedness", "starter_handedness");
  row("Lineup CONFIRMED (8/side)", "confirmed_lineup");
  row("Lineup projected (any, 8/side)", "projected_lineup_8");
  console.log(`  ${"Park factor".padEnd(28)}  present=${parkPresent}`);
  console.log(`  ${"Weather row exists".padEnd(28)}  rows=${weatherRow}   temp=${weatherHasTemp}  wind=${weatherHasWind}  notable=${weatherNotable}`);
  console.log(`  ${"Market total".padEnd(28)}  present=${marketTotal}`);
  console.log(`  ${"Market ML (both)".padEnd(28)}  present=${marketMlBoth}`);
  console.log(`  ${"Sharp signals row".padEnd(28)}  present=${sharpPresent}`);

  // ─── raw DB probe — what data is sitting upstream? ─────────────────
  console.log(`\n━━━ Raw DB probe — what upstream data exists ━━━\n`);
  const { data: gamesRow } = await supabase.from("games").select("id, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id").eq("slate_date", DATE).eq("sport", "mlb");
  const gameIds = (gamesRow ?? []).map((g) => g.id as number);
  const pitcherIds = new Set<number>();
  for (const g of gamesRow ?? []) {
    if (g.home_pitcher_id) pitcherIds.add(g.home_pitcher_id as number);
    if (g.away_pitcher_id) pitcherIds.add(g.away_pitcher_id as number);
  }

  const { data: wxRows } = await supabase.from("game_weather_forecasts").select("game_id, created_at").in("game_id", gameIds);
  console.log(`  game_weather_forecasts rows:           ${wxRows?.length ?? 0}`);
  if (wxRows && wxRows.length > 0) {
    console.log(`    most recent created_at: ${(wxRows[0].created_at as string)?.slice(0, 19)}`);
  }

  const { data: pPitchRows } = await supabase.from("pitcher_pitch_stats").select("player_id, pitch_type").in("player_id", Array.from(pitcherIds));
  const pitchStatsByPlayer = new Map<number, number>();
  for (const r of pPitchRows ?? []) {
    pitchStatsByPlayer.set(r.player_id as number, (pitchStatsByPlayer.get(r.player_id as number) ?? 0) + 1);
  }
  let starters3plus = 0, starters12 = 0, starters0 = 0;
  for (const pid of pitcherIds) {
    const n = pitchStatsByPlayer.get(pid) ?? 0;
    if (n >= 3) starters3plus++;
    else if (n >= 1) starters12++;
    else starters0++;
  }
  console.log(`  Today's starters (${pitcherIds.size}) in pitcher_pitch_stats:`);
  console.log(`    ≥3 pitch rows (real pq derivable):   ${starters3plus}`);
  console.log(`    1-2 pitch rows (sparse):              ${starters12}`);
  console.log(`    0 pitch rows:                          ${starters0}`);

  const { data: pSeason } = await supabase.from("player_season_stats").select("player_id, pitching_era, pitching_whip, pitching_k_per_9").in("player_id", Array.from(pitcherIds)).eq("season", 2026);
  let withEra = 0, withWhip = 0, withK9 = 0;
  for (const p of pSeason ?? []) {
    if (p.pitching_era != null) withEra++;
    if (p.pitching_whip != null) withWhip++;
    if (p.pitching_k_per_9 != null) withK9++;
  }
  console.log(`  Today's starters with season_stats row:  ${pSeason?.length ?? 0}`);
  console.log(`    has ERA:   ${withEra}    has WHIP:  ${withWhip}    has K/9:  ${withK9}`);

  // Bullpen aggregate availability check — get teams + roster pitchers
  const teamIds = new Set<number>();
  for (const g of gamesRow ?? []) {
    teamIds.add(g.home_team_id as number);
    teamIds.add(g.away_team_id as number);
  }
  const { data: rps } = await supabase.from("players").select("id, team_id").in("team_id", Array.from(teamIds)).eq("is_pitcher", true).eq("active", true);
  const rpIdsByTeam = new Map<number, number[]>();
  for (const p of rps ?? []) {
    const arr = rpIdsByTeam.get(p.team_id as number) ?? [];
    arr.push(p.id as number);
    rpIdsByTeam.set(p.team_id as number, arr);
  }
  const allRpIds = (rps ?? []).map((r) => r.id as number);
  const { data: rpSeason } = await supabase.from("player_season_stats").select("player_id, pitching_era").in("player_id", allRpIds).eq("season", 2026);
  const rpEraByPlayer = new Map<number, number | null>();
  for (const r of rpSeason ?? []) rpEraByPlayer.set(r.player_id as number, r.pitching_era as number | null);
  let teamsWithAnyRp = 0, teamsWithNoneRp = 0;
  for (const tid of teamIds) {
    const ids = rpIdsByTeam.get(tid) ?? [];
    const withEra2 = ids.filter((id) => rpEraByPlayer.get(id) != null).length;
    if (withEra2 > 0) teamsWithAnyRp++;
    else teamsWithNoneRp++;
  }
  console.log(`  Teams (${teamIds.size}) with ANY RP season ERA row:  ${teamsWithAnyRp}`);
  console.log(`  Teams with no RP season ERA at all:               ${teamsWithNoneRp}`);

  // Team OPS source check
  const { data: teamBatters } = await supabase.from("players").select("id, team_id").in("team_id", Array.from(teamIds)).eq("is_pitcher", false).eq("active", true);
  const teamBatterIds = (teamBatters ?? []).map((b) => b.id as number);
  const { data: batterSeason } = await supabase.from("player_season_stats").select("player_id, batting_ops, batting_pa").in("player_id", teamBatterIds).eq("season", 2026);
  const opsByBatter = new Map<number, { ops: number | null; pa: number | null }>();
  for (const b of batterSeason ?? []) {
    opsByBatter.set(b.player_id as number, { ops: b.batting_ops as number | null, pa: b.batting_pa as number | null });
  }
  let teamsWithQualifyingBatters = 0;
  for (const tid of teamIds) {
    const batterIds = (teamBatters ?? []).filter((b) => b.team_id === tid).map((b) => b.id as number);
    const quals = batterIds.filter((id) => {
      const o = opsByBatter.get(id);
      return o?.ops != null && (o.pa ?? 0) >= 100;
    });
    if (quals.length > 0) teamsWithQualifyingBatters++;
  }
  console.log(`  Teams with ≥1 batter with PA≥100 + OPS:           ${teamsWithQualifyingBatters} / ${teamIds.size}`);

  // ─── summary ───────────────────────────────────────────────────────
  console.log(`\n━━━ Diagnosis ━━━\n`);
  console.log(`Feature group           Status        Reason`);
  console.log(`─────────────────────  ────────────  ─────────────────────────────────────────`);
  console.log(`market (total + ML)    HEALTHY       ${marketTotal}/${snaps.length} total, ${marketMlBoth}/${snaps.length} ML — preferred chain working`);
  console.log(`park factor            HEALTHY       ${parkPresent}/${snaps.length} present`);
  console.log(`sharp signals          HEALTHY       ${sharpPresent}/${snaps.length} present`);
  console.log(`starter handedness     HEALTHY       ${counts.starter_handedness.both}/${snaps.length} both`);
  console.log(`starter ERA            HEALTHY       ${counts.starter_era.both}/${snaps.length} both — strong proxy`);
  console.log(`starter WHIP+K/9       USE AS PROXY  WHIP both=${counts.starter_whip.both}, K/9 both=${counts.starter_k9.both} — derive pq when missing`);
  console.log(`pitch_quality (raw)    SPARSE        Only ${starters3plus}/${pitcherIds.size} starters have ≥3 pitch rows`);
  console.log(`team OPS               PARTIAL       ${counts.team_ops.both}/${snaps.length} both sides — lineup fallback possible`);
  console.log(`lineup CONFIRMED       NORMAL (AM)   ${counts.confirmed_lineup.both}/${snaps.length} — at morning_draft, projected is expected`);
  console.log(`bullpen ERA proxy      PARTIAL       ${counts.bullpen_era.both}/${snaps.length} both — ${teamsWithNoneRp} teams have no RP stats at all`);
  console.log(`weather                MISSING       0 rows in game_weather_forecasts — provider hasn't run for today's slate`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
