import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { cbbScoreFeatures, correctCbbScoreForecast, fitCbbScoreResearchState, type CbbScoreCorrection, type CbbScoreFeatureRow, type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import { applyCbbShotHead, type CbbShotHead } from "../../lib/cbb/shotProfileResearch";
import { enrichCbbMatchupMechanisms, enrichCbbEvidenceMaturity } from "../../lib/cbb/matchupMechanismResearch";
import { forecastCbbGame } from "../../lib/cbb/model";
import { compareCbbNeutralOrientations } from "../../lib/cbb/lossAudit";
import type { CbbBox, CbbForecast, CbbGame, CbbRatingState, CbbUncertainty, CbbVenue } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(a => /^(--write|--publish|--activate)/.test(a))) throw new Error("private invariant audit only");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
async function main() {
  const rawGames: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    rawGames.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(rawGames, boxes, venues).games;
  const frozen = (await read<CbbScoreFeatureRow[]>("candidate-r2-diagnostic.json")).filter(r => r.game.neutral === true);
  const r8Frozen = new Map((await read<CbbScoreFeatureRow[]>("candidate-r8-diagnostic.json")).map(r => [r.game.id, r.forecast]));
  const artifact = await read<{ config: CbbScoreResearchConfig; uncertainty: CbbUncertainty; correction: CbbScoreCorrection }>("candidate-r2-artifact.json");
  const head = await read<CbbShotHead>("candidate-r8-head.json");
  let prior: CbbRatingState | undefined;
  for (const season of [2022, 2023, 2024]) prior = fitCbbScoreResearchState(history, { season, asOf: `${season + 1}-07-01T00:00:00.000Z`, config: artifact.config, prior });
  const states = new Map<string, CbbRatingState>(), raw: CbbScoreFeatureRow[] = [], baseline: Array<{ original: CbbForecast; swapped: CbbForecast }> = [];
  for (const row of frozen) {
    const asOf = row.forecast.asOf;
    let state = states.get(asOf);
    if (!state) { state = fitCbbScoreResearchState(history, { season: 2025, asOf, config: artifact.config, prior }); states.set(asOf, state); }
    const available = history.filter(g => g.season === 2025 && Date.parse(g.date) + 21600000 <= Date.parse(asOf));
    const g = row.game;
    const reverse = { ...g, homeId: g.awayId, awayId: g.homeId, homeScore: g.awayScore, awayScore: g.homeScore,
      homeRegulation: g.awayRegulation, awayRegulation: g.homeRegulation, homeFactors: g.awayFactors, awayFactors: g.homeFactors };
    const forecasts = [g, reverse].map(game => {
      const forecast = forecastCbbGame(state!, game, artifact.uncertainty), features = cbbScoreFeatures(forecast, state!, game, available);
      raw.push({ game, forecast, features });
      return correctCbbScoreForecast(forecast, features, artifact.correction, game.season);
    });
    if (Math.abs(forecasts[0].margin - row.forecast.margin) > 1e-8 || Math.abs(forecasts[0].total - row.forecast.total) > 1e-8) throw new Error("frozen neutral r2 replay mismatch");
    baseline.push({ original: forecasts[0], swapped: forecasts[1] });
  }
  const r8 = applyCbbShotHead(enrichCbbEvidenceMaturity(enrichCbbMatchupMechanisms(raw, history, boxes)), head);
  const comparison = frozen.map((row, i) => {
    const r2 = baseline[i], original = r8[i * 2].forecast, swapped = r8[i * 2 + 1].forecast, stored = r8Frozen.get(row.game.id)!;
    if (Math.abs(original.margin - stored.margin) > 1e-8 || Math.abs(original.total - stored.total) > 1e-8) throw new Error("frozen neutral r8 replay mismatch");
    return { gameId: row.game.id, date: row.game.date, asOf: row.forecast.asOf,
      r2: compareCbbNeutralOrientations(row.game, r2.original, r2.swapped), r8: compareCbbNeutralOrientations(row.game, original, swapped) };
  });
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  const summarize = (version: "r2" | "r8") => {
    const rows = comparison.map(r => r[version]), sorted = rows.map(r => r.absoluteMarginDiscrepancy).sort((a, b) => a - b);
    return { games: rows.length, differingMargins: rows.filter(r => r.absoluteMarginDiscrepancy > 1e-8).length,
      winnerChangesFromListingOnly: rows.filter(r => r.winnerChangesFromListingOnly).length,
      meanAbsoluteMarginDiscrepancy: mean(rows.map(r => r.absoluteMarginDiscrepancy)), medianAbsoluteMarginDiscrepancy: sorted[Math.floor(sorted.length / 2)],
      maximumAbsoluteMarginDiscrepancy: Math.max(...sorted), meanTotalDiscrepancy: mean(rows.map(r => r.totalDiscrepancy)),
      meanHomeProbabilityDiscrepancy: mean(rows.map(r => r.homeProbabilityDiscrepancy)) };
  };
  const report = { audit: "cbb_neutral_orientation_invariant_2026_10_28_r1", productionWrites: 0, providerCalls: 0, predictionChanges: 0,
    method: "Original scores reproduce exactly before swapping neutral-site labels. Same state, timestamps, team statistics and heads. No outcome-conditioned orientation choice.",
    r2: summarize("r2"), r8: summarize("r8"), comparisons: comparison,
    conclusion: "Any discrepancy is an orientation-invariance defect, not evidence that choosing the opposite orientation improves predictions. A repair requires a separately versioned and evaluated candidate; original records remain unchanged." };
  await writeFile(`${dir}/cbb-neutral-orientation-audit.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ r2: report.r2, r8: report.r8, conclusion: report.conclusion }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
