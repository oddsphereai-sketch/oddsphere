/**
 * Push 3A-2 Phase 2 — V2.2 feature-coverage audit operator.
 *
 * READ-ONLY. Dry-run by default. Reports per-game what feature data
 * source V2.2 sees for each of the 14 audit positions, plus the reason
 * code that drove the label. Aggregates by group.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/audit-mlb-feature-coverage.ts \
 *     --date YYYY-MM-DD [--sport mlb] [--verbose]
 *
 * Does NOT touch DB, does NOT call model. Pure read of buildFeatureSnapshots
 * + projectIndependent + V2.2 derivations on the snapshot.
 *
 * Use to drive feature pipeline decisions: which groups have the
 * lowest coverage, which need an upstream refresh, etc.
 */

import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { projectIndependent } from "../../lib/automodel/mlbIndependentProjection";
import type { Sport } from "../../lib/types/domain/Sport";

function parseArgs(argv: string[]): { sport: Sport; date: string; verbose: boolean } {
  let date: string | null = null;
  let sport: Sport = "mlb";
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--verbose") { verbose = true; continue; }
    if (a === "--apply") {
      console.error("ERR: --apply not supported. This operator is read-only.");
      process.exit(2);
    }
  }
  if (!date) {
    console.error("Usage: audit-mlb-feature-coverage.ts --date YYYY-MM-DD [--sport mlb] [--verbose]");
    process.exit(1);
  }
  return { sport, date, verbose };
}

function labelSource(s: string): string {
  switch (s) {
    case "preferred": return "✅ pref";
    case "fallback_real": return "🟦 fb_r";
    case "proxy": return "🟨 prxy";
    case "neutral_fallback": return "🟧 neut";
    case "missing": return "🟥 miss";
  }
  return s;
}

async function main() {
  const opts = parseArgs(process.argv);
  console.log(`\n━━━ V2.2 FEATURE COVERAGE · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`         READ-ONLY · NO DB WRITES\n`);

  const snaps = await buildFeatureSnapshots(opts.sport, opts.date);
  console.log(`Loaded ${snaps.length} snapshots.\n`);

  if (snaps.length === 0) {
    console.log("No games on slate. Done.");
    return;
  }

  // Per-game table
  console.log(`Per-game feature source matrix (h/a where applicable):`);
  console.log(`matchup    | team_ops    | bullpen     | starter     | pitch_qual  | hand        | park   | weather | lineup      | tier     | provis | BA-elig | reasons`);
  console.log(`────────── | ─────────── | ─────────── | ─────────── | ─────────── | ─────────── | ────── | ─────── | ─────────── | ──────── | ────── | ─────── | ──────`);

  type FeatureKey = "team_ops" | "bullpen_era" | "starter_era" | "starter_pitch_quality" | "starter_handedness" | "park_factor" | "weather" | "confirmed_lineup";
  type Counts = Record<string, number>;
  const sourceCountsByFeature: Record<string, Counts> = {};
  function bumpFeature(name: string, source: string) {
    const c = sourceCountsByFeature[name] ?? { preferred: 0, fallback_real: 0, proxy: 0, neutral_fallback: 0, missing: 0 };
    c[source] = (c[source] ?? 0) + 1;
    sourceCountsByFeature[name] = c;
  }
  function fmtPair(a: { source: string }, b: { source: string }): string {
    return `${labelSource(a.source)}/${labelSource(b.source)}`;
  }

  let provisionalCount = 0;
  let mlBA = 0, ouBA = 0;
  const tierCounts: Record<string, number> = {};

  for (const s of snaps) {
    const proj = projectIndependent(s);
    const a = proj.feature_audit;
    const matchup = `${s.away_team.abbreviation}@${s.home_team.abbreviation}`;
    bumpFeature("team_ops_h", a.team_ops.home.source);
    bumpFeature("team_ops_a", a.team_ops.away.source);
    bumpFeature("bullpen_h", a.bullpen_era.home.source);
    bumpFeature("bullpen_a", a.bullpen_era.away.source);
    bumpFeature("starter_era_h", a.starter_era.home.source);
    bumpFeature("starter_era_a", a.starter_era.away.source);
    bumpFeature("pitch_quality_h", a.starter_pitch_quality.home.source);
    bumpFeature("pitch_quality_a", a.starter_pitch_quality.away.source);
    bumpFeature("handedness_h", a.starter_handedness.home.source);
    bumpFeature("handedness_a", a.starter_handedness.away.source);
    bumpFeature("park", a.park_factor.source);
    bumpFeature("weather", a.weather.source);
    bumpFeature("lineup_h", a.confirmed_lineup.home.source);
    bumpFeature("lineup_a", a.confirmed_lineup.away.source);

    tierCounts[proj.data_quality_tier] = (tierCounts[proj.data_quality_tier] ?? 0) + 1;

    const reasons = Array.from(new Set([
      a.team_ops.home.reason, a.team_ops.away.reason,
      a.bullpen_era.home.reason, a.bullpen_era.away.reason,
      a.starter_era.home.reason, a.starter_era.away.reason,
      a.starter_pitch_quality.home.reason, a.starter_pitch_quality.away.reason,
      a.park_factor.reason, a.weather.reason,
      a.confirmed_lineup.home.reason, a.confirmed_lineup.away.reason,
    ])).filter((r) => r !== "missing" && r !== "park_ok" && r !== "handedness_ok" && r !== "pq_ok").join(", ");

    console.log(
      `${matchup.padEnd(10)} | ${fmtPair(a.team_ops.home, a.team_ops.away)} | ${fmtPair(a.bullpen_era.home, a.bullpen_era.away)} | ${fmtPair(a.starter_era.home, a.starter_era.away)} | ${fmtPair(a.starter_pitch_quality.home, a.starter_pitch_quality.away)} | ${fmtPair(a.starter_handedness.home, a.starter_handedness.away)} | ${labelSource(a.park_factor.source)} | ${labelSource(a.weather.source)} | ${fmtPair(a.confirmed_lineup.home, a.confirmed_lineup.away)} | ${proj.data_quality_tier.padEnd(8)} | ${a.missing_count >= 7 ? "Y" : " "}      | (run BA via shadow) | ${reasons.slice(0, 80)}`,
    );
    if (a.missing_count >= 7) provisionalCount++;
    void mlBA; void ouBA;
  }

  console.log(`\n━━━ Aggregate (out of ${snaps.length} games × side) ━━━\n`);
  console.log(`Feature group       preferred  fallback_real  proxy  neutral_fb  missing`);
  console.log(`──────────────────  ─────────  ─────────────  ─────  ──────────  ───────`);
  function bothSide(name: string): { preferred: number; fallback_real: number; proxy: number; neutral_fallback: number; missing: number } {
    const h = sourceCountsByFeature[`${name}_h`] ?? {};
    const a = sourceCountsByFeature[`${name}_a`] ?? {};
    return {
      preferred: (h.preferred ?? 0) + (a.preferred ?? 0),
      fallback_real: (h.fallback_real ?? 0) + (a.fallback_real ?? 0),
      proxy: (h.proxy ?? 0) + (a.proxy ?? 0),
      neutral_fallback: (h.neutral_fallback ?? 0) + (a.neutral_fallback ?? 0),
      missing: (h.missing ?? 0) + (a.missing ?? 0),
    };
  }
  function pr(name: string, label: string) {
    const c = bothSide(name);
    console.log(`${label.padEnd(18)}  ${String(c.preferred).padStart(9)}  ${String(c.fallback_real).padStart(13)}  ${String(c.proxy).padStart(5)}  ${String(c.neutral_fallback).padStart(10)}  ${String(c.missing).padStart(7)}`);
  }
  function singleRow(name: string, label: string) {
    const c = sourceCountsByFeature[name] ?? {};
    console.log(`${label.padEnd(18)}  ${String(c.preferred ?? 0).padStart(9)}  ${String(c.fallback_real ?? 0).padStart(13)}  ${String(c.proxy ?? 0).padStart(5)}  ${String(c.neutral_fallback ?? 0).padStart(10)}  ${String(c.missing ?? 0).padStart(7)}`);
  }
  pr("team_ops", "Team OPS");
  pr("bullpen", "Bullpen");
  pr("starter_era", "Starter ERA");
  pr("pitch_quality", "Pitch quality");
  pr("handedness", "Handedness");
  singleRow("park", "Park");
  singleRow("weather", "Weather");
  pr("lineup", "Lineup");

  console.log(`\nTier distribution: ${JSON.stringify(tierCounts)}`);
  console.log(`Provisional (≥7 missing slots): ${provisionalCount} of ${snaps.length}`);

  if (opts.verbose) {
    console.log(`\n━━━ Verbose — per-game reason codes ━━━`);
    for (const s of snaps) {
      const proj = projectIndependent(s);
      const matchup = `${s.away_team.abbreviation}@${s.home_team.abbreviation}`;
      console.log(`  ${matchup}: ${proj.feature_audit.reason_codes.join(", ")}`);
    }
  }

  console.log(`\nREAD-ONLY — no DB writes performed.`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
