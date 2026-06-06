/**
 * Push 3A — V2.2 shadow operator (read-only).
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/automodel-v2-2-shadow.ts --date 2026-06-06
 *
 * READ-ONLY. Runs V1 + V2.1 + V2.2 on every game of the requested slate
 * and emits a per-game V2.1 vs V2.2 comparison plus an aggregate report.
 * No DB writes, no game_predictions changes, no slate_status change.
 *
 * Why this script exists:
 *   The user's pre-production rule is that V2.2 must NOT become the
 *   default in cron until shadow verification proves it doesn't
 *   blow up real slates. This script is the verification surface.
 *
 * Comparison axes per Push 3A spec:
 *   - projected total runs delta (V2.2 − V2.1)
 *   - projected run-differential delta
 *   - ML pick agreement
 *   - OU pick agreement
 *   - ML model probability delta
 *   - confidence delta
 *   - Best Angle eligibility (per side)
 *   - data-quality tier
 *   - V2.2 posterior cap flags
 *   - V2.2 integrity notes
 */

import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../../lib/automodel/mlbAutoModelV1";
import { runMlbAutoModelV2_1 } from "../../lib/automodel/mlbAutoModelV2_1";
import { runMlbAutoModelV2_2 } from "../../lib/automodel/mlbAutoModelV2_2";
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
    console.error("Usage: automodel-v2-2-shadow.ts --date YYYY-MM-DD [--sport mlb]");
    process.exit(1);
  }
  return { sport, date };
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(digits);
}
function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return (n * 100).toFixed(1) + "%";
}
function deltaTag(delta: number, digits = 2, suffix = ""): string {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(digits)}${suffix}`;
}

async function main() {
  const opts = parseArgs(process.argv);

  console.log(`\n━━━ V2.1 vs V2.2 SHADOW · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`         DRY RUN — NO DB WRITES — READ-ONLY\n`);

  const snapshots = await buildFeatureSnapshots(opts.sport, opts.date);
  console.log(`Loaded ${snapshots.length} snapshots.\n`);

  let mlDisagree = 0, ouDisagree = 0;
  let v21BA_ml = 0, v22BA_ml = 0;
  let v21BA_ou = 0, v22BA_ou = 0;
  let v22Capped = 0, v22Provisional = 0;
  let v22FallbackTier = 0;
  const totalDeltas: number[] = [];
  const diffDeltas: number[] = [];
  const mlProbDeltas: number[] = [];
  const mlConfDeltas: number[] = [];
  const ouConfDeltas: number[] = [];
  const v22TierCounts: Record<string, number> = {};
  const v22IntegrityNotes: Record<string, number> = {};

  for (const snap of snapshots) {
    const v1 = runMlbAutoModelV1(snap, "morning_draft");
    const v21 = runMlbAutoModelV2_1(snap, v1, "morning_draft");
    const v22 = runMlbAutoModelV2_2(snap, v1, "morning_draft");
    const a21 = v21.v21Audit;
    const a22 = v22.v22Audit;
    const matchup = `${snap.away_team.abbreviation}@${snap.home_team.abbreviation}`;

    const v21Total = v21.predicted_total ?? 0;
    const v21Home = v21.predicted_home_score ?? 0;
    const v21Away = v21.predicted_away_score ?? 0;
    const v21MlConf = v21.ml_confidence ?? 0;
    const v21OuConf = v21.ou_confidence ?? 0;
    const totalDelta = v22.predicted_total - v21Total;
    const diff21 = v21Home - v21Away;
    const diff22 = v22.predicted_home_score - v22.predicted_away_score;
    const diffDelta = diff22 - diff21;
    const mlProbDelta = a22.ml_model_prob - (a21.ml_model_prob ?? 0);
    const mlConfDelta = v22.ml_confidence - v21MlConf;
    const ouConfDelta = v22.ou_confidence - v21OuConf;
    const mlAgree = v21.predicted_ml_winner === v22.predicted_ml_winner;
    const ouAgree = v21.predicted_ou_side === v22.predicted_ou_side;

    if (!mlAgree) mlDisagree++;
    if (!ouAgree) ouDisagree++;
    if (a21.best_angle_eligible_ml) v21BA_ml++;
    if (a21.best_angle_eligible_ou) v21BA_ou++;
    if (a22.ml_best_angle_eligible) v22BA_ml++;
    if (a22.ou_best_angle_eligible) v22BA_ou++;
    if (a22.capped_by_total || a22.capped_by_diff) v22Capped++;
    if (a22.provisional) v22Provisional++;
    if (a22.data_quality_tier === "fallback") v22FallbackTier++;
    v22TierCounts[a22.data_quality_tier] = (v22TierCounts[a22.data_quality_tier] ?? 0) + 1;
    for (const note of a22.model_integrity_notes) {
      const key = note.split("(")[0]!.trim();
      v22IntegrityNotes[key] = (v22IntegrityNotes[key] ?? 0) + 1;
    }
    totalDeltas.push(totalDelta);
    diffDeltas.push(diffDelta);
    mlProbDeltas.push(mlProbDelta);
    mlConfDeltas.push(mlConfDelta);
    ouConfDeltas.push(ouConfDelta);

    console.log(`▼ ext=${snap.game_external_id} ${matchup}  tier=${a22.data_quality_tier}  v22_provisional=${a22.provisional}  v22_trust_indep=${fmt(a22.trust_independent)}`);
    console.log(`  Total runs        V2.1=${fmt(v21Total)}  V2.2=${fmt(v22.predicted_total)}  Δ=${deltaTag(totalDelta)}r`);
    console.log(`  Run diff (H-A)    V2.1=${fmt(diff21)}      V2.2=${fmt(diff22)}      Δ=${deltaTag(diffDelta)}r`);
    console.log(`  ML pick           V2.1=${(v21.predicted_ml_winner ?? "HOLD").padEnd(4)}  V2.2=${(v22.predicted_ml_winner ?? "HOLD").padEnd(4)}  ${mlAgree ? "agree" : "DISAGREE"}`);
    console.log(`  ML model prob     V2.1=${pct(a21.ml_model_prob)}  V2.2=${pct(a22.ml_model_prob)}  Δ=${deltaTag(mlProbDelta * 100, 1, "%")}`);
    console.log(`  ML conf           V2.1=${fmt(v21MlConf, 1).padStart(5)}  V2.2=${fmt(v22.ml_confidence, 1).padStart(5)}  Δ=${deltaTag(mlConfDelta, 1)}`);
    console.log(`  ML play grade     V2.1=${a21.ml_play_grade.padEnd(15)} V2.2=${a22.ml_play_grade.padEnd(15)} BA: ${a21.best_angle_eligible_ml ? "★21" : "  "} ${a22.ml_best_angle_eligible ? "★22" : "  "}`);
    console.log(`  OU pick           V2.1=${(v21.predicted_ou_side ?? "HOLD").padEnd(5)} V2.2=${(v22.predicted_ou_side ?? "HOLD").padEnd(5)} ${ouAgree ? "agree" : "DISAGREE"}`);
    console.log(`  OU conf           V2.1=${fmt(v21OuConf, 1).padStart(5)}  V2.2=${fmt(v22.ou_confidence, 1).padStart(5)}  Δ=${deltaTag(ouConfDelta, 1)}`);
    console.log(`  OU play grade     V2.1=${a21.ou_play_grade.padEnd(15)} V2.2=${a22.ou_play_grade.padEnd(15)} BA: ${a21.best_angle_eligible_ou ? "★21" : "  "} ${a22.ou_best_angle_eligible ? "★22" : "  "}`);
    if (a22.capped_by_total) console.log(`  ⚑ V2.2 posterior capped by total`);
    if (a22.capped_by_diff) console.log(`  ⚑ V2.2 posterior capped by diff`);
    if (a22.model_integrity_notes.length > 0) {
      console.log(`  V2.2 notes:`);
      for (const note of a22.model_integrity_notes) console.log(`    • ${note}`);
    }
    if (a22.ml_best_angle_reason) console.log(`  V2.2 BA ML: ${a22.ml_best_angle_reason}`);
    if (a22.ou_best_angle_reason) console.log(`  V2.2 BA OU: ${a22.ou_best_angle_reason}`);
    console.log("");
  }

  const avgAbs = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((s, n) => s + Math.abs(n), 0) / arr.length;
  const avgSigned = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((s, n) => s + n, 0) / arr.length;

  console.log("━━━ V2.1 vs V2.2 aggregate report ━━━\n");
  console.log(`  Games:                          ${snapshots.length}`);
  console.log(`  ML pick disagreements:          ${mlDisagree} of ${snapshots.length}`);
  console.log(`  OU pick disagreements:          ${ouDisagree} of ${snapshots.length}`);
  console.log(`  Best Angle ML  V2.1 → V2.2:     ${v21BA_ml} → ${v22BA_ml}`);
  console.log(`  Best Angle OU  V2.1 → V2.2:     ${v21BA_ou} → ${v22BA_ou}`);
  console.log(`  V2.2 provisional:               ${v22Provisional} of ${snapshots.length}`);
  console.log(`  V2.2 capped (total or diff):    ${v22Capped} of ${snapshots.length}`);
  console.log(`  V2.2 fallback-tier games:       ${v22FallbackTier} of ${snapshots.length}`);
  console.log(`  V2.2 data-quality tiers:        ${JSON.stringify(v22TierCounts)}`);
  console.log(`  Avg |Δ projected total|:        ${avgAbs(totalDeltas).toFixed(2)}r   (signed avg ${avgSigned(totalDeltas).toFixed(2)})`);
  console.log(`  Avg |Δ run differential|:       ${avgAbs(diffDeltas).toFixed(2)}r   (signed avg ${avgSigned(diffDeltas).toFixed(2)})`);
  console.log(`  Avg |Δ ML model prob|:          ${(avgAbs(mlProbDeltas) * 100).toFixed(2)}%`);
  console.log(`  Avg |Δ ML confidence|:          ${avgAbs(mlConfDeltas).toFixed(2)} pts`);
  console.log(`  Avg |Δ OU confidence|:          ${avgAbs(ouConfDeltas).toFixed(2)} pts`);
  if (Object.keys(v22IntegrityNotes).length > 0) {
    console.log(`\n  V2.2 integrity-note frequencies:`);
    for (const [k, v] of Object.entries(v22IntegrityNotes).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${v.toString().padStart(3)} × ${k}`);
    }
  }

  console.log(`\n  DRY RUN — NO DB WRITES PERFORMED.\n`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
