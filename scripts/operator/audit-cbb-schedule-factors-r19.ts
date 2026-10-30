import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { enrichScheduleFactors, CBB_SCHEDULE_FACTOR_RESEARCH_RELEASE } from "../../lib/cbb/scheduleFactorResearch";
import { applyCbbScoreCorrection, fitCbbScoreCorrection, type CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import type { CbbBox, CbbGame, CbbVenue } from "../../lib/cbb/types";

const directory = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private CBB audit only");
const inputSha256: Record<string, string> = {};
const read = async <T>(name: string): Promise<T> => {
  const raw = await readFile(`${directory}/${name}`, "utf8");
  inputSha256[name] = createHash("sha256").update(raw).digest("hex");
  return JSON.parse(raw);
};
const summary = (rows: CbbScoreFeatureRow[]) => {
  const m = evaluateCbbRows(rows);
  return { games: m.games, wins: m.wins, marginMae: m.marginMae, totalMae: m.totalMae, brier: m.brier, logLoss: m.logLoss };
};
async function main() {
  if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("CBB audit requires a clean source commit");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  const development = await read<CbbScoreFeatureRow[]>("score-feature-development.json");
  const selection = await read<CbbScoreFeatureRow[]>("score-feature-selection.json");
  if (development.some(row => row.game.season !== 2023) || selection.some(row => row.game.season !== 2024) ||
    new Set(selection.map(row => row.game.id)).size !== selection.length ||
    selection.length !== history.filter(game => game.season === 2024).length) throw new Error("CBB factor cohort mismatch");
  const baseline = applyCbbScoreCorrection(selection, fitCbbScoreCorrection(development, "matchup", 2023));
  const candidates = [];
  for (const ridge of [2, 5, 10]) {
    const dev = enrichScheduleFactors(development, history, ridge);
    const sel = enrichScheduleFactors(selection, history, ridge);
    const correction = fitCbbScoreCorrection(dev, "matchup", 2023);
    const selected = applyCbbScoreCorrection(sel, correction);
    const baseMap = new Map(baseline.map(row => [row.game.id, row]));
    const flips = selected.reduce((r, row) => {
      const old = baseMap.get(row.game.id)!;
      const outcome = row.game.homeScore > row.game.awayScore;
      const before = (old.forecast.homeWinProbability >= 0.5) === outcome;
      const after = (row.forecast.homeWinProbability >= 0.5) === outcome;
      r.corrections += Number(!before && after); r.harms += Number(before && !after);
      return r;
    }, { corrections: 0, harms: 0 });
    candidates.push({ ridge, selection: summary(selected), flips, correction });
    console.log(JSON.stringify({ ridge, selection: summary(selected), flips }));
  }
  const report = { release: CBB_SCHEDULE_FACTOR_RESEARCH_RELEASE, productionWrites: 0, sourceCommit, inputSha256, trainSeason: 2023,
    selectionSeason: 2024, baseline: summary(baseline), candidates,
    qualification: "must improve 2024 winner, margin and total and exact-quote ML/Spread/Total without material regression before any activation",
    caveat: "2025 already opened; may be used only as retrospective diagnostic" };
  await writeFile(`${directory}/schedule-factor-r19-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ release: report.release, baseline: report.baseline,
    candidates: candidates.map(row => ({ ridge: row.ridge, selection: row.selection, flips: row.flips })) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
