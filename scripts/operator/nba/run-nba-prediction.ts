/**
 * Phase 7A — NBA Finals v0a — operator manual run script.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/nba/run-nba-prediction.ts \
 *     --date YYYY-MM-DD          (required)
 *     [--apply]                  (default off; writes ignored in v0a)
 *     [--no-injuries]            (skip ESPN injury fetch even when enabled)
 *     [--json]                   (machine-readable output)
 *
 * v0a posture:
 *   • DRY-RUN by default. --apply is acknowledged but v0a has NO writer
 *     wired in — even with --apply AND NBA_PREDICTION_WRITES_ENABLED=true,
 *     this script will NOT write to the DB. The flag is reserved for a
 *     future v0b where a writer is added (and gated by both keys).
 *   • Reads NBA games from the DB for the date, builds snapshots (with
 *     ESPN injury fetch unless --no-injuries), runs the model, prints
 *     structured output to stdout.
 *
 * Internal-only — do not point member-facing flows at this script.
 */

import { buildNbaFeatureSnapshots } from "../../../lib/services/nba/featureSnapshot";
import { fetchEspnNbaInjuries, isInjuryIngestEnabled } from "../../../lib/services/nba/espnNbaInjuries";
import { runNbaAutoModelV1 } from "../../../lib/automodel/nba/nbaAutoModelV1";
import type { NbaModelStage } from "../../../lib/automodel/nba/types";

function readStringFlag(argv: readonly string[], name: string): string | undefined {
  const eq = `${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === name) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return undefined;
      return next;
    }
    if (a.startsWith(eq)) return a.slice(eq.length);
  }
  return undefined;
}

function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const date = readStringFlag(argv, "--date");
  if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(
      "✗ Required: --date YYYY-MM-DD (e.g. --date 2026-06-08)",
    );
    process.exit(1);
  }
  const apply = hasFlag(argv, "--apply");
  const skipInjuries = hasFlag(argv, "--no-injuries");
  const json = hasFlag(argv, "--json");
  const stage: NbaModelStage = "t60_locked";

  const writesEnabled = process.env.NBA_PREDICTION_WRITES_ENABLED === "true";
  const wouldWrite = apply && writesEnabled;

  if (!json) {
    console.log(
      `[nba-v0a] date=${date} stage=${stage} apply=${apply} writes_enabled=${writesEnabled} would_write=${wouldWrite} injury_fetch=${!skipInjuries && isInjuryIngestEnabled()}`,
    );
    if (apply) {
      console.log(
        "[nba-v0a] NOTE: --apply acknowledged but v0a has NO writer wired in. Output is dry-run only.",
      );
    }
  }

  const injuryResolver = skipInjuries
    ? undefined
    : async (opts: { teamAbbreviation: string; teamExternalId: number }) => {
        const result = await fetchEspnNbaInjuries(opts.teamAbbreviation);
        return result === null ? null : result.players;
      };

  const snapshots = await buildNbaFeatureSnapshots(date, { injuryResolver });
  if (snapshots.length === 0) {
    if (json) {
      console.log(JSON.stringify({ date, games: [], note: "No NBA games found for slate." }, null, 2));
    } else {
      console.log(`[nba-v0a] No NBA games found in DB for ${date}.`);
    }
    return;
  }

  const outputs = snapshots.map((s) => runNbaAutoModelV1(s, stage));

  if (json) {
    console.log(JSON.stringify({ date, count: outputs.length, predictions: outputs }, null, 2));
    return;
  }

  // Text format — operator-friendly grid
  console.log(`\n━━━ NBA v0a predictions · ${date} · ${outputs.length} game(s) ━━━\n`);
  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i]!;
    const snap = snapshots[i]!;
    const series = snap.series;
    console.log(
      `Game ${o.game_external_id}  ${snap.away_team.abbreviation} @ ${snap.home_team.abbreviation}`,
    );
    console.log(
      `  Series: G${series?.game_number ?? "?"}  ${series?.series_score_home ?? 0}-${series?.series_score_away ?? 0} (home perspective)  rest:H=${series?.days_rest_home ?? "?"}/A=${series?.days_rest_away ?? "?"}  venue_shift=${series?.venue_shift ?? false}`,
    );
    console.log(
      `  Tier: ${o.audit.data_quality_tier}  ceiling=${o.audit.confidence_ceiling}  trust_indep=${o.audit.trust_independent.toFixed(2)}`,
    );
    console.log(
      `  Score: ${snap.away_team.abbreviation} ${o.predicted_away_score}  @  ${snap.home_team.abbreviation} ${o.predicted_home_score}  total=${o.predicted_total}  spread=${o.predicted_spread_home}`,
    );
    console.log(
      `  ML: ${o.predicted_ml_winner}  conf=${o.ml_confidence}  best_angle=${o.audit.ml_best_angle_eligible}`,
    );
    console.log(
      `  SPREAD: ${o.predicted_spread_side}  conf=${o.spread_confidence}`,
    );
    console.log(
      `  TOTAL: ${o.predicted_total_side}  conf=${o.total_confidence}`,
    );
    console.log(
      `  injuries: home_unknown=${o.audit.injury_unknown_count_home} home_out=${o.audit.injury_out_count_home}  away_unknown=${o.audit.injury_unknown_count_away} away_out=${o.audit.injury_out_count_away}`,
    );
    if (o.audit.model_integrity_notes.length > 0) {
      console.log(`  Notes:`);
      for (const n of o.audit.model_integrity_notes) console.log(`    • ${n}`);
    }
    console.log();
  }
  console.log(`[nba-v0a] PROVISIONAL — INTERNAL ADMIN PREVIEW ONLY — DO NOT EXPOSE TO MEMBERS.\n`);
}

main().catch((err) => {
  console.error("[nba-v0a] FATAL:", err?.message ?? err);
  process.exit(1);
});
