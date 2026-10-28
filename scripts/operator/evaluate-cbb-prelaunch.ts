import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { CBB_CANDIDATES, fitCbbRatings } from "../../lib/cbb/model";
import { CBB_DEVELOPMENT_UNCERTAINTY, cbbMonthlyMetrics, evaluateCbbRows, fitCbbUncertainty, replayCbbSeason } from "../../lib/cbb/evaluation";
import { CBB_MODEL_RELEASE } from "../../lib/cbb/releases";
import type { CbbBox, CbbGame, CbbVenue } from "../../lib/cbb/types";

const args = process.argv.slice(2);
if (args.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("CBB evaluation cannot publish");
const dir = resolve(args.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
async function data<T>(name: string): Promise<T[]> { return JSON.parse(await readFile(resolve(dir, name), "utf8")).data; }
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...await data<CbbGame>(`games-${season}.json`));
    boxes.push(...await data<CbbBox>(`boxes-${season}.json`));
    venues.push(...await data<CbbVenue>(`venues-${season}.json`));
  }
  const dataset = buildCbbTrainingGames(games, boxes, venues);
  const historicalDataSha256 = createHash("sha256").update(JSON.stringify(dataset.games)).digest("hex");
  const selection = [];
  for (const config of CBB_CANDIDATES) {
    const development = replayCbbSeason(dataset.games, 2023, config, CBB_DEVELOPMENT_UNCERTAINTY);
    const uncertainty = fitCbbUncertainty(development, 2023);
    const tuning = replayCbbSeason(dataset.games, 2024, config, uncertainty);
    const metrics = evaluateCbbRows(tuning);
    selection.push({ config, uncertainty, development, tuning, metrics });
    console.log(JSON.stringify({ config: config.id, tuning: metrics }));
  }
  // Choose on proper probability score, with score error as deterministic tie-breaker. Holdout unopened until this point.
  selection.sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.teamScoreMae - b.metrics.teamScoreMae || a.config.id.localeCompare(b.config.id));
  const selected = selection[0];
  const uncertainty = fitCbbUncertainty([...selected.development, ...selected.tuning], 2024);
  const confirmation = replayCbbSeason(dataset.games, 2025, selected.config, uncertainty);
  const report = {
    release: CBB_MODEL_RELEASE, generatedAt: new Date().toISOString(), productionWrites: 0,
    historicalDataSha256, selectionCriterion: "2024 log loss; team MAE tie-breaker", exclusions: dataset.rejected,
    venueCoverage: { matched: venues.length, finalDiTraining: dataset.games.length, missing: dataset.games.filter(game => game.neutral === null).length },
    development: evaluateCbbRows(selected.development), selection: selection.map(row => ({ config: row.config, metrics: row.metrics })),
    confirmation: evaluateCbbRows(confirmation), confirmationMonthly: cbbMonthlyMetrics(confirmation),
    historicalPriceValidation: "unavailable; no price/units/ROI or sharp-reader improvement claimed",
    historicalAvailabilityValidation: "unavailable; outcome archives do not establish pregame injury or roster announcements",
  };
  let prior;
  for (const season of [2022, 2023, 2024, 2025]) prior = fitCbbRatings(dataset.games, {
    season, asOf: `${season + 1}-07-01T00:00:00.000Z`, config: selected.config, prior,
  });
  await writeFile(resolve(dir, "candidate-artifact.json"), JSON.stringify({ release: CBB_MODEL_RELEASE, config: selected.config,
    uncertainty, historicalDataSha256, prior, selectedThroughSeason: 2024, confirmationThroughSeason: 2025 }, null, 2));
  await writeFile(resolve(dir, "evaluation-report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(dir, "confirmation-rows.json"), JSON.stringify(confirmation));
  console.log(JSON.stringify({ selected: selected.config, confirmation: report.confirmation, monthly: report.confirmationMonthly }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
