import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { normalCdf } from "../../lib/cbb/model";
import { applyCbbScoreCorrection, fitCbbScoreCorrection, type CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import type { CbbEvaluationRow } from "../../lib/cbb/evaluation";

const directory = "/private/tmp/oddsphere-cbb-data";
const release = "cbb_private_2026_10_29_r23_residual_persistence";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private CBB residual audit only");
const allowDirty = process.argv.includes("--development");
const inputSha256: Record<string, string> = {};
async function read<T>(name: string): Promise<T> {
  const raw = await readFile(`${directory}/${name}`, "utf8");
  inputSha256[name] = createHash("sha256").update(raw).digest("hex");
  return JSON.parse(raw) as T;
}
type SignalRow = CbbEvaluationRow & { homeSignal: number; awaySignal: number; homeResidual: number; awayResidual: number };
const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / Math.max(1, xs.length);
function signalRows(rows: CbbEvaluationRow[], season: number): SignalRow[] {
  if (rows.length < 100 || rows.some(row => row.game.season !== season ||
    Date.parse(row.forecast.asOf) > Date.parse(row.game.date)) ||
    new Set(rows.map(row => row.game.id)).size !== rows.length) throw new Error("invalid CBB residual cohort");
  const ordered = [...rows].sort((a, b) => a.game.date.localeCompare(b.game.date) || a.game.id - b.game.id);
  const previous = new Map<number, Array<{ date: string; residual: number }>>();
  const result: SignalRow[] = [];
  for (const row of ordered) {
    const asOf = Date.parse(row.forecast.asOf);
    const signal = (team: number) => mean((previous.get(team) ?? [])
      .filter(item => Date.parse(item.date) + 6 * 60 * 60 * 1000 <= asOf)
      .slice(-3).map(item => item.residual));
    const homeSignal = signal(row.game.homeId), awaySignal = signal(row.game.awayId);
    const homeResidual = row.game.homeScore - row.forecast.homeScore;
    const awayResidual = row.game.awayScore - row.forecast.awayScore;
    result.push({ ...row, homeSignal, awaySignal, homeResidual, awayResidual });
    for (const [id, residual] of [[row.game.homeId, homeResidual], [row.game.awayId, awayResidual]] as const) {
      previous.set(id, [...(previous.get(id) ?? []), { date: row.game.date, residual }]);
    }
  }
  return result;
}
function fit(rows: SignalRow[]) {
  const pairs = rows.flatMap(row => [[row.homeSignal, row.homeResidual], [row.awaySignal, row.awayResidual]]);
  const numerator = pairs.reduce((sum, [x, y]) => sum + x * y, 0);
  const denominator = 10000 + pairs.reduce((sum, [x]) => sum + x * x, 0);
  const coefficient = numerator / denominator;
  const x = pairs.map(([value]) => value), y = pairs.map(([, value]) => value);
  const xMean = mean(x), yMean = mean(y);
  const covariance = mean(x.map((value, i) => (value - xMean) * (y[i] - yMean)));
  const xSd = Math.sqrt(mean(x.map(value => (value - xMean) ** 2)));
  const ySd = Math.sqrt(mean(y.map(value => (value - yMean) ** 2)));
  return { coefficient, correlation: covariance / (xSd * ySd), trainingTeamGames: pairs.length,
    knownSignalTeamGames: pairs.filter(([value]) => value !== 0).length };
}
function apply(rows: SignalRow[], coefficient: number): CbbEvaluationRow[] {
  return rows.map(row => {
    const homeScore = row.forecast.homeScore + coefficient * row.homeSignal;
    const awayScore = row.forecast.awayScore + coefficient * row.awaySignal;
    if (!(homeScore > 0 && awayScore > 0)) throw new Error("invalid CBB residual-corrected score");
    const margin = homeScore - awayScore, total = homeScore + awayScore;
    const sd = row.forecast.uncertainty.marginSd;
    const zero = normalCdf((0.5 - margin) / sd) - normalCdf((-0.5 - margin) / sd);
    const homeWinProbability = (1 - normalCdf((0.5 - margin) / sd)) / (1 - zero);
    return { game: row.game, forecast: { ...row.forecast, homeScore, awayScore, margin, total, homeWinProbability } };
  });
}
const summary = (rows: CbbEvaluationRow[]) => {
  const m = evaluateCbbRows(rows);
  return { games: m.games, wins: m.wins, teamScoreMae: m.teamScoreMae, marginMae: m.marginMae,
    totalMae: m.totalMae, brier: m.brier, logLoss: m.logLoss, incompleteInputs: m.incompleteInputs };
};
function paired(before: CbbEvaluationRow[], after: CbbEvaluationRow[]) {
  const byId = new Map(before.map(row => [row.game.id, row]));
  let corrections = 0, harms = 0;
  for (const row of after) {
    const old = byId.get(row.game.id);
    if (!old) throw new Error("CBB residual paired row missing");
    const oldSide = old.forecast.homeWinProbability >= 0.5;
    const newSide = row.forecast.homeWinProbability >= 0.5;
    if (oldSide !== newSide) {
      if (newSide === (row.game.homeScore > row.game.awayScore)) corrections++; else harms++;
    }
  }
  return { corrections, harms };
}
async function main() {
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  if (dirty && !allowDirty) throw new Error("CBB residual audit requires a clean source commit");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const development = await read<CbbScoreFeatureRow[]>("score-feature-development.json");
  const selection = await read<CbbScoreFeatureRow[]>("score-feature-selection.json");
  const confirmation = await read<CbbEvaluationRow[]>("candidate-r2-diagnostic.json");
  const sourceAudit = await read<{ sourceCommit: string; dirtyDevelopmentRun: boolean;
    inputSha256: Record<string, string> }>("opportunity-factors-r22-report.json");
  if (sourceAudit.dirtyDevelopmentRun ||
    sourceAudit.inputSha256["score-feature-development.json"] !== inputSha256["score-feature-development.json"] ||
    sourceAudit.inputSha256["score-feature-selection.json"] !== inputSha256["score-feature-selection.json"] ||
    !sourceAudit.sourceCommit ||
    execFileSync("git", ["merge-base", "--is-ancestor", sourceAudit.sourceCommit, sourceCommit]).length) {
    throw new Error("CBB residual audit lacks matching clean feature-generation provenance");
  }
  if (development.some(row => row.game.season !== 2023) || selection.some(row => row.game.season !== 2024) ||
    confirmation.some(row => row.game.season !== 2025)) throw new Error("CBB residual audit mixed seasons");
  const selectionBaseline = applyCbbScoreCorrection(selection, fitCbbScoreCorrection(development, "matchup", 2023));
  const train = signalRows(selectionBaseline, 2024), test = signalRows(confirmation, 2025);
  const baseline = summary(test), training = fit(train);
  if (baseline.games !== 5721 || baseline.wins !== 4112 ||
    Math.abs(baseline.marginMae - 9.2788746) > 1e-5 || Math.abs(baseline.totalMae - 13.6378307) > 1e-5) {
    throw new Error("CBB residual audit frozen r2 baseline failed reproduction");
  }
  const corrected = apply(test, training.coefficient);
  const report = { release, productionWrites: 0, sourceCommit, dirtyDevelopmentRun: Boolean(dirty), inputSha256,
    trainingSeason: 2024, openedDiagnosticSeason: 2025, training,
    baseline, candidate: summary(corrected), paired: paired(test, corrected),
    testSignalCoverage: { teamGames: test.length * 2,
      knownSignalTeamGames: test.filter(row => row.homeSignal !== 0).length + test.filter(row => row.awaySignal !== 0).length },
    limitation: "2024 and 2025 are opened; residual persistence is a diagnostic, not a qualified model. The 2023/24 cached feature inputs match the prior clean source-generation audit; 2025 row-level generation parity is not separately proven here." };
  await writeFile(`${directory}/residual-persistence-r23-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
