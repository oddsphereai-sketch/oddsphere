/**
 * Phase 7C — NBA v0 vs v1 comparison report.
 *
 * Pulls tonight's NBA snapshot(s), runs BOTH v0 and v1, and prints a
 * full per-game per-market delta report including:
 *   • projection deltas (spread, total, ML probability)
 *   • Four Factors per-team breakdown (eFG/TOV/ORB/FT deltas + capped sum)
 *   • recency/playoff blend weights
 *   • injury review notes
 *   • applied confidence caps
 *   • any audit flags exceeded (spread Δ > 2pt, total Δ > 4pt, ML Δ > 5pp,
 *     pick flipped vs v0)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/audit/nba/compare-nba-v0-v1.ts \
 *     --date 2026-06-08
 *
 * READ-ONLY. No DB writes. No network beyond what featureSnapshot does.
 * Admin/audit-only — language tokens like "v1", "research-prior" are
 * appropriate here but must NOT leak to member-facing UI.
 */

import { buildNbaFeatureSnapshotsWithProvenance } from "../../../lib/services/nba/featureSnapshot";
import { fetchEspnNbaInjuries } from "../../../lib/services/nba/espnNbaInjuries";
import { runNbaAutoModelV1 } from "../../../lib/automodel/nba/nbaAutoModelV1";
import { runNbaAutoModelV2 } from "../../../lib/automodel/nba/nbaAutoModelV2";
import { etSlateDateToUtcWindow } from "../../../lib/services/nba/etSlateDate";
import { supabase } from "../../../lib/db/supabase";

function fmt(n: number | null, digits = 2): string {
  if (n === null) return "—";
  return n.toFixed(digits);
}
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0 || i === process.argv.length - 1) return undefined;
  return process.argv[i + 1];
}

async function main(): Promise<void> {
  const date = arg("--date");
  if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("✗ usage: --date YYYY-MM-DD (interpreted as ET slate date)");
    process.exit(1);
  }
  console.log(`[compare-nba-v0-v1] slate=${date} (ET)`);
  console.log("─".repeat(78));

  // Same ET-window logic the API route uses.
  const win = etSlateDateToUtcWindow(date);
  const utcDates = win.startISO.slice(0, 10) === win.endISO.slice(0, 10)
    ? [win.startISO.slice(0, 10)]
    : [win.startISO.slice(0, 10), win.endISO.slice(0, 10)];

  const injuryResolver = async (opts: { teamAbbreviation: string; teamExternalId: number }) => {
    const r = await fetchEspnNbaInjuries(opts.teamAbbreviation);
    return r === null ? null : r.players;
  };

  const seen = new Set<number>();
  type Snap = Awaited<ReturnType<typeof buildNbaFeatureSnapshotsWithProvenance>>["snapshots"][number];
  const snapshots: Snap[] = [];
  for (const d of utcDates) {
    const { snapshots: s } = await buildNbaFeatureSnapshotsWithProvenance(d, { injuryResolver });
    for (const snap of s) {
      if (seen.has(snap.game_external_id)) continue;
      if (snap.game_time_iso !== null) {
        const t = new Date(snap.game_time_iso).getTime();
        const lo = new Date(win.startISO).getTime();
        const hi = new Date(win.endISO).getTime();
        if (t < lo || t > hi) continue;
      }
      seen.add(snap.game_external_id);
      snapshots.push(snap);
    }
  }

  if (snapshots.length === 0) {
    console.log("(no NBA snapshots for this slate)");
    return;
  }

  for (const snap of snapshots) {
    // Pull book count from `lines` to feed v1 sd-inflation
    const { data: gameRow } = await supabase
      .from("games")
      .select("id")
      .eq("external_id", snap.game_external_id)
      .maybeSingle();
    let bookCount = 0;
    if (gameRow !== null) {
      const { data: lineRows } = await supabase
        .from("lines")
        .select("sportsbook")
        .eq("game_id", (gameRow as { id: number }).id)
        .in("market_type", ["moneyline", "spread", "total"]);
      bookCount = new Set((lineRows ?? []).map((l) => (l as { sportsbook: string }).sportsbook)).size;
    }

    const v0 = runNbaAutoModelV1(snap, "t60_locked");
    const v1 = runNbaAutoModelV2(snap, "t60_locked", { isPlayoffs: true, bookCount });

    console.log("");
    console.log(`═══ ${snap.away_team.abbreviation} @ ${snap.home_team.abbreviation} (ext=${snap.game_external_id}) ═══`);
    if (snap.series !== null) {
      console.log(`Series: G${snap.series.game_number}  home_leads_by=${snap.series.home_team_leads_series_by}  venue_shift=${snap.series.venue_shift}`);
    }
    console.log(`Tier: v0=${v0.audit.data_quality_tier}  v1=${v1.audit.data_quality_tier}`);

    console.log("");
    console.log("── Projection ──────────────────────────────────────────");
    console.log(`               ${"v0".padStart(10)} ${"v1".padStart(10)} ${"Δ".padStart(8)}`);
    const dHome = v1.predicted_home_score - v0.predicted_home_score;
    const dAway = v1.predicted_away_score - v0.predicted_away_score;
    const dTotal = v1.predicted_total - v0.predicted_total;
    const dSpread = v1.predicted_spread_home - v0.predicted_spread_home;
    console.log(`  home pts     ${fmt(v0.predicted_home_score).padStart(10)} ${fmt(v1.predicted_home_score).padStart(10)} ${fmt(dHome).padStart(8)}`);
    console.log(`  away pts     ${fmt(v0.predicted_away_score).padStart(10)} ${fmt(v1.predicted_away_score).padStart(10)} ${fmt(dAway).padStart(8)}`);
    console.log(`  total        ${fmt(v0.predicted_total).padStart(10)} ${fmt(v1.predicted_total).padStart(10)} ${fmt(dTotal).padStart(8)}`);
    console.log(`  spread_home  ${fmt(v0.predicted_spread_home).padStart(10)} ${fmt(v1.predicted_spread_home).padStart(10)} ${fmt(dSpread).padStart(8)}`);

    console.log("");
    console.log("── Picks ──────────────────────────────────────────────");
    console.log(`  ML        v0=${v0.predicted_ml_winner}(${fmt(v0.ml_confidence, 1)})   v1=${v1.predicted_ml_winner}(${fmt(v1.ml_confidence, 1)})  ${v0.predicted_ml_winner !== v1.predicted_ml_winner ? "⚠ FLIPPED" : ""}`);
    console.log(`  Spread    v0=${v0.predicted_spread_side}(${fmt(v0.spread_confidence, 1)})   v1=${v1.predicted_spread_side}(${fmt(v1.spread_confidence, 1)})  ${v0.predicted_spread_side !== v1.predicted_spread_side ? "⚠ FLIPPED" : ""}`);
    console.log(`  Total     v0=${v0.predicted_total_side}(${fmt(v0.total_confidence, 1)})   v1=${v1.predicted_total_side}(${fmt(v1.total_confidence, 1)})  ${v0.predicted_total_side !== v1.predicted_total_side ? "⚠ FLIPPED" : ""}`);

    console.log("");
    console.log("── v1 probabilities (independent per market) ──────────");
    const p = v1.v1_probabilities;
    console.log(`  ML(home)        ${fmt(p.ml_home_win_prob * 100, 1)}%  margin_sd_used=${fmt(p.margin_sd_used, 1)}`);
    console.log(`  Spread(home)    ${p.spread_home_cover_prob === null ? "—" : fmt(p.spread_home_cover_prob * 100, 1) + "%"}`);
    console.log(`  Total(over)     ${p.total_over_prob === null ? "—" : fmt(p.total_over_prob * 100, 1) + "%"}  total_sd_used=${fmt(p.total_sd_used, 1)}`);

    console.log("");
    console.log("── v1 Four Factors per team (capped at ±3.0 pp100 per team) ──");
    const b = v1.v1_breakdown;
    const fmtFf = (ff: typeof b.home_ff) => `eFG ${fmt(ff.efg_delta_pp100, 2)}  TOV ${fmt(ff.tov_delta_pp100, 2)}  ORB ${fmt(ff.orb_delta_pp100, 2)}  FT ${fmt(ff.ft_delta_pp100, 2)}  → weighted ${fmt(ff.weighted_pre_cap_pp100, 2)}  capped ${fmt(ff.capped_modifier_pp100, 2)}  factors=${ff.available_factors_count}`;
    console.log(`  ${snap.home_team.abbreviation}:  ${fmtFf(b.home_ff)}`);
    console.log(`  ${snap.away_team.abbreviation}:  ${fmtFf(b.away_ff)}`);

    console.log("");
    console.log("── v1 recency/playoff blend (Bayesian shrinkage K=10) ──");
    console.log(`  ${snap.home_team.abbreviation}: season=${fmt(b.home_recency.season_weight, 2)}  playoff=${fmt(b.home_recency.playoff_weight, 2)}  playoff_games=${b.home_recency.playoff_games}`);
    console.log(`  ${snap.away_team.abbreviation}: season=${fmt(b.away_recency.season_weight, 2)}  playoff=${fmt(b.away_recency.playoff_weight, 2)}  playoff_games=${b.away_recency.playoff_games}`);

    console.log("");
    console.log("── v1 blended ratings used in projection ──────────────");
    console.log(`  ${snap.home_team.abbreviation}: ORtg ${fmt(b.home_off_rating_blended)}  DRtg ${fmt(b.home_def_rating_blended)}  Pace ${fmt(b.pace_home_blended)}  baseline ${fmt(b.home_baseline_pp100)}  final ${fmt(b.home_final_pp100)}`);
    console.log(`  ${snap.away_team.abbreviation}: ORtg ${fmt(b.away_off_rating_blended)}  DRtg ${fmt(b.away_def_rating_blended)}  Pace ${fmt(b.pace_away_blended)}  baseline ${fmt(b.away_baseline_pp100)}  final ${fmt(b.away_final_pp100)}`);

    console.log("");
    console.log("── v1 injury review ───────────────────────────────────");
    console.log(`  OUT players: ${b.injury_review.major_out_count}  UNKNOWN: ${b.injury_review.major_unknown_count}  cap=${b.injury_review.confidence_cap ?? "—"}`);
    for (const r of b.injury_review.reasons) console.log(`    · ${r}`);

    console.log("");
    console.log("── v1 applied confidence caps ─────────────────────────");
    if (b.applied_caps.length === 0) console.log("  (no caps applied)");
    for (const c of b.applied_caps) console.log(`  ${c.source}: ${c.cap}`);

    console.log("");
    console.log("── v0/v1 audit flags ──────────────────────────────────");
    if (v1.v0_v1_delta.flagged.length === 0) console.log("  (no flagged deltas)");
    for (const f of v1.v0_v1_delta.flagged) console.log(`  ⚠ ${f}`);
  }

  console.log("");
  console.log("─".repeat(78));
  console.log("✓ compare-nba-v0-v1 done");
  console.log("  ADMIN/AUDIT-ONLY output. Member-facing UI must not surface 'v0', 'v1',");
  console.log("  'research-prior', 'calibration pending' tokens.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
