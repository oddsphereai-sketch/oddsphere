/**
 * Phase 6B — operator script: V1 vs V2 shadow comparison for a slate.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/automodel-v2-shadow.ts \
 *     --date 2026-06-06
 *   (optional: --sport mlb)
 *
 * READ-ONLY. Runs V1 + V2 in dry-run on every game of the requested
 * slate and emits a side-by-side comparison so operator can validate the
 * "market as prior, not prison" architecture against today's real data
 * without any DB writes.
 *
 * Output:
 *   - Per-game row: matchup | market total | market implied home/away |
 *     V1 home/away/total/pick | V2 home/away/total/pick | residuals |
 *     cap | fallback | confidence delta
 *   - Slate summary: pick agreement rate, score spread before/after,
 *     fallback rate, cap activation rate
 *
 * Does NOT call ingestScoresModel, does NOT invoke updateMarketSignals
 * or updateGrades, does NOT touch game_predictions or slates tables.
 *
 * Phase 6B.0 scope: full-game V2 only. NRFI passes through V1
 * unchanged because market FI lines aren't ingested in the snapshot today.
 */

import { rejectWriteFlag } from "./_cliCommon";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../../lib/automodel/mlbAutoModelV1";
import { runMlbAutoModelV2 } from "../../lib/automodel/mlbAutoModelV2";
import type { Sport } from "../../lib/types/domain/Sport";

type Args = { sport: Sport; date: string };

function parseArgs(argv: string[]): Args {
  let date: string | null = null;
  let sport: Sport = "mlb";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
  }
  if (!date) {
    console.error("Usage: automodel-v2-shadow.ts --date YYYY-MM-DD [--sport mlb]");
    process.exit(1);
  }
  return { sport, date };
}

function fmt(n: number | null | undefined, w = 5): string {
  if (n === null || n === undefined) return "—".padStart(w);
  return n.toFixed(1).padStart(w);
}

function pad(s: string | null | undefined, w: number): string {
  return (s ?? "—").padEnd(w);
}

async function main() {
  rejectWriteFlag(process.argv);
  const opts = parseArgs(process.argv);

  console.log(`\n━━━ V1 vs V2 Shadow Comparison · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`         DRY RUN — NO DB WRITES — READ-ONLY`);
  console.log("");

  const snapshots = await buildFeatureSnapshots(opts.sport, opts.date);
  console.log(`Loaded ${snapshots.length} game snapshot(s).`);
  if (snapshots.length === 0) {
    console.log("No games to compare. Exiting.");
    return;
  }

  // Header — line 1: predictions, line 2: data quality + best angle
  console.log("");
  console.log("matchup             | mkt T | mkt H/A   | V1 H/A    | V2 H/A    | V1 T | V2 T | V2 ML | V2 OU | V2 ML conf | V2 OU conf | tier | provis | BestAngle | missing inputs / update triggers");
  console.log("─".repeat(220));

  let pickAgreements = 0;
  let pickAgreeable = 0;
  let fallbackCount = 0;
  let provisionalCount = 0;
  let capActiveCount = 0;
  let bestAngleCount = 0;
  let v1HomeScores: number[] = [];
  let v2HomeScores: number[] = [];

  for (const snap of snapshots) {
    const v1 = runMlbAutoModelV1(snap, "morning_draft");
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    const audit = v2.v2Audit;
    const matchup = `${snap.away_team.abbreviation}@${snap.home_team.abbreviation}`.padEnd(12);
    const mktT = fmt(audit.marketBaseline.listedTotal);
    const mktHA = `${fmt(audit.marketBaseline.homeImpliedTotal, 4)}/${fmt(audit.marketBaseline.awayImpliedTotal, 4)}`;
    const v1HA = `${fmt(v1.predicted_home_score, 4)}/${fmt(v1.predicted_away_score, 4)}`;
    const v2HA = `${fmt(v2.predicted_home_score, 4)}/${fmt(v2.predicted_away_score, 4)}`;
    const tier = audit.dataQuality.tier.padEnd(8);
    const provis = audit.provisional ? "Y" : " ";
    const ba = audit.bestAngleEligibility.eligible ? "★ YES" : "  no";
    const missing = audit.dataQuality.missingInputs.length > 0
      ? `missing:[${audit.dataQuality.missingInputs.join(",")}] triggers:[${audit.dataQuality.updateTriggers.join(",")}]`
      : "—";

    console.log(
      `${matchup} (${snap.game_external_id})  | ${mktT} | ${mktHA} | ${v1HA} | ${v2HA} | ${fmt(v1.predicted_total)} | ${fmt(v2.predicted_total)} | ${pad(v2.predicted_ml_winner, 5)} | ${pad(v2.predicted_ou_side, 5)} | ${fmt(v2.ml_confidence, 8)}   | ${fmt(v2.ou_confidence, 8)}   | ${tier} | ${provis}      | ${ba.padEnd(8)} | ${missing}`
    );

    if (v1.predicted_ml_winner !== null && v2.predicted_ml_winner !== null) {
      pickAgreeable++;
      if (v1.predicted_ml_winner === v2.predicted_ml_winner) pickAgreements++;
    }
    if (audit.fallback) fallbackCount++;
    if (audit.provisional) provisionalCount++;
    if (audit.capActiveHome || audit.capActiveAway) capActiveCount++;
    if (audit.bestAngleEligibility.eligible) bestAngleCount++;
    if (v1.predicted_home_score !== null) v1HomeScores.push(v1.predicted_home_score);
    if (v2.predicted_home_score !== null) v2HomeScores.push(v2.predicted_home_score);
  }

  console.log("");
  console.log("━━━ Summary ━━━");
  console.log(`  Total games:                                  ${snapshots.length}`);
  console.log(`  V1 vs V2 ML pick agreement (where both set):  ${pickAgreements}/${pickAgreeable}` +
    (pickAgreeable > 0 ? ` (${Math.round((pickAgreements / pickAgreeable) * 100)}%)` : ""));
  console.log(`  V2 provisional (data-limited):                ${provisionalCount}/${snapshots.length}`);
  console.log(`  V2 Best Angle eligible:                       ${bestAngleCount}/${snapshots.length}`);
  console.log(`  V2 fallback to V1 (market data missing):      ${fallbackCount}/${snapshots.length}`);
  console.log(`  Residual cap binding (V2 hit ±2.5):           ${capActiveCount}/${snapshots.length}`);

  if (v1HomeScores.length > 0) {
    const v1Mean = v1HomeScores.reduce((a, b) => a + b, 0) / v1HomeScores.length;
    const v1Std = Math.sqrt(
      v1HomeScores.reduce((a, b) => a + (b - v1Mean) ** 2, 0) / v1HomeScores.length
    );
    const v2Mean = v2HomeScores.reduce((a, b) => a + b, 0) / v2HomeScores.length;
    const v2Std = Math.sqrt(
      v2HomeScores.reduce((a, b) => a + (b - v2Mean) ** 2, 0) / v2HomeScores.length
    );
    console.log(`  V1 home-score: mean=${v1Mean.toFixed(2)}, std=${v1Std.toFixed(2)}`);
    console.log(`  V2 home-score: mean=${v2Mean.toFixed(2)}, std=${v2Std.toFixed(2)} (higher std = less compression)`);
  }

  console.log("");
  console.log("  DRY RUN — NO DB WRITES PERFORMED.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
