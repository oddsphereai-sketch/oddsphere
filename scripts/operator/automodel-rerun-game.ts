/**
 * Phase 4B — operator dry-run script for single-game rerun.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/automodel-rerun-game.ts \
 *     --game-external-id ID    (required)
 *     [--date YYYY-MM-DD]      (default: today UTC)
 *     [--sport mlb]
 *     [--stage morning_draft|t60_locked]  (default: t60_locked)
 *     [--json]
 *     [--verbose]
 *
 * Reruns the model for one game in dry-run. Warns if a manual override
 * exists (no risk in 4B — dry-run cannot overwrite). Prints prior vs
 * proposed side-by-side plus stale reasons.
 *
 * Dry-run only. Rejects --write with a pointer to Phase 4C.
 */

import {
  emitReport,
  parseCommonCliOptions,
  parseStageFlag,
  printBanner,
  readNumberFlag,
  rejectWriteFlag,
} from "./_cliCommon";
import {
  runSingleGameRerunDryRun,
  type SingleGameRerunReport,
} from "../../lib/services/automodelOrchestratorService";

async function main() {
  rejectWriteFlag(process.argv);
  const opts = parseCommonCliOptions(process.argv);
  const game_external_id = readNumberFlag(process.argv, "--game-external-id");
  if (game_external_id === undefined) {
    throw new Error(
      "Required: --game-external-id ID (e.g. --game-external-id 18599100)"
    );
  }
  const stage = parseStageFlag(process.argv, "t60_locked");
  printBanner("automodel-rerun-game", opts, {
    game_external_id,
    stage,
  });

  const report = await runSingleGameRerunDryRun(
    opts.sport,
    opts.date,
    game_external_id,
    stage
  );

  emitReport(report, opts, () => formatText(report, opts.verbose));
}

function fmtNum(n: number | null | undefined, digits: number = 1): string {
  if (n === null || n === undefined) return "null";
  return n.toFixed(digits);
}

function formatText(report: SingleGameRerunReport, _verbose: boolean) {
  console.log(
    `\n━━━ Single-Game Rerun Dry-Run · ext_id=${report.game_external_id} · stage=${report.stage} ━━━\n`
  );
  console.log(
    `Slate: ${report.sport} ${report.slate_date} · game found: ${report.found ? "YES" : "NO"} · manual override: ${report.manual_override_present ? "YES" : "NO"}`
  );

  if (!report.found || !report.proposed) {
    if (report.notes.length > 0) {
      console.log(`\nNotes:`);
      for (const n of report.notes) {
        console.log(`  • ${n}`);
      }
    }
    console.log();
    return;
  }

  const prior = report.prior;
  const prop = report.proposed;
  console.log(
    `\n                       PRIOR (${prior?.prior_stage ?? "none"})            PROPOSED (${prop.stage})`
  );
  console.log(
    `  predicted_home_score:    ${fmtNum(prior?.predicted_home_score)}                       ${fmtNum(prop.predicted_home_score)}`
  );
  console.log(
    `  predicted_away_score:    ${fmtNum(prior?.predicted_away_score)}                       ${fmtNum(prop.predicted_away_score)}`
  );
  console.log(
    `  predicted_total:         ${fmtNum(prior?.predicted_total)}                       ${fmtNum(prop.predicted_total)}`
  );
  console.log(
    `  ML winner:               ${prior?.predicted_ml_winner ?? "null"} (${fmtNum(prior?.ml_confidence)}%)              ${prop.predicted_ml_winner ?? "null"} (${fmtNum(prop.ml_confidence)}%)`
  );
  console.log(
    `  O/U side:                ${prior?.predicted_ou_side ?? "null"} (${fmtNum(prior?.ou_confidence)}%)             ${prop.predicted_ou_side ?? "null"} (${fmtNum(prop.ou_confidence)}%)`
  );
  console.log(
    `  NRFI:                    ${prior?.predicted_nrfi === null || prior?.predicted_nrfi === undefined ? "null" : prior.predicted_nrfi ? "YES" : "NO"} (${fmtNum(prior?.nrfi_confidence)}%)                ${prop.predicted_nrfi === null ? "null" : prop.predicted_nrfi ? "YES" : "NO"} (${fmtNum(prop.nrfi_confidence)}%)`
  );
  console.log(
    `  held:                    ${prior?.prior_held ?? "n/a"}                     ${prop.held}`
  );
  console.log(
    `  hold_picks:              [${(prior?.prior_hold_picks ?? []).join(",")}]                        [${prop.hold_picks.join(",")}]`
  );

  if (report.stale_report) {
    console.log(
      `\nStale: ${report.stale_report.is_stale ? "YES" : "NO"}`
    );
    if (report.stale_report.is_stale) {
      for (const r of report.stale_report.reasons) {
        console.log(`  • ${r}`);
      }
    }
  } else {
    console.log(`\nStale: n/a (no prior auto row to compare against)`);
  }

  if (report.notes.length > 0) {
    console.log(`\nNotes:`);
    for (const n of report.notes) {
      console.log(`  • ${n}`);
    }
  }
  console.log();
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
