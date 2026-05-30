/**
 * Phase 4B — operator dry-run script for T-60 Locked Refresh.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/automodel-t60-refresh.ts \
 *     [--date YYYY-MM-DD]      (default: today UTC)
 *     [--sport mlb]
 *     [--now ISO_TIMESTAMP]    (default: actual now)
 *     [--window-minutes N]     (default: 60)
 *     [--include-started]      (default: false)
 *     [--json]
 *     [--verbose]
 *
 * Selects games whose start_time is within the T-60 window relative to
 * --now and runs the model for each in dry-run. Skips manual-override
 * games. Reports stale reasons + movement deltas vs prior auto rows.
 *
 * Dry-run only. Rejects --write with a pointer to Phase 4C.
 */

import {
  emitReport,
  parseCommonCliOptions,
  printBanner,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  validateWriteGate,
} from "./_cliCommon";
import {
  runT60RefreshDryRun,
  runT60RefreshWrite,
  type T60RefreshReport,
  type T60RefreshWriteReport,
} from "../../lib/services/automodelOrchestratorService";

async function main() {
  const { writeMode } = validateWriteGate(process.argv);
  const opts = parseCommonCliOptions(process.argv);
  const nowFlag = readStringFlag(process.argv, "--now");
  const now = nowFlag ? new Date(nowFlag) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(
      `Invalid --now "${nowFlag}". Expected ISO 8601 timestamp (e.g. 2026-05-22T20:00:00Z).`
    );
  }
  const window_minutes = readNumberFlag(process.argv, "--window-minutes") ?? 60;
  if (window_minutes <= 0) {
    throw new Error(
      `Invalid --window-minutes "${window_minutes}". Must be positive.`
    );
  }
  const include_started = readBoolFlag(process.argv, "--include-started");

  printBanner("automodel-t60-refresh", opts, {
    mode: writeMode ? "WRITE" : "DRY-RUN",
    now: now.toISOString(),
    window_minutes,
    include_started,
  });

  if (writeMode) {
    const report = await runT60RefreshWrite(
      opts.sport,
      opts.date,
      now,
      window_minutes,
      include_started
    );
    emitReport(report, opts, () => formatWriteText(report, opts.verbose));
    console.log(
      "\n⚠ REMINDER: unset AUTOMODEL_DB_WRITES_ENABLED in your shell when done."
    );
    return;
  }

  const report = await runT60RefreshDryRun(
    opts.sport,
    opts.date,
    now,
    window_minutes,
    include_started
  );
  emitReport(report, opts, () => formatText(report, opts.verbose));
}

function formatText(report: T60RefreshReport, verbose: boolean) {
  console.log(
    `\n━━━ T-60 Refresh Dry-Run · ${report.sport} · ${report.slate_date} · now=${report.now} · window=${report.window_minutes}m ━━━\n`
  );
  console.log(
    `${report.candidates_count} games on slate · ${report.selected_count} in T-60 window · ${report.skipped_override.length} skipped (manual override)`
  );

  if (report.selected_count > 0) {
    console.log(`\nSelected (${report.selected_count}):`);
    for (const e of report.predictions) {
      const staleSuffix = e.stale_report?.is_stale
        ? `STALE: ${e.stale_report.reasons.join("; ")}`
        : e.stale_report
          ? "no change"
          : "(no prior)";
      const priorStage = e.prior_stage ?? "n/a";
      console.log(
        `  ext_id=${e.game_external_id}  starts=${e.start_time}  prior=${priorStage}   ${staleSuffix}`
      );
    }
  }

  console.log(`\nSkipped (window): ${report.skipped_window.length}`);
  const skipCounts = new Map<string, number>();
  for (const s of report.skipped_window) {
    skipCounts.set(s.reason, (skipCounts.get(s.reason) ?? 0) + 1);
  }
  for (const [reason, count] of skipCounts.entries()) {
    console.log(`  ${reason}: ${count}`);
  }

  if (report.skipped_override.length > 0) {
    console.log(`\nSkipped (manual override):`);
    for (const ext of report.skipped_override) {
      console.log(`  ext_id=${ext}`);
    }
  }

  const ms = report.movement_summary;
  console.log(`\nMovement summary across selected:`);
  console.log(`  listed total moves:    ${ms.games_with_listed_total_move}`);
  console.log(`  ML fair-prob moves:    ${ms.games_with_ml_fair_prob_move}`);
  console.log(`  EV deltas:             ${ms.games_with_ev_flip}`);
  console.log(`  public betting moves:  ${ms.games_with_public_betting_move}`);
  console.log(`  public money moves:    ${ms.games_with_public_money_move}`);
  console.log(`  starter changes:       ${ms.games_with_starter_change}`);
  console.log(`  provider data missing: ${ms.games_with_provider_data_missing}`);
  console.log(`  total stale this run:  ${report.stale_count}`);

  if (verbose && report.predictions.length > 0) {
    console.log(`\nProposed predictions per selected game:`);
    for (const e of report.predictions) {
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
      console.log(
        `  ext_id=${e.game_external_id}  ${(p.predicted_home_score ?? 0).toFixed(1)}-${(p.predicted_away_score ?? 0).toFixed(1)}  ML=${ml}  OU=${ou}  NRFI=${nrfi}`
      );
    }
  }

  console.log(`\nNotes:`);
  for (const n of report.notes) {
    console.log(`  • ${n}`);
  }
  console.log();
}

function formatWriteText(report: T60RefreshWriteReport, verbose: boolean) {
  formatText(report, verbose);
  console.log(`━━━ Write outcome ━━━`);
  if (report.db_writes === null) {
    console.log(
      `  (no DB writes attempted — no games in T-60 window after override skip)`
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
