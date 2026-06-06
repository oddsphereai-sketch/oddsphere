/**
 * Phase 6B V2.1 — operator dry-run shadow.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/automodel-v2-1-shadow.ts --date 2026-06-06
 *
 * READ-ONLY. Runs V1 + V2.1 on every game of the requested slate and
 * emits the V2.1 per-game table + aggregate integrity report. No DB
 * writes, no game_predictions changes, no slate_status change.
 *
 * V2.1 layered architecture per Phase 6B V2.1:
 *   Layer 1 Market Baseline → Layer 2 Independent → Layer 3 Posterior
 *   → Layer 4 Market Read → Probability Engine → Play Grade
 */

import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../../lib/automodel/mlbAutoModelV1";
import { runMlbAutoModelV2_1 } from "../../lib/automodel/mlbAutoModelV2_1";
import type { Sport } from "../../lib/types/domain/Sport";

function parseArgs(argv: string[]): { sport: Sport; date: string } {
  let date: string | null = null;
  let sport: Sport = "mlb";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
  }
  if (!date) {
    console.error("Usage: automodel-v2-1-shadow.ts --date YYYY-MM-DD [--sport mlb]");
    process.exit(1);
  }
  return { sport, date };
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(digits);
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return (n * 100).toFixed(1) + "%";
}

async function main() {
  const opts = parseArgs(process.argv);

  console.log(`\n━━━ V2.1 dry-run · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`         DRY RUN — NO DB WRITES — READ-ONLY\n`);

  const snapshots = await buildFeatureSnapshots(opts.sport, opts.date);
  console.log(`Loaded ${snapshots.length} snapshots.\n`);

  // Aggregates
  let mlHeld = 0, ouHeld = 0, nrfiHeld = 0;
  let fullyHeld = 0, partial = 0, noHold = 0;
  let mlBestAngle = 0, ouBestAngle = 0;
  let provisional = 0;
  let roundedTies = 0;
  const baList: string[] = [];
  const provList: string[] = [];
  let totalMovementHome = 0, totalMovementAway = 0, countMovement = 0;
  const runDiffs: number[] = [];
  const tierCounts: Record<string, number> = {};
  const mlGrades: Record<string, number> = {};
  const ouGrades: Record<string, number> = {};

  for (const snap of snapshots) {
    const v1 = runMlbAutoModelV1(snap, "morning_draft");
    const v21 = runMlbAutoModelV2_1(snap, v1, "morning_draft");
    const a = v21.v21Audit;
    const matchup = `${snap.away_team.abbreviation}@${snap.home_team.abbreviation}`;

    console.log(`▼ ext=${snap.game_external_id} ${matchup}  data_quality=${a.data_quality_tier}  provisional=${a.provisional}`);
    console.log(`  Posterior (unrounded):   away=${fmt(a.posterior_away_runs, 2)}  home=${fmt(a.posterior_home_runs, 2)}    Rounded: a=${fmt(v21.predicted_away_score)}/h=${fmt(v21.predicted_home_score)}/T=${fmt(v21.predicted_total)}`);
    console.log(`  ML  ${(v21.predicted_ml_winner ?? "HOLD").padEnd(4)} conf=${fmt(v21.ml_confidence).padStart(5)}  model=${pct(a.ml_model_prob)}  mkt=${pct(a.ml_market_prob)}  edge=${(fmt(a.ml_edge_pct)+"%").padStart(7)}  EV=${(fmt(a.ml_ev_pct)+"%").padStart(7)}  type=${(a.ml_prediction_type ?? "—").padEnd(15)} BA=${a.best_angle_eligible_ml ? "★" : " "}`);
    if (a.ml_best_angle_reason) console.log(`       BA reason: ${a.ml_best_angle_reason}`);
    else if (a.ml_no_bet_reason) console.log(`       reason: ${a.ml_no_bet_reason}`);
    console.log(`  O/U ${(v21.predicted_ou_side ?? "HOLD").padEnd(5)} conf=${fmt(v21.ou_confidence).padStart(5)}  model_over=${pct(a.ou_model_prob)}  edge_runs=${fmt(a.ou_edge_runs)}  EV=${(fmt(a.ou_ev_pct)+"%").padStart(7)}  type=${(a.ou_prediction_type ?? "—").padEnd(15)} BA=${a.best_angle_eligible_ou ? "★" : " "}`);
    if (a.ou_best_angle_reason) console.log(`       BA reason: ${a.ou_best_angle_reason}`);
    else if (a.ou_no_bet_reason) console.log(`       reason: ${a.ou_no_bet_reason}`);
    console.log("");

    // Aggregates
    const mlH = v21.predicted_ml_winner === null;
    const ouH = v21.predicted_ou_side === null;
    const nrfiH = v21.predicted_nrfi === null;
    if (mlH) mlHeld++;
    if (ouH) ouHeld++;
    if (nrfiH) nrfiHeld++;
    if (mlH && ouH) fullyHeld++;
    else if (mlH || ouH) partial++;
    else noHold++;
    if (a.best_angle_eligible_ml) { mlBestAngle++; baList.push(`${matchup} ML`); }
    if (a.best_angle_eligible_ou) { ouBestAngle++; baList.push(`${matchup} OU`); }
    if (a.provisional) { provisional++; provList.push(matchup); }
    if (v21.predicted_home_score !== null && v21.predicted_away_score !== null &&
        v21.predicted_home_score === v21.predicted_away_score) roundedTies++;
    if (a.market_home_runs !== null && a.posterior_home_runs !== null) {
      totalMovementHome += Math.abs(a.posterior_home_runs - a.market_home_runs);
      countMovement++;
    }
    if (a.market_away_runs !== null && a.posterior_away_runs !== null) {
      totalMovementAway += Math.abs(a.posterior_away_runs - a.market_away_runs);
    }
    if (a.posterior_home_runs !== null && a.posterior_away_runs !== null) {
      runDiffs.push(a.posterior_home_runs - a.posterior_away_runs);
    }
    tierCounts[a.data_quality_tier] = (tierCounts[a.data_quality_tier] ?? 0) + 1;
    mlGrades[a.ml_play_grade] = (mlGrades[a.ml_play_grade] ?? 0) + 1;
    ouGrades[a.ou_play_grade] = (ouGrades[a.ou_play_grade] ?? 0) + 1;
  }

  // ─── Aggregate integrity report ─────────────────────────────────────
  console.log("━━━ Aggregate integrity report ━━━\n");
  console.log(`  Games:                          ${snapshots.length}`);
  console.log(`  ML held:                        ${mlHeld}`);
  console.log(`  O/U held:                       ${ouHeld}`);
  console.log(`  NRFI held:                      ${nrfiHeld}`);
  console.log(`  Fully held (ML+OU both held):   ${fullyHeld}`);
  console.log(`  Partial held:                   ${partial}`);
  console.log(`  No-hold games:                  ${noHold}`);
  console.log(`  Rounded score ties:             ${roundedTies}`);
  console.log(`  Provisional games:              ${provisional}`);
  console.log(`  ML Best Angle eligible:         ${mlBestAngle}`);
  console.log(`  O/U Best Angle eligible:        ${ouBestAngle}`);
  console.log(`  Data-quality tiers:             ${JSON.stringify(tierCounts)}`);
  console.log(`  ML Play Grade distribution:     ${JSON.stringify(mlGrades)}`);
  console.log(`  O/U Play Grade distribution:    ${JSON.stringify(ouGrades)}`);
  if (countMovement > 0) {
    console.log(`  Avg |posterior - market| home:  ${(totalMovementHome / countMovement).toFixed(2)} runs`);
    console.log(`  Avg |posterior - market| away:  ${(totalMovementAway / countMovement).toFixed(2)} runs`);
  }
  if (runDiffs.length > 0) {
    const avgAbs = runDiffs.reduce((s, n) => s + Math.abs(n), 0) / runDiffs.length;
    console.log(`  Avg |run differential|:         ${avgAbs.toFixed(2)} runs`);
  }
  if (baList.length > 0) {
    console.log(`\n  Best Angle list:`);
    for (const b of baList) console.log(`    ${b}`);
  }
  if (provList.length > 0) {
    console.log(`\n  Provisional list:`);
    for (const p of provList) console.log(`    ${p}`);
  }

  console.log(`\n  DRY RUN — NO DB WRITES PERFORMED.\n`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
