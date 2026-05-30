/**
 * Phase 4B — operator dry-run script for held-only rerun.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/automodel-rerun-held.ts \
 *     [--date YYYY-MM-DD]      (default: today UTC)
 *     [--sport mlb]
 *     [--stage morning_draft|t60_locked]  (default: morning_draft)
 *     [--include-partial-holds] / [--no-include-partial-holds]   (default: true)
 *     [--json]
 *     [--verbose]
 *
 * Reruns the model in dry-run for games currently held in the prior
 * auto prediction. Skips manual overrides. Reports whether holds
 * resolved (data has arrived) or remain.
 *
 * Dry-run only. Rejects --write with a pointer to Phase 4C.
 */

import {
  emitReport,
  parseCommonCliOptions,
  parseStageFlag,
  printBanner,
  readBoolFlag,
  validateWriteGate,
} from "./_cliCommon";
import {
  runHeldOnlyRerunDryRun,
  runHeldOnlyRerunWrite,
  type HeldOnlyRerunReport,
  type HeldOnlyRerunWriteReport,
} from "../../lib/services/automodelOrchestratorService";

async function main() {
  const { writeMode } = validateWriteGate(process.argv);
  const opts = parseCommonCliOptions(process.argv);
  const stage = parseStageFlag(process.argv, "morning_draft");
  // Default true; --no-include-partial-holds opts out.
  let include_partial_holds = true;
  if (readBoolFlag(process.argv, "--no-include-partial-holds")) {
    include_partial_holds = false;
  } else if (readBoolFlag(process.argv, "--include-partial-holds")) {
    include_partial_holds = true;
  }
  printBanner("automodel-rerun-held", opts, {
    mode: writeMode ? "WRITE" : "DRY-RUN",
    stage,
    include_partial_holds,
  });

  if (writeMode) {
    const report = await runHeldOnlyRerunWrite(
      opts.sport,
      opts.date,
      stage,
      include_partial_holds
    );
    emitReport(report, opts, () => formatWriteText(report, opts.verbose));
    console.log(
      "\n⚠ REMINDER: unset AUTOMODEL_DB_WRITES_ENABLED in your shell when done."
    );
    return;
  }

  const report = await runHeldOnlyRerunDryRun(
    opts.sport,
    opts.date,
    stage,
    include_partial_holds
  );
  emitReport(report, opts, () => formatText(report, opts.verbose));
}

function formatText(report: HeldOnlyRerunReport, verbose: boolean) {
  console.log(
    `\n━━━ Held-Only Rerun Dry-Run · ${report.sport} · ${report.slate_date} · stage=${report.stage} · include_partial=${report.include_partial_holds} ━━━\n`
  );
  console.log(
    `${report.candidates_count} held candidates · ${report.skipped_override.length} skipped (manual override) · ${report.selected_count} reran`
  );

  console.log(`\nResolution summary:`);
  const rs = report.resolution_summary;
  console.log(`  resolved:           ${rs.resolved}`);
  console.log(`  still_held:         ${rs.still_held}`);
  console.log(`  partially_resolved: ${rs.partially_resolved}`);
  console.log(`  newly_held:         ${rs.newly_held}`);

  if (report.skipped_override.length > 0) {
    console.log(`\nSkipped (manual override):`);
    for (const ext of report.skipped_override) {
      console.log(`  ext_id=${ext}`);
    }
  }

  if (report.predictions.length > 0) {
    console.log(`\nGames reran:`);
    for (const e of report.predictions) {
      console.log(
        `  ext_id=${e.game_external_id}  prior_hold_picks=[${e.prior_hold_picks.join(",")}]  proposed_hold_picks=[${e.proposed_hold_picks.join(",")}]  → ${e.resolution}`
      );
      if (verbose) {
        const p = e.proposed;
        const ml =
          p.predicted_ml_winner !== null
            ? `${p.predicted_ml_winner} (${(p.ml_confidence ?? 0).toFixed(1)}%)`
            : "HELD";
        const ou =
          p.predicted_ou_side !== null
            ? `${p.predicted_ou_side} (${(p.ou_confidence ?? 0).toFixed(1)}%)`
            : "HELD";
        const nrfi =
          p.predicted_nrfi !== null
            ? `${p.predicted_nrfi ? "YES" : "NO"} (${(p.nrfi_confidence ?? 0).toFixed(1)}%)`
            : "HELD";
        console.log(`     proposed: ML=${ml}  OU=${ou}  NRFI=${nrfi}`);
        if (e.stale_report?.is_stale) {
          console.log(`     stale: ${e.stale_report.reasons.join("; ")}`);
        }
      }
    }
  }

  console.log(`\nNotes:`);
  for (const n of report.notes) {
    console.log(`  • ${n}`);
  }
  console.log();
}

function formatWriteText(report: HeldOnlyRerunWriteReport, verbose: boolean) {
  formatText(report, verbose);
  console.log(`━━━ Write outcome ━━━`);
  if (report.db_writes === null) {
    console.log(
      `  (no DB writes attempted — no held candidates after override skip)`
    );
  } else {
    const w = report.db_writes;
    console.log(
      `  ingest: ${w.ingest.inserted} inserted · ${w.ingest.updated} updated · ${w.ingest.failed} failed · run_id=${w.ingest.run_id}`
    );
    if (w.market_signals && "error" in w.market_signals && w.market_signals.error) {
      console.log(`  market_signals ERROR: ${w.market_signals.error}`);
    } else if (w.market_signals && "game_predictions_updated" in w.market_signals) {
      console.log(
        `  market_signals: ${w.market_signals.game_predictions_updated} game rows updated`
      );
    }
    if (w.grades && "error" in w.grades && w.grades.error) {
      console.log(`  grades ERROR: ${w.grades.error}`);
    } else if (w.grades && "game_predictions_updated" in w.grades) {
      console.log(
        `  grades: ${w.grades.game_predictions_updated} game rows updated`
      );
    }
  }
  console.log();
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
