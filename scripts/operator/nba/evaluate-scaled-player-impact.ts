/** Evaluates an already frozen C6 head; no fit, provider or production write. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { scoreNbaScaledPlayerImpact, type NbaScaledImpactHead, type NbaScaledImpactInput } from "../../../lib/research/nba/nbaScaledPlayerImpact";
import { nbaClimateDay } from "../../../lib/research/nba/nbaPriorFinalsCalibration";
type Row = NbaScaledImpactInput & { gameId: string; baselineHash: string; actualMargin: number; actualTotal: number;
  baselineMargin: number; baselineTotal: number; startAt: string };
const [input, frozenPath, output] = process.argv.slice(2);
if (!input || !frozenPath || !output || fs.existsSync(output)) throw Error("usage: evaluate-scaled-player-impact INPUT FROZEN_HEAD NEW_REPORT.gz");
const bytes = fs.readFileSync(input), source = JSON.parse(gunzipSync(bytes).toString()), frozen = JSON.parse(fs.readFileSync(frozenPath, "utf8"));
const head = frozen.head as NbaScaledImpactHead, originals = source.rows as Row[], before = nbaPlayerStateHash(originals);
if (frozen.inputSha256 !== createHash("sha256").update(bytes).digest("hex") || originals.length > 10000 ||
    new Set(originals.map(r => r.gameId)).size !== originals.length) throw Error("changed_frozen_impact_input");
const evaluations = originals.filter(r => [2023, 2024, 2025].includes(r.season)).map(r => {
  if (r.baselineHash !== source.evaluationBaselineHash) throw Error("changed_impact_comparator");
  const c = scoreNbaScaledPlayerImpact(head, r), margin = r.baselineMargin + c.marginCorrection, total = r.baselineTotal + c.totalCorrection;
  if (![margin, total].every(Number.isFinite) || total <= Math.abs(margin)) throw Error("invalid_impact_forecast");
  const teamLoss = (m: number, t: number) => Math.max(Math.abs(m - r.actualMargin), Math.abs(t - r.actualTotal)) / 2;
  return { gameId: r.gameId, season: r.season, startAt: r.startAt, cutoff: r.cutoff,
    actualMargin: r.actualMargin, actualTotal: r.actualTotal, baselineMargin: r.baselineMargin, baselineTotal: r.baselineTotal,
    candidateMargin: margin, candidateTotal: total, ...c,
    teamLossA: teamLoss(r.baselineMargin, r.baselineTotal), teamLossC: teamLoss(margin, total) };
});
type Evaluation = typeof evaluations[number];
const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;
function metrics(a: Evaluation[]) {
  return { games: a.length, teamMAE_A: mean(a.map(r => r.teamLossA)), teamMAE_C: mean(a.map(r => r.teamLossC)),
    teamMAE_gain: mean(a.map(r => r.teamLossA - r.teamLossC)),
    marginMAE_A: mean(a.map(r => Math.abs(r.baselineMargin - r.actualMargin))), marginMAE_C: mean(a.map(r => Math.abs(r.candidateMargin - r.actualMargin))),
    totalMAE_A: mean(a.map(r => Math.abs(r.baselineTotal - r.actualTotal))), totalMAE_C: mean(a.map(r => Math.abs(r.candidateTotal - r.actualTotal))),
    marginBias_A: mean(a.map(r => r.baselineMargin - r.actualMargin)), marginBias_C: mean(a.map(r => r.candidateMargin - r.actualMargin)),
    totalBias_A: mean(a.map(r => r.baselineTotal - r.actualTotal)), totalBias_C: mean(a.map(r => r.candidateTotal - r.actualTotal)),
    winnerCorrect_A: a.filter(r => (r.baselineMargin > 0) === (r.actualMargin > 0)).length,
    winnerCorrect_C: a.filter(r => (r.candidateMargin > 0) === (r.actualMargin > 0)).length };
}
const byWeek = new Map<string, Evaluation[]>();
for (const r of evaluations) {
  const day = nbaClimateDay(r.startAt), monday = day - ((day + 3) % 7), key = `${r.season}:${monday}`;
  byWeek.set(key, [...(byWeek.get(key) ?? []), r]);
}
const weeks = [...byWeek].sort(([a], [b]) => a.localeCompare(b)).map(([week, rows]) => ({ week, season: rows[0].season, ...metrics(rows) }));
const development = metrics(evaluations.filter(r => r.season !== 2025)), replication = metrics(evaluations.filter(r => r.season === 2025));
const devWeeks = weeks.filter(w => w.season !== 2025), bootstrap: number[] = [];
let seed = 20261123;
for (let draw = 0; draw < 1000; draw++) {
  let gain = 0, games = 0;
  for (let j = 0; j < devWeeks.length; j++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const w = devWeeks[Math.floor(seed / 4294967296 * devWeeks.length)];
    gain += w.teamMAE_gain * w.games; games += w.games;
  }
  bootstrap.push(gain / games);
}
bootstrap.sort((a, b) => a - b);
const ci = [bootstrap[24], bootstrap[974]], noRegression = (m: ReturnType<typeof metrics>) => m.marginMAE_C <= m.marginMAE_A && m.totalMAE_C <= m.totalMAE_A;
const developmentGatePassed = development.teamMAE_gain >= .10 && ci[0] > 0 && noRegression(development);
const replicationGatePassed = replication.teamMAE_gain > 0 && noRegression(replication);
if (nbaPlayerStateHash(originals) !== before) throw Error("impact_input_mutation");
const report = { release: head.release, headHash: head.hash, frozenAt: frozen.frozenAt, inputSha256: frozen.inputSha256,
  labels: { development: "reopened_2023_2024", replication: "opened_2025", untouchedHoldout: false,
    comparator: "earlier_fit_native_A2_not_current_incumbent", pointForecastsOnly: true },
  development, replication, bySeason: Object.fromEntries([2023, 2024, 2025].map(s => [s, metrics(evaluations.filter(r => r.season === s))])),
  weekBlockBootstrap: { draws: 1000, seed: 20261123, calendar: "Eastern_Monday_slate_week", teamMAEGain95CI: ci },
  developmentGatePassed, replicationGatePassed, mayAdvanceToNextValidationStage: developmentGatePassed && replicationGatePassed,
  productionPromotionEligible: false, unknownLedgerRows: source.unknownLedgerRows, unchangedC2ComparisonRows: source.unchangedC2ComparisonRows,
  originalsHashBefore: before, originalsHashAfter: nbaPlayerStateHash(originals), fittingPerformed: false, providerRequests: 0, productionWrites: 0,
  weeks, evaluations };
fs.writeFileSync(output, gzipSync(JSON.stringify(report)), { flag: "wx", mode: 0o600 });
const summary = { ...report, weeks: undefined, evaluations: undefined };
fs.writeFileSync(output + ".summary.json", JSON.stringify(summary, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(summary));
