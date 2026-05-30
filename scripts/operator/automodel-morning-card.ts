/**
 * Phase 4B/4C — operator script for the Morning Card.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/automodel-morning-card.ts \
 *     [--date YYYY-MM-DD]   (default: today UTC)
 *     [--sport mlb]         (default: mlb; V1 MLB-only)
 *     [--write]             (Phase 4C — requires AUTOMODEL_DB_WRITES_ENABLED=true)
 *     [--json]              (default: text output)
 *     [--verbose]           (default: false; include per-game prediction detail)
 *
 * EXAMPLES:
 *   # Phase 4B dry-run
 *   npx tsx --env-file=.env.local scripts/operator/automodel-morning-card.ts
 *
 *   # Phase 4C guarded write (writes whole slate minus manual overrides)
 *   AUTOMODEL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \
 *     scripts/operator/automodel-morning-card.ts --write --date 2026-05-22
 *
 * Three-key gate for writes: --write + AUTOMODEL_DB_WRITES_ENABLED=true +
 * service writeToDb=true (enforced inside generatePredictionsForSlate).
 */

import {
  emitReport,
  parseCommonCliOptions,
  printBanner,
  validateWriteGate,
} from "./_cliCommon";
import {
  runMorningCardDryRun,
  runMorningCardWrite,
  type MorningCardReport,
  type MorningCardWriteReport,
} from "../../lib/services/automodelOrchestratorService";

async function main() {
  const { writeMode } = validateWriteGate(process.argv);
  const opts = parseCommonCliOptions(process.argv);
  printBanner("automodel-morning-card", opts, {
    mode: writeMode ? "WRITE" : "DRY-RUN",
  });

  if (writeMode) {
    const report = await runMorningCardWrite(opts.sport, opts.date);
    emitReport(report, opts, () => formatWriteText(report, opts.verbose));
    if (writeMode) {
      console.log(
        "\n⚠ REMINDER: unset AUTOMODEL_DB_WRITES_ENABLED in your shell when done."
      );
    }
    return;
  }

  const report = await runMorningCardDryRun(opts.sport, opts.date);
  emitReport(report, opts, () => formatText(report, opts.verbose));
}

function formatText(report: MorningCardReport, verbose: boolean) {
  console.log(
    `\n━━━ Morning Card Dry-Run · ${report.sport} · ${report.slate_date} · stage=morning_draft ━━━\n`
  );
  console.log(
    `${report.game_count} games · ${report.predictions_count} predictions · ${report.duration_ms}ms`
  );

  console.log(`\nPicks:`);
  const cb = report.confidence_bands;
  const bandLine = (
    label: string,
    band: { count: number; min: number | null; max: number | null; mean: number | null },
    nullCount: number
  ) => {
    const range =
      band.min !== null && band.max !== null && band.mean !== null
        ? `conf range ${band.min.toFixed(1)}–${band.max.toFixed(1)} (mean ${band.mean.toFixed(1)})`
        : `no confidence values`;
    return `  ${label} set: ${band.count} (${nullCount} held)   ${range}`;
  };
  console.log(bandLine("ML  ", cb.ml, report.pick_null_counts.ml));
  console.log(bandLine("O/U ", cb.ou, report.pick_null_counts.ou));
  console.log(bandLine("NRFI", cb.nrfi, report.pick_null_counts.nrfi));

  console.log(`\nData gaps:`);
  console.log(`  missing starter (any side): ${report.missing_starter_count}`);
  console.log(`  missing market line:        ${report.missing_market_line_count}`);
  console.log(`  full hold games:            ${report.held_count}`);
  console.log(
    `  AI sanity stub: ${report.ai_sanity_actions.approve} approve / ${report.ai_sanity_actions.warn} warn / ${report.ai_sanity_actions.hold} hold / ${report.ai_sanity_actions.rerun} rerun`
  );
  console.log(
    `  deterministic guard corrections: ${report.total_deterministic_corrections}`
  );

  console.log(`\nStale vs prior auto:`);
  console.log(`  games with prior:      ${report.stale_summary.games_with_prior}`);
  console.log(`  stale this run:         ${report.stale_summary.games_stale_vs_prior}`);
  if (report.stale_summary.top_reasons.length > 0) {
    console.log(`  top reasons:`);
    for (const r of report.stale_summary.top_reasons) {
      console.log(`    ${r.reason}: ${r.count}`);
    }
  }

  if (report.errors.length > 0) {
    console.log(`\nErrors (${report.errors.length}):`);
    for (const e of report.errors) {
      console.log(`  ext_id=${e.game_external_id ?? "n/a"}: ${e.error}`);
    }
  }

  if (verbose && report.predictions.length > 0) {
    console.log(`\nPer-game predictions:`);
    for (const p of report.predictions) {
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
      const stale = p.stale_report?.is_stale
        ? `STALE: ${p.stale_report.reasons.join("; ")}`
        : p.stale_report
          ? "no change"
          : "(no prior)";
      console.log(
        `  ext_id=${p.game_external_id}  ${(p.predicted_home_score ?? 0).toFixed(1)}-${(p.predicted_away_score ?? 0).toFixed(1)}  ML=${ml}  OU=${ou}  NRFI=${nrfi}  ${stale}`
      );
    }
  }

  if (report.stale_summary.notes.length > 0) {
    console.log(`\nNotes:`);
    for (const n of report.stale_summary.notes) {
      console.log(`  • ${n}`);
    }
  }
  console.log();
}

function formatWriteText(report: MorningCardWriteReport, verbose: boolean) {
  // Re-use the dry-run renderer for the model-side report, then add the
  // write-outcome section.
  formatText(report, verbose);

  console.log(`━━━ Write outcome ━━━`);
  if (report.db_writes === null) {
    console.log(`  (no DB writes attempted — likely empty filter)`);
  } else {
    const w = report.db_writes;
    console.log(
      `  ingest: ${w.ingest.inserted} inserted · ${w.ingest.updated} updated · ${w.ingest.failed} failed · run_id=${w.ingest.run_id}`
    );
    if (w.ingest.failed > 0) {
      for (const f of w.ingest.errors) {
        console.log(
          `    ext_id=${f.game_external_id}: ${f.errors.join(", ")}`
        );
      }
    }
    if (w.market_signals && "game_predictions_updated" in w.market_signals && w.market_signals.error === null) {
      console.log(
        `  market_signals: ${w.market_signals.game_predictions_updated} game rows updated`
      );
    } else if (w.market_signals && "error" in w.market_signals && w.market_signals.error) {
      console.log(`  market_signals ERROR: ${w.market_signals.error}`);
    }
    if (w.grades && "game_predictions_updated" in w.grades && w.grades.error === null) {
      console.log(
        `  grades: ${w.grades.game_predictions_updated} game rows updated`
      );
    } else if (w.grades && "error" in w.grades && w.grades.error) {
      console.log(`  grades ERROR: ${w.grades.error}`);
    }
  }
  console.log(
    `  skipped_override_ids: [${report.skipped_override_ids.join(",")}] (${report.skipped_override_ids.length} game(s))`
  );
  console.log();
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
