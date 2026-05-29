/**
 * Phase 4B — operator read-only script to dump stale + movement deltas.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/automodel-show-deltas.ts \
 *     [--date YYYY-MM-DD]   (default: today UTC)
 *     [--sport mlb]
 *     [--only-stale]        (default: false; true → only games with is_stale=true)
 *     [--json]
 *
 * READ-ONLY. Reads sport_specific.{stale, stale_reason, movement_deltas,
 * previous_stage, previous_run_at} from auto rows currently in DB.
 *
 * Important: Phase 4B does NOT persist movement_deltas — Phase 4C
 * starts populating those fields. Until then, this script will report
 * mostly null movement_deltas + is_stale=false. The report's notes
 * make this explicit.
 *
 * Rejects --write.
 */

import {
  emitReport,
  parseCommonCliOptions,
  printBanner,
  readBoolFlag,
  rejectWriteFlag,
} from "./_cliCommon";
import {
  getSlateDeltasReport,
  type SlateDeltasReport,
} from "../../lib/services/automodelOrchestratorService";

async function main() {
  rejectWriteFlag(process.argv);
  const opts = parseCommonCliOptions(process.argv);
  const only_stale = readBoolFlag(process.argv, "--only-stale");
  printBanner("automodel-show-deltas", opts, { only_stale });

  const report = await getSlateDeltasReport(opts.sport, opts.date, only_stale);

  emitReport(report, opts, () => formatText(report));
}

function fmtDelta(n: number | null): string {
  if (n === null) return "null";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}`;
}

function formatText(report: SlateDeltasReport) {
  console.log(
    `\n━━━ Movement / Stale Deltas · ${report.sport} · ${report.slate_date} (only_stale=${report.only_stale}) ━━━\n`
  );
  console.log(
    `${report.totals.games_total} games · ${report.totals.stale_games} stale`
  );

  if (report.games.length === 0) {
    console.log(`\n(no auto rows match filter)`);
  } else {
    console.log();
    for (const g of report.games) {
      const stageLine = `${g.previous_stage ?? "n/a"} → ${g.stage ?? "n/a"}`;
      console.log(`  ext_id=${g.game_external_id}  ${stageLine}`);
      if (g.is_stale && g.stale_reason) {
        console.log(`    STALE: ${g.stale_reason}`);
      }
      const d = g.movement_deltas;
      if (d) {
        const parts = [
          `line ${fmtDelta(d.total_line_delta)}`,
          `ml_prob ${fmtDelta(d.ml_fair_prob_delta)}`,
          `ev ${fmtDelta(d.ev_delta)}`,
          `public_bet ${fmtDelta(d.public_betting_delta)}`,
          `public_money ${fmtDelta(d.public_money_delta)}`,
        ];
        const flags = [
          d.starter_changed ? "starter_changed" : null,
          d.lineup_status_changed ? "lineup_status_changed" : null,
          d.sharp_grade_changed ? "sharp_grade_changed" : null,
          d.provider_data_missing ? "provider_data_missing" : null,
        ].filter((s): s is string => s !== null);
        console.log(`    deltas: ${parts.join("  ")}`);
        if (flags.length > 0) {
          console.log(`    flags:  ${flags.join(", ")}`);
        }
      } else {
        console.log(`    deltas: (no movement_deltas stored — Phase 4C populates)`);
      }
    }
  }

  const t = report.totals;
  console.log(`\nTotals:`);
  console.log(`  starter changes:     ${t.games_with_starter_change}`);
  console.log(`  line moves:          ${t.games_with_line_move}`);
  console.log(`  ML fair-prob moves:  ${t.games_with_ml_fair_prob_move}`);
  console.log(`  EV moves:            ${t.games_with_ev_flip}`);
  console.log(`  public split moves:  ${t.games_with_public_split_move}`);
  console.log(`  sharp grade flips:   ${t.games_with_sharp_grade_flip}`);

  console.log(`\nNotes:`);
  for (const n of report.notes) {
    console.log(`  • ${n}`);
  }
  console.log();
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
