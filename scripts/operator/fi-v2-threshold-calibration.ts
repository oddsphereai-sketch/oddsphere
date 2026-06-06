/**
 * Push 3B-3 — FI V2 threshold calibration sweep (read-only).
 *
 * Runs FI V2 ONCE per game across multiple slates, then reclassifies
 * the (posterior_p_nrfi, tier, edge_pct, fi_play_grade inputs) under
 * different Toss-Up bands so we can compare distributions without
 * re-running the whole model. Pure read-only.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/fi-v2-threshold-calibration.ts \
 *     --dates 2026-06-04,2026-06-05,2026-06-06
 *
 * NO DB writes, no provider calls beyond what the shadow does, no
 * model logic changes.
 */

import { supabase } from "../../lib/db/supabase";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbFirstInningModelV2 } from "../../lib/automodel/mlbFirstInningModelV2";
import type { FiLineRow } from "../../lib/automodel/mlbFirstInningMarketBaseline";

const BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: "current 45-55", min: 0.45, max: 0.55 },
  { label: "narrow 48-52", min: 0.48, max: 0.52 },
  { label: "narrow 48.5-51.5", min: 0.485, max: 0.515 },
  { label: "tight 49-51", min: 0.49, max: 0.51 },
];

// Adaptive: high tier gets the tightest band, low tier the widest
const ADAPTIVE_BANDS: Record<string, { min: number; max: number }> = {
  high: { min: 0.49, max: 0.51 },
  medium: { min: 0.485, max: 0.515 },
  low: { min: 0.48, max: 0.52 },
  fallback: { min: 0.45, max: 0.55 }, // will get Held anyway
};

type RawGame = {
  date: string;
  matchup: string;
  posterior_p_nrfi: number;
  posterior_p_yrfi: number;
  market_p_nrfi: number | null;
  tier: string;
  provisional: boolean;
  has_market: boolean;
  original_pick: string;
  original_play_grade: string;
  original_ba_eligible: boolean;
  fi_edge_pct: number | null;
};

function parseArgs(argv: string[]): { dates: string[] } {
  let dates = "2026-06-04,2026-06-05,2026-06-06";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dates" && argv[i + 1]) dates = argv[++i]!;
  }
  return { dates: dates.split(",").map((s) => s.trim()) };
}

function reclassify(
  posteriorNrfi: number,
  tier: string,
  feature_audit_missing_count: number,
  band: { min: number; max: number },
): { pick: "NRFI" | "YRFI" | "Toss-Up" | "Held"; reason: string } {
  if (tier === "fallback" || feature_audit_missing_count >= 6) {
    return { pick: "Held", reason: "fallback or severe missing" };
  }
  if (posteriorNrfi >= band.max) {
    return { pick: "NRFI", reason: `≥${band.max.toFixed(3)}` };
  }
  if (posteriorNrfi <= band.min) {
    return { pick: "YRFI", reason: `≤${band.min.toFixed(3)}` };
  }
  return { pick: "Toss-Up", reason: "in band" };
}

function gradeAfterPick(
  pick: string,
  posteriorNrfi: number,
  posterior_yrfi: number,
  marketNrfi: number | null,
  tier: string,
  hasMarket: boolean,
  provisional: boolean,
  feature_audit_missing_count: number,
): { grade: string; ba: boolean } {
  // Mirror the play-grade logic but with the new pick
  const keyMissing = feature_audit_missing_count >= 4;
  if (pick === "Held") return { grade: "held", ba: false };
  if (pick === "Toss-Up") return { grade: "toss_up", ba: false };
  if (!hasMarket || marketNrfi === null) return { grade: "lean", ba: false };
  const pickSidePost = pick === "NRFI" ? posteriorNrfi : posterior_yrfi;
  const pickSideMkt = pick === "NRFI" ? marketNrfi : 1 - marketNrfi;
  const edge = (pickSidePost - pickSideMkt) * 100;
  // BA threshold 4% edge + tier high + conf 56
  if (provisional || keyMissing || tier === "fallback" || tier === "low") {
    return { grade: "lean", ba: false };
  }
  if (Math.abs(edge) >= 4.0 && tier === "high") {
    return { grade: "best_angle", ba: true };
  }
  if (Math.abs(edge) >= 1.5) return { grade: "lean", ba: false };
  return { grade: "no_bet", ba: false };
}

function tally(games: Array<{ pick: string; grade: string; tier: string; ba: boolean }>): Record<string, number> {
  const out: Record<string, number> = {
    Held: 0, "Toss-Up": 0, NRFI: 0, YRFI: 0,
    best_angle: 0, lean: 0, toss_up: 0, no_bet: 0, held: 0,
  };
  for (const g of games) {
    out[g.pick] = (out[g.pick] ?? 0) + 1;
    out[g.grade] = (out[g.grade] ?? 0) + 1;
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  console.log(`\n━━━ FI V2 threshold calibration · slates: ${opts.dates.join(", ")} ━━━\n`);

  const allRawGames: RawGame[] = [];
  const perDateRaw: Record<string, RawGame[]> = {};
  const perDateAudit: Record<string, Array<{ pick: string; grade: string; tier: string; ba: boolean; posterior: number; market: number | null; missing: number; provisional: boolean; matchup: string }>> = {};

  for (const date of opts.dates) {
    const snaps = await buildFeatureSnapshots("mlb", date);
    if (snaps.length === 0) { console.log(`  ${date}: no games`); continue; }
    const { data: games } = await supabase.from("games").select("id, external_id").eq("slate_date", date).eq("sport", "mlb");
    const dbIdByExt = new Map((games ?? []).map((g) => [g.external_id as number, g.id as number]));
    const dbGameIds = (games ?? []).map((g) => g.id as number);
    const { data: rows } = await supabase
      .from("lines")
      .select("game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at")
      .in("game_id", dbGameIds)
      .eq("market_type", "first_inning_total");
    const linesByGame = new Map<number, FiLineRow[]>();
    for (const r of rows ?? []) {
      const arr = linesByGame.get(r.game_id as number) ?? [];
      arr.push({
        market_type: r.market_type as string,
        sportsbook: r.sportsbook as string,
        side: (r.side as string | null) ?? null,
        line_value: (r.line_value as number | null) ?? null,
        odds_american: (r.odds_american as number | null) ?? null,
        fetched_at: (r.fetched_at as string | null) ?? null,
      });
      linesByGame.set(r.game_id as number, arr);
    }

    perDateRaw[date] = [];
    perDateAudit[date] = [];
    for (const snap of snaps) {
      const dbId = dbIdByExt.get(snap.game_external_id);
      const lines = dbId !== undefined ? linesByGame.get(dbId) ?? [] : [];
      const out = runMlbFirstInningModelV2(snap, lines);
      const a = out.fiV2Audit;
      const matchup = `${snap.away_team.abbreviation}@${snap.home_team.abbreviation}`;
      const raw: RawGame = {
        date, matchup,
        posterior_p_nrfi: a.posterior_p_nrfi,
        posterior_p_yrfi: a.posterior_p_yrfi,
        market_p_nrfi: a.market_nrfi_no_vig,
        tier: a.data_quality_tier,
        provisional: a.provisional,
        has_market: a.market_data_quality === "ok",
        original_pick: a.fi_pick,
        original_play_grade: a.fi_play_grade,
        original_ba_eligible: a.fi_best_angle_eligible,
        fi_edge_pct: a.fi_edge_pct,
      };
      allRawGames.push(raw);
      perDateRaw[date].push(raw);
      perDateAudit[date].push({
        pick: a.fi_pick,
        grade: a.fi_play_grade,
        tier: a.data_quality_tier,
        ba: a.fi_best_angle_eligible,
        posterior: a.posterior_p_nrfi,
        market: a.market_nrfi_no_vig,
        missing: a.feature_audit.missing_count,
        provisional: a.provisional,
        matchup,
      });
    }
  }

  console.log(`Total games sampled across slates: ${allRawGames.length}\n`);

  // ─── Posterior distribution ────────────────────────────────────────
  console.log(`━━━ Posterior P(NRFI) distribution ━━━`);
  const buckets = [0, 0.45, 0.48, 0.485, 0.49, 0.50, 0.51, 0.515, 0.52, 0.55, 1.0];
  const bucketLabels = ["[0, 0.45)", "[0.45, 0.48)", "[0.48, 0.485)", "[0.485, 0.49)", "[0.49, 0.50)", "[0.50, 0.51)", "[0.51, 0.515)", "[0.515, 0.52)", "[0.52, 0.55)", "[0.55, 1.0]"];
  const bucketCounts = new Array(bucketLabels.length).fill(0);
  for (const g of allRawGames) {
    for (let i = 0; i < buckets.length - 1; i++) {
      if (g.posterior_p_nrfi >= buckets[i] && g.posterior_p_nrfi < buckets[i + 1]) { bucketCounts[i]++; break; }
    }
    if (g.posterior_p_nrfi === buckets[buckets.length - 1]) bucketCounts[bucketCounts.length - 1]++;
  }
  for (let i = 0; i < bucketLabels.length; i++) {
    console.log(`  ${bucketLabels[i].padEnd(16)} ${bucketCounts[i]}`);
  }

  // ─── Sweep bands ───────────────────────────────────────────────────
  console.log(`\n━━━ Threshold sweep — pick + play-grade distributions ━━━\n`);
  for (const band of BANDS) {
    console.log(`Band: ${band.label}`);
    const results = allRawGames.map((g) => {
      const reclass = reclassify(g.posterior_p_nrfi, g.tier, 0, band);
      const grade = gradeAfterPick(reclass.pick, g.posterior_p_nrfi, g.posterior_p_yrfi, g.market_p_nrfi, g.tier, g.has_market, g.provisional, 0);
      return { pick: reclass.pick, grade: grade.grade, tier: g.tier, ba: grade.ba };
    });
    const t = tally(results);
    console.log(`  Picks:    NRFI=${t.NRFI}  YRFI=${t.YRFI}  Toss-Up=${t["Toss-Up"]}  Held=${t.Held}`);
    console.log(`  Grades:   best_angle=${t.best_angle}  lean=${t.lean}  toss_up=${t.toss_up}  no_bet=${t.no_bet}  held=${t.held}`);
  }
  console.log(`\nAdaptive (tier-dependent bands: high=49-51, med=48.5-51.5, low=48-52):`);
  {
    const results = allRawGames.map((g) => {
      const band = ADAPTIVE_BANDS[g.tier] ?? ADAPTIVE_BANDS.low;
      const reclass = reclassify(g.posterior_p_nrfi, g.tier, 0, band);
      const grade = gradeAfterPick(reclass.pick, g.posterior_p_nrfi, g.posterior_p_yrfi, g.market_p_nrfi, g.tier, g.has_market, g.provisional, 0);
      return { pick: reclass.pick, grade: grade.grade, tier: g.tier, ba: grade.ba };
    });
    const t = tally(results);
    console.log(`  Picks:    NRFI=${t.NRFI}  YRFI=${t.YRFI}  Toss-Up=${t["Toss-Up"]}  Held=${t.Held}`);
    console.log(`  Grades:   best_angle=${t.best_angle}  lean=${t.lean}  toss_up=${t.toss_up}  no_bet=${t.no_bet}  held=${t.held}`);
  }

  // ─── Per-slate detail for the proposed band (narrow 48.5-51.5) ────
  console.log(`\n━━━ Per-slate detail under proposed band 0.485–0.515 ━━━\n`);
  for (const date of opts.dates) {
    if (!perDateRaw[date]) continue;
    console.log(`▼ ${date} (${perDateRaw[date].length} games)`);
    for (const g of perDateRaw[date]) {
      const reclass = reclassify(g.posterior_p_nrfi, g.tier, 0, { min: 0.485, max: 0.515 });
      const changed = reclass.pick !== g.original_pick ? " [Δ]" : "";
      console.log(`  ${g.matchup.padEnd(10)} post=${(g.posterior_p_nrfi * 100).toFixed(1)}% mkt=${g.market_p_nrfi !== null ? (g.market_p_nrfi * 100).toFixed(1) + "%" : "—"} tier=${g.tier.padEnd(8)} orig=${g.original_pick.padEnd(8)} new=${reclass.pick.padEnd(8)}${changed}`);
    }
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
