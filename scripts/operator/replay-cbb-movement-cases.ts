import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames, canonicalCbbTeamName } from "../../lib/cbb/dataset";
import { normalizeCbbOwlsHistory, cbbObservedPricePaths, type CbbOwlsHistoryRow } from "../../lib/cbb/owlsMarketEvidence";
import { forecastCbbGame } from "../../lib/cbb/model";
import { cbbScoreFeatures, correctCbbScoreForecast, fitCbbScoreResearchState, type CbbScoreCorrection, type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import type { CbbGame, CbbBox, CbbVenue, CbbRatingState, CbbUncertainty } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file.startsWith("/") ? file : `${dir}/${file}`, "utf8"));
type Catalog = { eventId: string; homeTeam: string; awayTeam: string; homeTeamId?: string; awayTeamId?: string; commenceTime?: string };
async function main() {
  const receipts = await read<{ requests: number; receipts: Array<{ eventId: string; file: string; complete: boolean }> }>("owls-cbb-movement-receipts.json");
  const catalog = (await read<{ body: { data: { games: Catalog[] } } }>("owls-cbb-games-late.json")).body.data.games;
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  const artifact = await read<{ config: CbbScoreResearchConfig; uncertainty: CbbUncertainty; correction: CbbScoreCorrection }>("candidate-r2-artifact.json");
  let prior: CbbRatingState | undefined;
  for (const season of [2022, 2023, 2024]) prior = fitCbbScoreResearchState(history, { season, asOf: `${season + 1}-07-01T00:00:00Z`, config: artifact.config, prior });
  const cases = [], excluded = [];
  const matchTeam = (team: CbbGame["home_team"], name: string, id?: string) => [team.full_name, team.college].filter(Boolean).some(a => [name, id].some(b => b && canonicalCbbTeamName(a!) === canonicalCbbTeamName(b)));
  for (const receipt of receipts.receipts) {
    const event = catalog.find(c => c.eventId === receipt.eventId)!;
    if (!receipt.complete || !event?.commenceTime) { excluded.push({ eventId: receipt.eventId, reason: "incomplete_or_missing_start" }); continue; }
    const matching = games.filter(g => g.season === 2025 && Math.abs(Date.parse(g.date) - Date.parse(event.commenceTime!)) < 2 * 3600000 &&
      ((matchTeam(g.home_team, event.homeTeam, event.homeTeamId) && matchTeam(g.visitor_team, event.awayTeam, event.awayTeamId)) ||
       (matchTeam(g.home_team, event.awayTeam, event.awayTeamId) && matchTeam(g.visitor_team, event.homeTeam, event.homeTeamId))));
    if (matching.length !== 1) { excluded.push({ eventId: receipt.eventId, reason: "ambiguous_or_unmatched_fixture" }); continue; }
    const sourceGame = matching[0], game = history.find(g => g.id === sourceGame.id);
    if (!game) { excluded.push({ eventId: receipt.eventId, reason: "unaccepted_stats" }); continue; }
    const capture = await read<{ rows: CbbOwlsHistoryRow[]; rawPages: Array<{ fetchedAt: string }> }>(receipt.file);
    const cutoff = new Date(Math.min(Date.parse(game.date), Date.parse(event.commenceTime)) - 3600000).toISOString();
    // Stable roster IDs corroborate aliases but never change a source price.
    const source = { homeTeam: matchTeam(sourceGame.home_team, event.homeTeam, event.homeTeamId) ? sourceGame.home_team.full_name : sourceGame.visitor_team.full_name,
      awayTeam: matchTeam(sourceGame.home_team, event.awayTeam, event.awayTeamId) ? sourceGame.home_team.full_name : sourceGame.visitor_team.full_name };
    const normalized = normalizeCbbOwlsHistory(sourceGame, source, capture.rows, capture.rawPages.at(-1)!.fetchedAt, cutoff);
    const state = fitCbbScoreResearchState(history, { season: 2025, asOf: cutoff, config: artifact.config, prior });
    const raw = forecastCbbGame(state, game, artifact.uncertainty);
    const available = history.filter(g => g.season === 2025 && Date.parse(g.date) + 21600000 <= Date.parse(cutoff));
    const forecast = correctCbbScoreForecast(raw, cbbScoreFeatures(raw, state, game, available), artifact.correction, 2025);
    const paths = cbbObservedPricePaths(normalized.quotes, "draftkings");
    cases.push({ eventId: receipt.eventId, gameId: game.id, cutoff, rawRows: capture.rows.length, pairedQuotes: normalized.quotes.length,
      rejected: normalized.rejected, paths, independent: forecast,
      qualification: "source_and_coherence_case_replay_only_no_fitted_movement_resolver", predictionChanges: 0 });
  }
  const report = { productionWrites: 0, requests: receipts.requests, cases, excluded,
    totalRawRows: cases.reduce((s, c) => s + c.rawRows, 0), totalQualifiedPairs: cases.reduce((s, c) => s + c.pairedQuotes, 0),
    sourceScope: "Exact named fixtures, explicit UTC capture times, pregame T-60. Post-cutoff, live, unknown clock, exchange and misattributed rows excluded. No causal leadership assumed." };
  await writeFile(`${dir}/market-reader-movement-cases.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cases: cases.length, excluded, rawRows: report.totalRawRows, qualifiedPairs: report.totalQualifiedPairs,
    casesBrief: cases.map(c => ({ eventId: c.eventId, pairs: c.pairedQuotes, paths: c.paths.length, changedPaths: c.paths.filter(p => p.distinctStates > 1).length, rejected: c.rejected })) }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB path replay failed"); process.exitCode = 1; });
