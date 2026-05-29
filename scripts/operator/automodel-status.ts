/**
 * Phase 4B — operator read-only script for slate status.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/automodel-status.ts \
 *     [--date YYYY-MM-DD]   (default: today UTC)
 *     [--sport mlb]
 *     [--json]
 *
 * READ-ONLY. Never invokes the model. Reports current state of the slate:
 * game count, prediction categories (pure auto / manual override / pure
 * manual), stage breakdown, hold counts, stale counts, derivation
 * completeness, slate_status distribution.
 *
 * Rejects --write (no writes anywhere in Phase 4B).
 */

import {
  emitReport,
  parseCommonCliOptions,
  printBanner,
  rejectWriteFlag,
} from "./_cliCommon";
import {
  getSlateStatusReport,
  type SlateStatusReport,
} from "../../lib/services/automodelOrchestratorService";

async function main() {
  rejectWriteFlag(process.argv);
  const opts = parseCommonCliOptions(process.argv);
  printBanner("automodel-status", opts);

  const report = await getSlateStatusReport(opts.sport, opts.date);

  emitReport(report, opts, () => formatText(report));
}

function formatText(report: SlateStatusReport) {
  console.log(
    `\n━━━ Slate Status · ${report.sport} · ${report.slate_date} ━━━\n`
  );
  console.log(`${report.games_count} games on slate`);

  const pc = report.predictions_count;
  console.log(`\nPredictions: ${pc.total} total`);
  console.log(`  pure auto:           ${pc.pure_auto}   (prediction_source='auto_v1_mlb_rules' AND is_override=false)`);
  console.log(`  manual override:     ${pc.manual_override}`);
  console.log(`  pure manual:         ${pc.pure_manual}`);
  if (pc.other > 0) {
    console.log(`  other:               ${pc.other}`);
  }

  const sc = report.stage_counts;
  console.log(`\nAuto-row stages (pure auto only):`);
  console.log(`  morning_draft:       ${sc.morning_draft}`);
  console.log(`  t60_locked:          ${sc.t60_locked}`);
  if (sc.other > 0) {
    console.log(`  other:               ${sc.other}`);
  }

  const hc = report.hold_counts;
  console.log(`\nHolds (pure auto only):`);
  console.log(`  fully held:          ${hc.fully_held}`);
  console.log(`  partial held:        ${hc.partial_held}`);
  console.log(`  no hold:             ${hc.no_hold}`);

  console.log(`\nStale flag (pure auto): ${report.stale_count} of ${pc.pure_auto}`);

  const d = report.derivation_status;
  console.log(`\nDerivation status (all rows):`);
  console.log(`  any grade:           ${d.games_with_any_grade}`);
  console.log(`  all 3 grades:        ${d.games_with_all_3_grades}`);
  console.log(`  any market signal:   ${d.games_with_any_market_signal}`);

  const ss = report.slate_status_summary;
  console.log(`\nSlate status (per-game):`);
  console.log(`  draft:               ${ss.draft}`);
  console.log(`  published:           ${ss.published}`);
  console.log(`  final:               ${ss.final}`);
  console.log(`  hidden:              ${ss.hidden}`);
  if (ss.null_or_other > 0) {
    console.log(`  null/other:          ${ss.null_or_other}`);
  }

  console.log(
    `\n(slate_status='draft' means members not yet seeing auto rows — operator publish gates Daily Edge.)`
  );
  console.log();
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
