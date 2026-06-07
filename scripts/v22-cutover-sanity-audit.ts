/**
 * V2.2 cutover sanity audit (read-only).
 *
 * For the 5 game IDs cutover today, recompute V2.2 from scratch, then
 * cross-check every input + output for the suspicious flips reported by
 * the operator (LAA@LAD ML 78% LAA; MIL@COL fallback/provisional).
 *
 * NO writes. Audit only.
 */

import { supabase } from "../lib/db/supabase";
import { buildFeatureSnapshots } from "../lib/automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../lib/automodel/mlbAutoModelV1";
import { runMlbAutoModelV2_2 } from "../lib/automodel/mlbAutoModelV2_2";
import { computeMarketBaseline } from "../lib/automodel/marketPrior";
import { projectIndependent, V22_LEAGUE_AVG_OPS, V22_LEAGUE_AVG_STARTER_ERA, V22_LEAGUE_AVG_BULLPEN_ERA, V22_LEAGUE_AVG_RUNS_PER_GAME, __TEST__ as INDEP_TEST, pitchQualityProxy } from "../lib/automodel/mlbIndependentProjection";

const SLATE = "2026-06-06";
const CUTOVER_EXT_IDS = new Set([5058735, 5058736, 5058737, 5058738, 5058739]);

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return (n * 100).toFixed(1) + "%";
}

async function main() {
  console.log(`\n━━━ V2.2 cutover sanity audit · ${SLATE} ━━━\n`);

  // ─── Load slate snapshots ──────────────────────────────────────────
  const snapshots = await buildFeatureSnapshots("mlb", SLATE);
  const byExt = new Map(snapshots.map((s) => [s.game_external_id, s]));

  // ─── Load games + predictions for cross-check ──────────────────────
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, game_date, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id, status")
    .in("external_id", Array.from(CUTOVER_EXT_IDS));
  const { data: teams } = await supabase.from("teams").select("id, external_id, abbreviation, display_name");
  const teamByDbId = new Map((teams ?? []).map((t) => [t.id as number, t]));

  // Get the cutover prediction rows + prev snapshot
  const gameDbIds = (games ?? []).map((g) => g.id as number);
  const { data: preds } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_home_score, predicted_away_score, predicted_total, sport_specific, locked_at, computed_at")
    .in("game_id", gameDbIds);
  const predByGameId = new Map((preds ?? []).map((p) => [p.game_id as number, p]));

  // ─── Per-game summary table ─────────────────────────────────────────
  console.log(`━━━ Compact per-game table ━━━\n`);
  console.log(`ext       | matchup   | start ET    | home (DB)         | away (DB)         | mkt total | mkt home ml | mkt away ml`);
  console.log(`─`.repeat(160));
  for (const g of games ?? []) {
    const home = teamByDbId.get(g.home_team_id as number);
    const away = teamByDbId.get(g.away_team_id as number);
    const snap = byExt.get(g.external_id as number);
    if (!snap) continue;
    const startEt = new Date(g.game_date as string).toLocaleString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
    });
    const m = snap.market;
    console.log(`${String(g.external_id).padEnd(9)} | ${(`${away?.abbreviation}@${home?.abbreviation}`).padEnd(9)} | ${startEt.padEnd(11)} | ${(home?.display_name + " ("+home?.abbreviation+")").padEnd(17)} | ${(away?.display_name + " ("+away?.abbreviation+")").padEnd(17)} | ${String(m.listed_total).padEnd(9)} | ${String(m.home_ml_odds_american).padEnd(11)} | ${m.away_ml_odds_american}`);
  }

  // ─── Per-game V2.2 recompute + detailed output ──────────────────────
  for (const g of games ?? []) {
    const ext = g.external_id as number;
    const snap = byExt.get(ext);
    if (!snap) continue;
    const home = teamByDbId.get(g.home_team_id as number);
    const away = teamByDbId.get(g.away_team_id as number);
    const matchup = `${away?.abbreviation}@${home?.abbreviation}`;

    const v1 = runMlbAutoModelV1(snap, "morning_draft");
    const v22 = runMlbAutoModelV2_2(snap, v1, "morning_draft");
    const a = v22.v22Audit;

    const cur = predByGameId.get(g.id as number);
    const sp = (cur?.sport_specific as Record<string, unknown> | null) ?? {};
    const prev = sp.prev_v2_1_snapshot as Record<string, unknown> | undefined;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`▼ ext=${ext}  ${matchup}  start=${g.game_date}`);
    console.log(`   home DB: ${home?.display_name} (${home?.abbreviation}) id=${g.home_team_id} ext=${home?.external_id}`);
    console.log(`   away DB: ${away?.display_name} (${away?.abbreviation}) id=${g.away_team_id} ext=${away?.external_id}`);

    // GameSnapshot's own home/away abbreviation cross-check
    console.log(`   snap.home_team.abbreviation=${snap.home_team.abbreviation}  away=${snap.away_team.abbreviation}`);
    if (snap.home_team.abbreviation !== home?.abbreviation || snap.away_team.abbreviation !== away?.abbreviation) {
      console.log(`   ⚠ HOME/AWAY MISMATCH BETWEEN games + snapshot`);
    } else {
      console.log(`   ✓ home/away orientation consistent between games table and GameSnapshot`);
    }

    // Market
    console.log(`\n   ── MARKET ──`);
    console.log(`   listed_total=${snap.market.listed_total}  has_pinnacle_total=${snap.market.has_pinnacle_total}`);
    console.log(`   home_ml_odds_american=${snap.market.home_ml_odds_american}  away_ml_odds_american=${snap.market.away_ml_odds_american}`);
    const marketBaseline = computeMarketBaseline(snap.market, snap.sharp ?? null);
    console.log(`   market home no-vig prob=${pct(marketBaseline.homeNoVigProb)}  away=${pct(marketBaseline.awayNoVigProb)}`);
    console.log(`   market implied home runs=${marketBaseline.homeImpliedTotal?.toFixed(2)}  away=${marketBaseline.awayImpliedTotal?.toFixed(2)}`);
    console.log(`   market data quality=${marketBaseline.dataQuality}`);

    // Starters
    console.log(`\n   ── STARTERS ──`);
    function starterLine(label: string, s: NonNullable<typeof snap>["home_starter"], teamAbbr: string | undefined) {
      if (!s) { console.log(`   ${label} (${teamAbbr}): null`); return; }
      const pq = s.pitch_quality_score;
      const pqProxy = pitchQualityProxy(s);
      console.log(`   ${label} (${teamAbbr}): ${s.player_name}  throws=${s.throws}  era=${s.season_era}  whip=${s.season_whip}  k9=${s.season_k_per_9}  pq=${pq}  pq_proxy=${pqProxy}  confirmed=${s.is_confirmed}  scratched=${s.is_scratched}`);
    }
    starterLine("home_starter", snap.home_starter, home?.abbreviation);
    starterLine("away_starter", snap.away_starter, away?.abbreviation);

    // Verify starter team membership against players table — defensive
    const homePitcherId = g.home_pitcher_id as number | null;
    const awayPitcherId = g.away_pitcher_id as number | null;
    if (homePitcherId || awayPitcherId) {
      const ids = [homePitcherId, awayPitcherId].filter((x): x is number => x !== null);
      const { data: pitcherRows } = await supabase.from("players").select("id, external_id, full_name, team_id").in("id", ids);
      for (const p of pitcherRows ?? []) {
        const role = p.id === homePitcherId ? "home_starter" : "away_starter";
        const expectedTeam = p.id === homePitcherId ? g.home_team_id : g.away_team_id;
        const ok = p.team_id === expectedTeam;
        console.log(`   ${role} players.team_id=${p.team_id} expected=${expectedTeam}  ${ok ? "✓" : "✗ TEAM MISMATCH"}`);
      }
    }

    // Lineups
    console.log(`\n   ── LINEUPS ──`);
    console.log(`   home_lineup_top8 count=${snap.home_lineup_top8.length}  sources=${[...new Set(snap.home_lineup_top8.map((b) => b.lineup_source ?? "?"))].join(",")}`);
    console.log(`   away_lineup_top8 count=${snap.away_lineup_top8.length}  sources=${[...new Set(snap.away_lineup_top8.map((b) => b.lineup_source ?? "?"))].join(",")}`);

    // Offense / bullpen / park / weather
    console.log(`\n   ── OFFENSE/BULLPEN/PARK/WEATHER ──`);
    console.log(`   home team_avg_batter_ops=${snap.home_team.team_avg_batter_ops}  bullpen_era_proxy=${snap.home_team.bullpen_era_proxy}`);
    console.log(`   away team_avg_batter_ops=${snap.away_team.team_avg_batter_ops}  bullpen_era_proxy=${snap.away_team.bullpen_era_proxy}`);
    console.log(`   ballpark.park_factor_runs=${snap.ballpark?.park_factor_runs}`);
    console.log(`   weather=${snap.weather ? `temp=${snap.weather.temperature_f} wind=${snap.weather.wind_speed_mph}@${snap.weather.wind_direction_degrees} notable=${snap.weather.is_notable}` : "(null)"}`);

    // Independent projection — recompute outside V2.2 for transparency
    const proj = projectIndependent(snap);
    console.log(`\n   ── INDEPENDENT PROJECTION (Layer 2) ──`);
    console.log(`   home_offense_factor=${proj.audit_per_team.home.offense.toFixed(3)}  opp_pitcher_factor=${proj.audit_per_team.home.pitcher_factor_opp.toFixed(3)}  opp_bullpen=${proj.audit_per_team.home.bullpen_factor_opp.toFixed(3)}  park=${proj.audit_per_team.home.park.toFixed(3)}  weather=${proj.audit_per_team.home.weather.toFixed(3)}  home_field=${proj.audit_per_team.home.home_field.toFixed(3)}`);
    console.log(`   away_offense_factor=${proj.audit_per_team.away.offense.toFixed(3)}  opp_pitcher_factor=${proj.audit_per_team.away.pitcher_factor_opp.toFixed(3)}  opp_bullpen=${proj.audit_per_team.away.bullpen_factor_opp.toFixed(3)}  park=${proj.audit_per_team.away.park.toFixed(3)}  weather=${proj.audit_per_team.away.weather.toFixed(3)}`);
    console.log(`   independent: home=${proj.home_expected_runs.toFixed(2)} away=${proj.away_expected_runs.toFixed(2)} diff(home-away)=${proj.home_run_diff.toFixed(2)} tier=${proj.data_quality_tier}`);

    // V2.2 final
    console.log(`\n   ── V2.2 FINAL ──`);
    console.log(`   pick: ML=${v22.predicted_ml_winner}/${v22.ml_confidence}  OU=${v22.predicted_ou_side}/${v22.ou_confidence}`);
    console.log(`   projected scores: home=${v22.predicted_home_score.toFixed(2)} away=${v22.predicted_away_score.toFixed(2)} total=${v22.predicted_total.toFixed(2)}`);
    console.log(`   posterior runs: home=${a.posterior_home_runs.toFixed(2)} away=${a.posterior_away_runs.toFixed(2)} diff=${a.posterior_home_diff.toFixed(2)} trust_indep=${a.trust_independent}`);
    console.log(`   capped_by_total=${a.capped_by_total} capped_by_diff=${a.capped_by_diff} provisional=${a.provisional}`);
    console.log(`   tier=${a.data_quality_tier}  reason_codes=${a.feature_reason_codes.join(", ")}`);
    console.log(`   ml model prob=${pct(a.ml_model_prob)}  ml market prob=${pct(a.ml_market_prob)}  ml edge=${a.ml_edge_pct.toFixed(2)}%`);
    console.log(`   ou model prob=${pct(a.ou_model_prob)}  ou market prob=${a.ou_market_prob === null ? "—" : pct(a.ou_market_prob)}  ou edge=${a.ou_edge_pct === null ? "—" : a.ou_edge_pct.toFixed(2) + "%"}`);
    console.log(`   ml play grade=${a.ml_play_grade} BA eligible=${a.ml_best_angle_eligible}`);
    console.log(`   ou play grade=${a.ou_play_grade} BA eligible=${a.ou_best_angle_eligible}`);
    console.log(`   integrity notes: ${a.model_integrity_notes.join(" | ")}`);

    // Sanity: does projected score support the ML pick?
    if (v22.predicted_ml_winner === "home" && v22.predicted_home_score < v22.predicted_away_score) {
      console.log(`   ⚠ SANITY FAIL: predicted home<away but ML pick=home`);
    }
    if (v22.predicted_ml_winner === "away" && v22.predicted_away_score < v22.predicted_home_score) {
      console.log(`   ⚠ SANITY FAIL: predicted away<home but ML pick=away`);
    }

    // OU sanity vs listed total
    if (snap.market.listed_total !== null) {
      if (v22.predicted_ou_side === "over" && v22.predicted_total < snap.market.listed_total) {
        console.log(`   ⚠ SANITY FAIL: predicted_total ${v22.predicted_total.toFixed(2)} < listed_total ${snap.market.listed_total} but OU=over`);
      }
      if (v22.predicted_ou_side === "under" && v22.predicted_total > snap.market.listed_total) {
        console.log(`   ⚠ SANITY FAIL: predicted_total ${v22.predicted_total.toFixed(2)} > listed_total ${snap.market.listed_total} but OU=under`);
      }
    }

    // Compare against PREV V2.1 snapshot
    if (prev) {
      console.log(`\n   ── PREV V2.1 SNAPSHOT (from audit trail) ──`);
      console.log(`   prev ML=${prev.predicted_ml_winner}/${prev.ml_confidence}  OU=${prev.predicted_ou_side}/${prev.ou_confidence}  scores=${prev.predicted_away_score}/${prev.predicted_home_score} total=${prev.predicted_total}`);
    }
  }

  // ─── Global league-anchor reference ────────────────────────────────
  console.log(`\n\n━━━ Reference anchors used by V2.2 ━━━`);
  console.log(`  LEAGUE_AVG_RUNS_PER_GAME=${V22_LEAGUE_AVG_RUNS_PER_GAME}`);
  console.log(`  LEAGUE_AVG_OPS=${V22_LEAGUE_AVG_OPS}`);
  console.log(`  LEAGUE_AVG_STARTER_ERA=${V22_LEAGUE_AVG_STARTER_ERA}`);
  console.log(`  LEAGUE_AVG_BULLPEN_ERA=${V22_LEAGUE_AVG_BULLPEN_ERA}`);
  console.log(`  Factor clamps: 0.70 - 1.35`);
  console.log(`  Home-field run bonus: 0.10 runs/game`);
  console.log(`  Note: pitcher_factor = era/league_avg_era × pitch_quality (0.92-1.08)`);
  console.log(`        Lower ERA → smaller factor → opp team scores fewer runs`);
  console.log(`        Higher ERA → larger factor → opp team scores more runs`);
  void INDEP_TEST;
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
