/**
 * Phase 4B — operator dry-run script for the Morning Card.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/automodel-morning-card.ts \
 *     [--date YYYY-MM-DD]   (default: today UTC)
 *     [--sport mlb]         (default: mlb; V1 MLB-only)
 *     [--json]              (default: text output)
 *     [--verbose]           (default: false; include per-game prediction detail)
 *
 * EXAMPLES:
 *   npx tsx --env-file=.env.local scripts/operator/automodel-morning-card.ts
 *   npx tsx --env-file=.env.local scripts/operator/automodel-morning-card.ts \
 *     --date 2026-05-22 --verbose
 *
 * Dry-run only. Rejects --write with a pointer to Phase 4C.
 */

import {
  emitReport,
  parseCommonCliOptions,
  printBanner,
  rejectWriteFlag,
} from "./_cliCommon";
import {
  runMorningCardDryRun,
  type MorningCardReport,
} from "../../lib/services/automodelOrchestratorService";

async function main() {
  rejectWriteFlag(process.argv);
  const opts = parseCommonCliOptions(process.argv);
  printBanner("automodel-morning-card", opts);

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

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
