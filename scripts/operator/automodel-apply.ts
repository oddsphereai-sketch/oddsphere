/**
 * Phase 6B.1 — operator script for controlled auto-model apply.
 *
 * USAGE:
 *   Dry-run:
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/automodel-apply.ts --date 2026-06-06 --model v2
 *
 *   Apply (two-key gate):
 *     AUTOMODEL_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/automodel-apply.ts --date 2026-06-06 --model v2 --apply
 *
 * Runs ONLY the M2 step (generatePredictionsForSlate) for a specific
 * slate. Assumes the data layer (S1-S8: games, lines, sharp_signals,
 * starters, season_pitching) has already been written by the cron's
 * morning fires. This is a focused write that:
 *   - reads existing snapshots for the slate
 *   - runs the chosen model version
 *   - upserts game_predictions
 *
 * Does NOT publish, does NOT change slate_status, does NOT touch
 * cron schedule, does NOT activate auto-publish or pregame-sweep.
 *
 * Operator visibility:
 *   - Prints per-game predicted home/away/total + ML + OU + confidence.
 *   - Summary: written count, held count, fallback count, data-quality tier
 *     distribution, Best Angle count.
 *   - For --model v2: includes data-quality tier + provisional + Best Angle
 *     in the per-game output so operator can validate the new behavior.
 *
 * Two-key write gate (Phase 3C convention):
 *   --apply flag AND `AUTOMODEL_DB_WRITES_ENABLED=true` env both required
 *   to actually write. Either missing → dry-run with a clear message.
 */

import { generatePredictionsForSlate } from "../../lib/services/automodelService";
import { resolveEffectiveVersion, type AutomodelVersion } from "../../lib/automodel/modelVersion";
import type { Sport } from "../../lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  model: AutomodelVersion;
  apply: boolean;
};

function parseArgs(argv: string[]): Args {
  let date: string | null = null;
  let sport: Sport = "mlb";
  let model: AutomodelVersion | undefined;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--model" && argv[i + 1]) {
      const v = argv[++i]!.trim().toLowerCase();
      if (v === "v1" || v === "v2" || v === "v2_1" || v === "v2_2" || v === "shadow") model = v;
      continue;
    }
    if (a === "--apply") { apply = true; continue; }
  }
  if (!date) {
    console.error("Usage: automodel-apply.ts --date YYYY-MM-DD [--sport mlb] [--model v1|v2|v2_1|v2_2|shadow] [--apply]");
    process.exit(1);
  }
  // Resolve the effective version once with the same precedence the
  // service uses so the operator's chosen mode is echoed in the banner.
  const effective = resolveEffectiveVersion(model);
  return { sport, date, model: effective, apply };
}

function fmt(n: number | null | undefined, w = 5): string {
  if (n === null || n === undefined) return "—".padStart(w);
  return n.toFixed(1).padStart(w);
}

function pad(s: string | null | undefined, w: number): string {
  return (s ?? "—").padEnd(w);
}

async function main() {
  const opts = parseArgs(process.argv);
  const envWriteEnabled = process.env.AUTOMODEL_DB_WRITES_ENABLED === "true";
  const willWrite = opts.apply && envWriteEnabled;

  console.log(`\n━━━ automodel-apply · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`  model:                       ${opts.model}`);
  console.log(`  --apply flag:                ${opts.apply ? "YES" : "no"}`);
  console.log(`  AUTOMODEL_DB_WRITES_ENABLED: ${envWriteEnabled ? "true" : "missing"}`);
  console.log(`  mode:                        ${willWrite ? "WRITE (will upsert game_predictions)" : "DRY-RUN (no DB writes)"}`);
  if (opts.apply && !envWriteEnabled) {
    console.warn(`  ⚠ --apply was set but AUTOMODEL_DB_WRITES_ENABLED is missing — forcing dry-run.`);
  }
  console.log("");

  const result = await generatePredictionsForSlate(opts.sport, opts.date, "morning_draft", {
    writeToDb: willWrite,
    modelVersion: opts.model,
  });

  // Per-game output
  console.log("matchup    ext            | home / away | total | ML / conf  | OU / conf  | model_used     | tier     | provis | Best Angle");
  console.log("─".repeat(150));
  for (const p of result.predictions) {
    const sp = p.sport_specific as Record<string, unknown>;
    const model_used = (sp.model_used as string) ?? "v1";
    const tier = ((sp.v2_data_quality_tier as string) ?? "—").padEnd(8);
    const provis = (sp.v2_provisional as boolean | undefined) === true ? "Y" : " ";
    const ba = (sp.v2_best_angle_eligible as boolean | undefined) === true ? "★ YES" : "  no";
    console.log(
      `ext=${String(p.game_external_id).padEnd(8)} | ${fmt(p.predicted_home_score, 4)} / ${fmt(p.predicted_away_score, 4)} | ${fmt(p.predicted_total, 4)} | ${pad(p.predicted_ml_winner, 4)} / ${fmt(p.ml_confidence, 4)} | ${pad(p.predicted_ou_side, 5)} / ${fmt(p.ou_confidence, 4)} | ${model_used.padEnd(14)} | ${tier} | ${provis}      | ${ba}`
    );
  }

  // Summary
  console.log("");
  console.log("━━━ Summary ━━━");
  console.log(`  Games processed:          ${result.game_count}`);
  console.log(`  Predictions generated:    ${result.predictions.length}`);
  console.log(`  Fully held games:         ${result.held_count}`);
  console.log(`  ML null:                  ${result.pick_null_counts.ml}`);
  console.log(`  OU null:                  ${result.pick_null_counts.ou}`);
  console.log(`  NRFI null:                ${result.pick_null_counts.nrfi}`);
  console.log(`  Errors:                   ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      console.log(`    game_ext=${e.game_external_id}: ${e.error}`);
    }
  }

  // V2-specific tallies
  if (opts.model === "v2" || opts.model === "shadow") {
    let v2Provisional = 0;
    let v2BestAngle = 0;
    let v2Fallback = 0;
    const tierCounts: Record<string, number> = {};
    for (const p of result.predictions) {
      const sp = p.sport_specific as Record<string, unknown>;
      if (sp.v2_provisional === true) v2Provisional++;
      if (sp.v2_best_angle_eligible === true) v2BestAngle++;
      const tier = (sp.v2_data_quality_tier as string) ?? "unknown";
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
      const audit = sp.v2_audit as { fallback?: boolean } | undefined;
      if (audit?.fallback === true) v2Fallback++;
    }
    console.log(`  V2 provisional:           ${v2Provisional}`);
    console.log(`  V2 Best Angle eligible:   ${v2BestAngle}`);
    console.log(`  V2 fallback to V1:        ${v2Fallback}`);
    console.log(`  V2 data-quality tiers:    ${JSON.stringify(tierCounts)}`);
  }

  // DB write outcome
  if (result.db_writes !== null) {
    console.log("");
    console.log("━━━ DB write outcome ━━━");
    console.log(`  ingest.inserted:   ${result.db_writes.ingest.inserted}`);
    console.log(`  ingest.updated:    ${result.db_writes.ingest.updated}`);
    if (result.db_writes.ingest.failed > 0 && result.db_writes.ingest.errors.length > 0) {
      console.log(`  ingest errors (${result.db_writes.ingest.errors.length}):`);
      for (const e of result.db_writes.ingest.errors) {
        console.log(`    game_ext=${e.game_external_id}: ${e.errors.join("; ")}`);
      }
    }
    console.log(`  ingest.failed:     ${result.db_writes.ingest.failed}`);
    if (result.db_writes.market_signals && "error" in result.db_writes.market_signals && result.db_writes.market_signals.error) {
      console.log(`  market_signals.error: ${result.db_writes.market_signals.error}`);
    } else if (result.db_writes.market_signals && "game_predictions_updated" in result.db_writes.market_signals) {
      console.log(`  market_signals.updated: ${result.db_writes.market_signals.game_predictions_updated}`);
    }
    if (result.db_writes.grades && "error" in result.db_writes.grades && result.db_writes.grades.error) {
      console.log(`  grades.error: ${result.db_writes.grades.error}`);
    } else if (result.db_writes.grades && "game_predictions_updated" in result.db_writes.grades) {
      console.log(`  grades.updated: ${result.db_writes.grades.game_predictions_updated}`);
    }
  }

  console.log("");
  console.log(willWrite ? "  ✓ APPLIED — game_predictions upserted." : "  DRY RUN — NO DB WRITES PERFORMED.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
