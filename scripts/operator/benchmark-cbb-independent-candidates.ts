/** Exact-quote-time audits of already-selected private heads; no model selection here. */
import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { cbbScoreFeatures, correctCbbScoreForecast, fitCbbScoreResearchState, type CbbScoreCorrection, type CbbScoreFeatureRow, type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import { forecastCbbGame, settleCbbMarket, cbbThresholdProbabilities } from "../../lib/cbb/model";
import { applyCbbShotHead, type CbbShotHead } from "../../lib/cbb/shotProfileResearch";
import { enrichCbbMatchupMechanisms, enrichCbbEvidenceMaturity } from "../../lib/cbb/matchupMechanismResearch";
import { fitCbbStructuralPrior, fitCbbStructuralState, type CbbStructuralVariant } from "../../lib/cbb/structuralResearch";
import type { CbbBox, CbbForecast, CbbGame, CbbMarket, CbbQuote, CbbRatingState, CbbUncertainty, CbbVenue } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
const includeMaturity = process.argv.includes("--include-maturity");
const versions = ["r2", "r6", "r7", ...(includeMaturity ? ["r8"] : [])];
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private audit only");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
type Head = { release: string; config: CbbScoreResearchConfig; correction: CbbScoreCorrection; uncertainty: CbbUncertainty; variant: CbbStructuralVariant };
type TotalRow = { gameId: number; asOf: string; sportsbook: string; line: number; quoteId: number; overPrice: number; underPrice: number; r2Total: number; r2: { result: string } };
type TargetRow = CbbScoreFeatureRow & { targets: CbbQuote[] };
function summarize(rows: Array<{ game: CbbScoreFeatureRow["game"]; forecasts: Record<string, CbbForecast>; targets: CbbQuote[] }>, market: CbbMarket) {
  return Object.fromEntries(versions.map(version => {
    let wins = 0, losses = 0, pushes = 0, passes = 0, corrections = 0, harms = 0, units = 0, brier = 0, logLoss = 0, evaluated = 0;
    const changes = [];
    for (const row of rows) {
      const quote = row.targets.find(q => q.market === market); if (!quote) continue;
      const choose = (forecast: CbbForecast) => market === "moneyline" ? forecast.homeWinProbability >= 0.5 : market === "spread" ? forecast.margin + quote.line! > 0 : forecast.total > quote.line!;
      const forecast = row.forecasts[version], before = choose(row.forecasts.r2), after = choose(forecast);
      if ((market === "spread" && forecast.margin + quote.line! === 0) || (market === "total" && forecast.total === quote.line)) { passes++; continue; }
      const old = settleCbbMarket(market, before ? "first" : "second", quote.line, row.game.homeScore, row.game.awayScore);
      const result = settleCbbMarket(market, after ? "first" : "second", quote.line, row.game.homeScore, row.game.awayScore);
      const correction = old === "loss" && result === "win", harm = old === "win" && result === "loss";
      corrections += Number(correction); harms += Number(harm);
      if (before !== after) changes.push({ gameId: row.game.id, asOf: forecast.asOf, quote, oldPick: before ? "first" : "second", newPick: after ? "first" : "second", oldResult: old, newResult: result });
      wins += Number(result === "win"); losses += Number(result === "loss"); pushes += Number(result === "push");
      const price = after ? quote.firstPrice : quote.secondPrice;
      if (price === null || !Number.isFinite(price) || Math.abs(price) < 100) throw new Error("missing audit price");
      units += result === "loss" ? -1 : result === "push" ? 0 : price > 0 ? price / 100 : 100 / -price;
      if (result !== "push") {
        const probabilities = cbbThresholdProbabilities(forecast, market, quote.line);
        const p = Math.max(1e-10, Math.min(1 - 1e-10, probabilities.first / (probabilities.first + probabilities.second)));
        const y = settleCbbMarket(market, "first", quote.line, row.game.homeScore, row.game.awayScore) === "win" ? 1 : 0;
        brier += (p - y) ** 2; logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p); evaluated++;
      }
    }
    return [version, { wins, losses, pushes, passes, accuracy: wins / Math.max(1, wins + losses), corrections, harms,
      unitsAtOneRisked: units, conditionalWlBrier: brier / Math.max(1, evaluated), conditionalWlLogLoss: logLoss / Math.max(1, evaluated), changes }];
  }));
}
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games, gameMap = new Map(history.map(g => [g.id, g]));
  const artifact = await read<Head>("candidate-r2-artifact.json"), r6 = await read<Head>("candidate-r6-head.json"), r7 = await read<CbbShotHead>("candidate-r7-head.json");
  const totals = (await read<{ rows: TotalRow[] }>("opening-total-benchmark-report.json")).rows;
  const receipt = await read<{ fetchedAt: string }>("opening-total-benchmark-raw.json");
  const markets = await read<TargetRow[]>("market-reader-feature-rows.json");
  let prior: CbbRatingState | undefined;
  for (const season of [2022, 2023, 2024]) prior = fitCbbScoreResearchState(history, { season, asOf: `${season + 1}-07-01T00:00:00.000Z`, config: artifact.config, prior });
  const structuralPrior = fitCbbStructuralPrior(history, 2025, r6.config, r6.variant).prior;
  const fixtures = new Map<string, { gameId: number; asOf: string }>();
  const key = (id: number, at: string) => `${id}|${at}`;
  for (const row of totals) fixtures.set(key(row.gameId, row.asOf), row);
  for (const row of markets) fixtures.set(key(row.game.id, row.forecast.asOf), { gameId: row.game.id, asOf: row.forecast.asOf });
  const raw: CbbScoreFeatureRow[] = [], forecasts = new Map<string, Record<string, CbbForecast>>();
  let count = 0;
  for (const [id, fixture] of fixtures) {
    const game = gameMap.get(fixture.gameId); if (!game) throw new Error("missing accepted audit fixture");
    const state = fitCbbScoreResearchState(history, { season: 2025, asOf: fixture.asOf, config: artifact.config, prior });
    const forecast = { ...forecastCbbGame(state, game, artifact.uncertainty), release: state.release };
    const available = history.filter(g => g.season === 2025 && Date.parse(g.date) + 21600000 <= Date.parse(fixture.asOf));
    const features = cbbScoreFeatures(forecast, state, game, available);
    raw.push({ game, forecast, features });
    const fitted = fitCbbStructuralState(history, { season: 2025, asOf: fixture.asOf, config: r6.config, prior: structuralPrior, variant: r6.variant });
    if (!fitted.diagnostics.converged) throw new Error("unconverged quote-time CBB audit");
    const raw6 = { ...forecastCbbGame(fitted.state, game, r6.uncertainty), release: r6.release };
    const features6 = cbbScoreFeatures(raw6, fitted.state, game, available);
    forecasts.set(id, { r2: correctCbbScoreForecast(forecast, features, artifact.correction, 2025), r6: correctCbbScoreForecast(raw6, features6, r6.correction, 2025) });
    if (++count % 100 === 0) console.log(JSON.stringify({ quoteTimeReplays: count, required: fixtures.size }));
  }
  const enriched = enrichCbbMatchupMechanisms(raw, history, boxes);
  const corrected = applyCbbShotHead(enriched, r7);
  corrected.forEach(row => { forecasts.get(key(row.game.id, row.forecast.asOf))!.r7 = row.forecast; });
  if (includeMaturity) {
    const r8 = await read<CbbShotHead>("candidate-r8-head.json");
    applyCbbShotHead(enrichCbbEvidenceMaturity(enriched), r8).forEach(row => { forecasts.get(key(row.game.id, row.forecast.asOf))!.r8 = row.forecast; });
  }
  const totalRows = totals.map(row => {
    const quote: CbbQuote = { gameId: row.gameId, sportsbook: row.sportsbook, market: "total", line: row.line, firstPrice: row.overPrice, secondPrice: row.underPrice, providerObservedAt: row.asOf, fetchedAt: receipt.fetchedAt, phase: "opening" };
    const fs = forecasts.get(key(row.gameId, row.asOf))!;
    if (Math.abs(fs.r2.total - row.r2Total) > 1e-8) throw new Error("frozen R2 total benchmark changed");
    return { game: gameMap.get(row.gameId)!, forecasts: fs, targets: [quote] };
  });
  const marketRows = markets.map(row => {
    const fs = forecasts.get(key(row.game.id, row.forecast.asOf))!;
    if (Math.abs(fs.r2.margin - row.forecast.margin) > 1e-8 || Math.abs(fs.r2.total - row.forecast.total) > 1e-8) throw new Error("frozen R2 market benchmark changed");
    return { game: row.game, forecasts: fs, targets: row.targets };
  });
  const totalScoreMetrics = Object.fromEntries(versions.map(version => [version, evaluateCbbRows(totalRows.map(r => ({ game: r.game, forecast: r.forecasts[version] })))]));
  const report = { productionWrites: 0, providerCalls: 0, independentOnly: true, uniqueQuoteTimeReplays: fixtures.size,
    limitations: "Already-opened retrospective 2025-season, eight fixed Saturdays. Opening quotes, not closing or movement. ML/spread fixture orientation corroborated but not independently selection-level verified. Hypothetical all-game picks, not actionable grades, live tracking, ROI proof or guaranteed future accuracy.",
    openingTotal635: { games: totalRows.length, markets: summarize(totalRows, "total"), scores: totalScoreMetrics },
    threeMarket353: { games: marketRows.length, markets: Object.fromEntries((["moneyline", "spread", "total"] as const).map(m => [m, summarize(marketRows, m)])) } };
  if (includeMaturity) {
    const retain = (row: typeof marketRows[number]) => ({ game: row.game, baseline: row.forecasts.r2, candidate: row.forecasts.r8, targets: row.targets });
    await writeFile(`${dir}/independent-quote-loss-audit-inputs.json`, JSON.stringify({ totalRows: totalRows.map(retain), marketRows: marketRows.map(retain) }));
  }
  await writeFile(`${dir}/independent-candidate-opening-benchmark${includeMaturity ? "-r8" : ""}.json`, JSON.stringify(report, null, 2));
  const brief = (result: ReturnType<typeof summarize>) => Object.fromEntries(Object.entries(result).map(([version, value]) => [version, { ...value, changes: value.changes.length }]));
  console.log(JSON.stringify({ total635: brief(report.openingTotal635.markets), market353: Object.fromEntries(Object.entries(report.threeMarket353.markets).map(([m, rs]) => [m, brief(rs)])) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
