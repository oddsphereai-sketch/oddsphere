import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { cbbScoreFeatures, fitCbbScoreResearchState, type CbbScoreFeatureRow, type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import { applyCbbShotHead, type CbbShotHead } from "../../lib/cbb/shotProfileResearch";
import { enrichCbbMatchupMechanisms, enrichCbbEvidenceMaturity, CBB_EVIDENCE_MATURITY_RELEASE } from "../../lib/cbb/matchupMechanismResearch";
import { applyCbbMarketHead, buildCbbMarketReaderFeatures, fitCbbJointMarketLogLoss, CBB_MATCHUP_MARKET_RESEARCH_RELEASE, type CbbReaderQuote } from "../../lib/cbb/marketReaderResearch";
import { evaluateCbbMarketReaderRows, type CbbMarketEvaluationRow } from "../../lib/cbb/marketReaderEvaluation";
import { forecastCbbGame } from "../../lib/cbb/model";
import type { CbbBox, CbbGame, CbbRatingState, CbbUncertainty, CbbVenue } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private audit only");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
type EvidenceRow = CbbMarketEvaluationRow & { evidence: CbbReaderQuote[] };
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  const old = await read<EvidenceRow[]>("market-reader-feature-rows.json"), independent = await read<CbbShotHead>("candidate-r8-head.json");
  const artifact = await read<{ config: CbbScoreResearchConfig; uncertainty: CbbUncertainty }>("candidate-r2-artifact.json");
  let prior: CbbRatingState | undefined;
  for (const season of [2022, 2023, 2024]) prior = fitCbbScoreResearchState(history, { season, asOf: `${season + 1}-07-01T00:00:00.000Z`, config: artifact.config, prior });
  const raw: CbbScoreFeatureRow[] = old.map(row => {
    const state = fitCbbScoreResearchState(history, { season: 2025, asOf: row.forecast.asOf, config: artifact.config, prior });
    const forecast = { ...forecastCbbGame(state, row.game, artifact.uncertainty), release: state.release };
    const available = history.filter(g => g.season === 2025 && Date.parse(g.date) + 21600000 <= Date.parse(forecast.asOf));
    return { game: row.game, forecast, features: cbbScoreFeatures(forecast, state, row.game, available) };
  });
  const corrected = applyCbbShotHead(enrichCbbEvidenceMaturity(enrichCbbMatchupMechanisms(raw, history, boxes)), independent);
  const rows = corrected.map((row, i) => {
    const context = buildCbbMarketReaderFeatures(row.forecast, old[i].evidence, old[i].targets[0].sportsbook, { archiveReplay: true });
    return { ...row, targets: old[i].targets, features: context.features };
  });
  const train = rows.filter(r => r.game.date < "2026-02-15"), selection = rows.filter(r => r.game.date >= "2026-02-21" && r.game.date < "2026-03-01"), later = rows.filter(r => r.game.date >= "2026-03-01");
  const byId = new Map(old.map(r => [r.game.id, r]));
  const baselineFor = (cohort: CbbMarketEvaluationRow[]) => evaluateCbbMarketReaderRows(cohort.map(r => byId.get(r.game.id)!));
  const options = { release: CBB_MATCHUP_MARKET_RESEARCH_RELEASE, independentRelease: CBB_EVIDENCE_MATURITY_RELEASE } as const;
  const candidates = [];
  for (const penalty of [1, 10, 100]) {
    const head = fitCbbJointMarketLogLoss(train, penalty, options);
    const eligibleRows = selection.filter(r => Date.parse(r.forecast.asOf) >= Date.parse(head.trainedThrough));
    const baseline = baselineFor(eligibleRows), result = evaluateCbbMarketReaderRows(eligibleRows, head);
    const deltas = Object.fromEntries(Object.keys(result.markets).map(k => [k, result.markets[k].wins - baseline.markets[k].wins]));
    const net = Object.values(deltas).reduce((sum, n) => sum + n, 0), eligible = eligibleRows.length >= 50 && Object.values(deltas).every(n => n >= 0) && net > 0;
    candidates.push({ penalty, eligible, baseline, independent: evaluateCbbMarketReaderRows(eligibleRows), result, deltas, net });
    console.log(JSON.stringify({ penalty, eligible, deltas, net }));
  }
  const selected = candidates.filter(c => c.eligible).sort((a, b) => b.net - a.net || Object.values(a.result.markets).reduce((s, m) => s + m.logLoss, 0) - Object.values(b.result.markets).reduce((s, m) => s + m.logLoss, 0))[0] ?? null;
  const report: Record<string, unknown> = { release: CBB_MATCHUP_MARKET_RESEARCH_RELEASE, independentRelease: CBB_EVIDENCE_MATURITY_RELEASE, productionWrites: 0, providerCalls: 0,
    counts: { training: train.length, selection: selection.length, later: later.length }, candidates, selected: selected?.penalty ?? null,
    limitations: "Adaptively researched, previously opened retrospective 2025 cohort; opening prices only, not qualified movement/splits. No grade, stake, live accuracy or sharp-reader certification." };
  if (selected) {
    const head = fitCbbJointMarketLogLoss([...train, ...selection], selected.penalty, options);
    const eligible = later.filter(r => Date.parse(r.forecast.asOf) >= Date.parse(head.trainedThrough));
    report.later = { baseline: baselineFor(eligible), independent: evaluateCbbMarketReaderRows(eligible), candidate: evaluateCbbMarketReaderRows(eligible, head) };
    await writeFile(`${dir}/candidate-r9-head.json`, JSON.stringify(head, null, 2));
    await writeFile(`${dir}/candidate-r9-evaluation-rows.json`, JSON.stringify(eligible.map(r => ({ ...r, candidate: applyCbbMarketHead(r, head) }))));
  }
  await writeFile(`${dir}/matchup-market-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ selected: report.selected, later: report.later }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
