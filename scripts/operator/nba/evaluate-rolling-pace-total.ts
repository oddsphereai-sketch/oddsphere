import fs from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { scoreNbaRollingPaceTotal, validateNbaRollingPaceHead, type NbaRollingPaceHead } from "../../../lib/research/nba/nbaRollingPaceTotal";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { nbaClimateDay } from "../../../lib/research/nba/nbaPriorFinalsCalibration";
const [input, frozenPath, output] = process.argv.slice(2);
if (!input || !frozenPath || !output || fs.existsSync(output)) throw Error("usage: evaluate-rolling-pace-total INPUT HEAD NEW_REPORT.gz");
const bytes = fs.readFileSync(input), source = JSON.parse(gunzipSync(bytes).toString()), frozen = JSON.parse(fs.readFileSync(frozenPath, "utf8"));
const head = frozen.head as NbaRollingPaceHead;
if (frozen.inputSha256 !== createHash("sha256").update(bytes).digest("hex")) throw Error("changed_frozen_pace_input");
validateNbaRollingPaceHead(head);
type SourceRow = { gameId: string; season: number; cutoff: string; startAt: string; durationAwareFeatures: Record<string, number | null>; features: Record<string, number | null>;
  baselineMargin: number; baselineTotal: number; actualMargin: number; actualTotal: number; recentOvertimeExposed: boolean; sourceSha256: string };
const originals = source.rows as SourceRow[], before = nbaPlayerStateHash(originals);
if (originals.length > 10000 || new Set(originals.map(r => r.gameId)).size !== originals.length) throw Error("pace_source_budget_or_duplicates");
const evaluations = originals.filter(r => [2023, 2024, 2025].includes(r.season)).map(r => {
  const result = scoreNbaRollingPaceTotal(head, r.season, r.cutoff, r.features, r.durationAwareFeatures);
  return { gameId: r.gameId, season: r.season, cutoff: r.cutoff, startAt: r.startAt, sourceSha256: r.sourceSha256,
    actualMargin: r.actualMargin, actualTotal: r.actualTotal, ...result, totalCorrection: result.candidateTotal - result.baselineTotal,
    recentOvertimeExposed: r.recentOvertimeExposed };
});
type E = typeof evaluations[number];
const mean = (a: number[]) => a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
function metrics(rows: E[]) {
  return { games: rows.length, totalMAE_A: mean(rows.map(r => Math.abs(r.baselineTotal - r.actualTotal))),
    totalMAE_C: mean(rows.map(r => Math.abs(r.candidateTotal - r.actualTotal))),
    totalMAE_gain: mean(rows.map(r => Math.abs(r.baselineTotal - r.actualTotal) - Math.abs(r.candidateTotal - r.actualTotal))),
    totalBias_A: mean(rows.map(r => r.baselineTotal - r.actualTotal)), totalBias_C: mean(rows.map(r => r.candidateTotal - r.actualTotal)),
    marginMAE_A: mean(rows.map(r => Math.abs(r.baselineMargin - r.actualMargin))), marginMAE_C: mean(rows.map(r => Math.abs(r.candidateMargin - r.actualMargin))),
    teamMAE_A: mean(rows.map(r => Math.max(Math.abs(r.baselineMargin - r.actualMargin), Math.abs(r.baselineTotal - r.actualTotal)) / 2)),
    teamMAE_C: mean(rows.map(r => Math.max(Math.abs(r.candidateMargin - r.actualMargin), Math.abs(r.candidateTotal - r.actualTotal)) / 2)),
    marginChanges: rows.filter(r => r.candidateMargin !== r.baselineMargin).length };
}
const groups = new Map<string, E[]>();
for (const r of evaluations) {
  const day = nbaClimateDay(r.startAt), monday = day - (day + 3) % 7, key = `${r.season}:${monday}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
const weeks = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([week, rows]) => ({ week, season: rows[0].season, ...metrics(rows) }));
const dev = evaluations.filter(r => r.season !== 2025), rep = evaluations.filter(r => r.season === 2025);
const development = metrics(dev), replication = metrics(rep), bySeason = Object.fromEntries([2023, 2024, 2025].map(s => [s, metrics(evaluations.filter(r => r.season === s))]));
const devWeeks = weeks.filter(w => w.season !== 2025), bootstrap: number[] = []; let seed = 20261123;
for (let draw = 0; draw < 1000; draw++) {
  let sum = 0, games = 0;
  for (let j = 0; j < devWeeks.length; j++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const w = devWeeks[Math.floor(seed / 4294967296 * devWeeks.length)]; sum += w.totalMAE_gain! * w.games; games += w.games;
  }
  bootstrap.push(sum / games);
}
bootstrap.sort((a, b) => a - b); const ci = [bootstrap[24], bootstrap[974]];
const developmentGatePassed = development.totalMAE_gain! >= .10 && ci[0] > 0 && bySeason[2023].totalMAE_gain! > 0 && bySeason[2024].totalMAE_gain! > 0 && development.marginChanges === 0;
const replicationGatePassed = replication.totalMAE_gain! > 0 && replication.marginChanges === 0;
if (nbaPlayerStateHash(originals) !== before) throw Error("pace_source_mutation");
const report = { createdAt: new Date().toISOString(), release: head.release, headHash: head.hash, frozenAt: frozen.frozenAt,
  inputSha256: frozen.inputSha256, labels: { development: "reopened_2023_2024", replication: "opened_2025", untouchedHoldout: false,
    comparator: "annual_prior_seasons_native_recipe_not_current_incumbent", pointForecastsOnly: true, totalOnlyDeclaredBeforeFit: true },
  development, replication, bySeason, overtimeExposure: { development: metrics(dev.filter(r => r.recentOvertimeExposed)),
    developmentUnexposed: metrics(dev.filter(r => !r.recentOvertimeExposed)), replication: metrics(rep.filter(r => r.recentOvertimeExposed)),
    replicationUnexposed: metrics(rep.filter(r => !r.recentOvertimeExposed)) },
  weekBlockBootstrap: { draws: 1000, seed: 20261123, calendar: "Eastern_Monday_slate_week", totalMAEGain95CI: ci },
  developmentGatePassed, replicationGatePassed, mayAdvanceToNextValidationStage: developmentGatePassed && replicationGatePassed,
  productionPromotionEligible: false, originalRowsHashBefore: before, originalRowsHashAfter: nbaPlayerStateHash(originals),
  fittingPerformed: false, providerRequests: 0, productionWrites: 0, weeks, evaluations };
fs.writeFileSync(output, gzipSync(JSON.stringify(report)), { flag: "wx", mode: 0o600 });
const summary = { ...report, weeks: undefined, evaluations: undefined };
fs.writeFileSync(output + ".summary.json", JSON.stringify(summary, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(summary));
