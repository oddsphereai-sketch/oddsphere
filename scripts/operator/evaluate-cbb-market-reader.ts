import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames, canonicalCbbTeamName } from "../../lib/cbb/dataset";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { fitCbbScoreResearchState, cbbScoreFeatures, correctCbbScoreForecast, type CbbScoreFeatureRow, type CbbScoreResearchConfig, type CbbScoreCorrection } from "../../lib/cbb/scoreResearch";
import { forecastCbbGame, settleCbbMarket } from "../../lib/cbb/model";
import { applyCbbMarketHead, buildCbbMarketReaderFeatures, fitCbbMarketHead, CBB_MARKET_READER_RESEARCH_RELEASE, type CbbReaderQuote } from "../../lib/cbb/marketReaderResearch";
import type { CbbBox, CbbGame, CbbOdds, CbbQuote, CbbRatingState, CbbUncertainty, CbbVenue, CbbMarket } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
const cohort = process.argv.includes("--cohort=saturation") ? "saturation" :
  process.argv.includes("--cohort=weekdays") ? "weekdays" :
  process.argv.includes("--cohort=date-diverse") ? "date-diverse" : "baseline";
const dateDiverse = cohort !== "baseline";
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
type Catalog = { eventId: string; homeTeam: string; awayTeam: string; homeTeamId?: string; awayTeamId?: string; commenceTime?: string; gameDate: string };
type Row = CbbScoreFeatureRow & { targets: CbbQuote[]; evidence: CbbReaderQuote[]; context: ReturnType<typeof buildCbbMarketReaderFeatures>; orientationEventId: string };
const books = ["draftkings", "fanduel", "betmgm", "caesars"];
const referenceBooks = new Set([...books, "pinnacle", "circa", "bet365", "bovada", "betrivers", "espnbet"]);
function quotes(o: CbbOdds, fetchedAt: string): CbbQuote[] {
  const pairs: Array<[CbbMarket, number | null, number | null, number | null]> = [
    ["moneyline", null, o.moneyline_home_odds, o.moneyline_away_odds],
    ["spread", o.spread_home_value == null ? null : Number(o.spread_home_value), o.spread_home_odds, o.spread_away_odds],
    ["total", o.total_value == null ? null : Number(o.total_value), o.total_over_odds, o.total_under_odds],
  ];
  return pairs.filter(([market, line, a, b]) => [a, b].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) >= 100) &&
    (market === "moneyline" || line !== null && Number.isFinite(line) && Number.isInteger(line * 2)) &&
    (market !== "spread" || o.spread_away_value !== null && Number(o.spread_away_value) === -line!) &&
    (market !== "total" || line! > 80 && line! < 250)).map(([market, line, a, b]) => ({ gameId: o.game_id, sportsbook: o.vendor,
      market, line, firstPrice: a!, secondPrice: b!, providerObservedAt: o.opened_at!, fetchedAt, phase: "opening" }));
}
const firstSide = (r: CbbScoreFeatureRow, market: CbbMarket, line: number | null) => market === "moneyline" ? r.forecast.homeWinProbability >= 0.5 :
  market === "spread" ? r.forecast.margin + line! > 0 : r.forecast.total > line!;
function metrics(rows: Row[], model?: ReturnType<typeof fitCbbMarketHead>) {
  const evaluated = rows.map(r => ({ ...r, forecast: model ? applyCbbMarketHead(r, model) : r.forecast }));
  const markets = Object.fromEntries((["moneyline", "spread", "total"] as const).map(market => {
    let wins = 0, losses = 0, pushes = 0, corrections = 0, harms = 0;
    for (const [i, r] of evaluated.entries()) {
      const quote = r.targets.find(q => q.market === market)!;
      const oldSide = firstSide(rows[i], market, quote.line), nextSide = firstSide(r, market, quote.line);
      const old = settleCbbMarket(market, oldSide ? "first" : "second", quote.line, r.game.homeScore, r.game.awayScore);
      const next = settleCbbMarket(market, nextSide ? "first" : "second", quote.line, r.game.homeScore, r.game.awayScore);
      wins += Number(next === "win"); losses += Number(next === "loss"); pushes += Number(next === "push");
      corrections += Number(old === "loss" && next === "win"); harms += Number(old === "win" && next === "loss");
    }
    return [market, { wins, losses, pushes, accuracy: wins / Math.max(1, wins + losses), corrections, harms }];
  }));
  return { score: evaluateCbbRows(evaluated), markets };
}
async function main() {
  const capture = await read<{ fetchedAt: string; dates: string[]; data: CbbOdds[] }>(
    cohort === "saturation" ? "saturation-opening-raw.json" : cohort === "weekdays" ? "weekday-opening-raw.json" :
      dateDiverse ? "date-diverse-opening-raw.json" : "opening-total-benchmark-raw.json");
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const rawGameById = new Map(games.map(g => [g.id, g]));
  const catalogDates = dateDiverse ? [...new Set(capture.data.map(o => rawGameById.get(o.game_id)?.date.slice(0, 10))
    .filter((date): date is string => Boolean(date)))].sort() : capture.dates;
  const catalog: Catalog[] = [];
  for (const date of catalogDates) catalog.push(...(await read<{ data: Catalog[] }>(`owls-cbb-catalog-${date}.json`)).data);
  const history = buildCbbTrainingGames(games, boxes, venues).games, rawGames = new Map(games.map(g => [g.id, g]));
  const artifact = await read<{ config: CbbScoreResearchConfig; uncertainty: CbbUncertainty; correction: CbbScoreCorrection }>("candidate-r2-artifact.json");
  let prior: CbbRatingState | undefined;
  for (const season of [2022, 2023, 2024]) prior = fitCbbScoreResearchState(history, { season, asOf: `${season + 1}-07-01T00:00:00Z`, config: artifact.config, prior });
  const exclusions: Record<string, number> = {}, reject = (why: string) => { exclusions[why] = (exclusions[why] ?? 0) + 1; };
  const rows: Row[] = [];
  for (const game of history.filter(g => g.season === 2025 && catalogDates.includes(g.date.slice(0, 10)))) {
    const g = rawGames.get(game.id)!;
    const h = [g.home_team.full_name, g.home_team.college].filter(Boolean).map(v => canonicalCbbTeamName(v!));
    const a = [g.visitor_team.full_name, g.visitor_team.college].filter(Boolean).map(v => canonicalCbbTeamName(v!));
    const match = (names: string[], name: string, id?: string) => [name, id].some(v => v && names.includes(canonicalCbbTeamName(v)));
    const matches = catalog.filter(c => c.gameDate.slice(0, 10) === game.date.slice(0, 10) &&
      (!c.commenceTime || Math.abs(Date.parse(c.commenceTime) - Date.parse(game.date)) <= 2 * 3600000) &&
      ((match(h, c.homeTeam, c.homeTeamId) && match(a, c.awayTeam, c.awayTeamId)) || (match(h, c.awayTeam, c.awayTeamId) && match(a, c.homeTeam, c.homeTeamId))));
    if (matches.length !== 1 || !match(h, matches[0].homeTeam, matches[0].homeTeamId)) { reject("fixture_orientation_not_independently_corroborated"); continue; }
    const offers = capture.data.filter(o => o.game_id === game.id && referenceBooks.has(o.vendor) &&
      Number.isFinite(Date.parse(o.opened_at ?? "")) && Date.parse(o.opened_at!) < Date.parse(game.date));
    const target = [...offers].filter(o => books.includes(o.vendor) && quotes(o, capture.fetchedAt).length === 3)
      .sort((x, y) => books.indexOf(x.vendor) - books.indexOf(y.vendor))[0];
    if (!target) { reject("no_complete_three_market_target"); continue; }
    const asOf = target.opened_at!;
    const state = fitCbbScoreResearchState(history, { season: 2025, asOf, config: artifact.config, prior });
    const raw = forecastCbbGame(state, game, artifact.uncertainty);
    const available = history.filter(g => g.season === 2025 && Date.parse(g.date) + 21600000 <= Date.parse(asOf));
    const features = cbbScoreFeatures(raw, state, game, available);
    const forecast = correctCbbScoreForecast(raw, features, artifact.correction, 2025);
    const evidence: CbbReaderQuote[] = offers.flatMap(o => quotes(o, capture.fetchedAt).map(quote => ({ quote,
      orientation: "fixture_corroborated" as const, availability: "provider_archived_opening" as const })));
    const context = buildCbbMarketReaderFeatures(forecast, evidence, target.vendor, { archiveReplay: true });
    if (!context.retained.length || !context.centers.spread.length || !context.centers.total.length) { reject("no_prior_target_excluded_spread_and_total"); continue; }
    if (forecast.inputStatus !== "complete") { reject("incomplete_independent_inputs"); continue; }
    rows.push({ game, forecast, features: context.features, targets: quotes(target, capture.fetchedAt), evidence, context, orientationEventId: matches[0].eventId });
  }
  if (dateDiverse) {
    if (new Set(rows.map(r => r.game.id)).size !== rows.length) throw new Error("duplicate date-diverse CBB game");
    await writeFile(`${dir}/${cohort}-feature-rows.json`, JSON.stringify(rows));
    console.log(JSON.stringify({ cohort, eligible: rows.length, exclusions,
      dates: Object.fromEntries([...new Set(rows.map(r => r.game.date.slice(0, 10)))].sort().map(date =>
        [date, rows.filter(r => r.game.date.startsWith(date)).length])), productionWrites: 0 }));
    return;
  }
  const development = rows.filter(r => r.game.date < "2026-02-15"), selection = rows.filter(r => r.game.date >= "2026-02-21" && r.game.date < "2026-03-01");
  const later = rows.filter(r => r.game.date >= "2026-03-01");
  console.log(JSON.stringify({ eligible: rows.length, development: development.length, selection: selection.length, later: later.length, exclusions }));
  const baselineSelection = metrics(selection), candidates = [];
  const options = [{ penalty: 10 }, { penalty: 100 }, { penalty: 1000 }, { rounds: 40 }, { rounds: 80 }];
  if (development.length < 100) throw new Error("insufficient chronologically qualified CBB training games");
  for (const option of options) {
    if ("rounds" in option && development.length < 200) {
      console.log(JSON.stringify({ option, skipped: "existing tree trainer requires 200 games", available: development.length }));
      continue;
    }
    const head = fitCbbMarketHead(development, option);
    const eligibleRows = selection.filter(r => Date.parse(r.forecast.asOf) >= Date.parse(head.trainedThrough));
    const base = metrics(eligibleRows), result = metrics(eligibleRows, head);
    const deltas = Object.fromEntries(Object.keys(result.markets).map(k => [k, result.markets[k].wins - base.markets[k].wins]));
    const net = Object.values(deltas).reduce((s, n) => s + n, 0);
    const eligible = eligibleRows.length >= 50 && Object.values(deltas).every(n => n >= 0) && net > 0;
    candidates.push({ option, eligible, rows: eligibleRows.length, excludedModelNotYetAvailable: selection.length - eligibleRows.length,
      baseline: base, result, deltas, net, head });
    console.log(JSON.stringify({ option, eligible, rows: eligibleRows.length, deltas, net }));
  }
  const selected = candidates.filter(c => c.eligible).sort((a, b) => b.net - a.net || a.result.score.marginMae + a.result.score.totalMae - b.result.score.marginMae - b.result.score.totalMae)[0] ?? null;
  const report: Record<string, unknown> = { release: CBB_MARKET_READER_RESEARCH_RELEASE, productionWrites: 0,
    scope: "fixture-corroborated opening-price context, not selection-level named-book certification or a qualified sharp movement reader",
    evaluationStatus: "later 2025-season retrospective; previously opened outcomes, not pristine holdout", exclusions,
    counts: { development: development.length, selection: selection.length, later: later.length }, baselineSelection,
    candidates: candidates.map(candidate => ({ option: candidate.option, eligible: candidate.eligible, rows: candidate.rows,
      excludedModelNotYetAvailable: candidate.excludedModelNotYetAvailable, baseline: candidate.baseline, result: candidate.result, deltas: candidate.deltas, net: candidate.net })),
    skippedTreeCandidates: development.length < 200 ? "Both tree candidates require at least 200 training games; guard preserved" : null,
    selected: selected?.option ?? null };
  if (selected) {
    const head = fitCbbMarketHead([...development, ...selection], selected.option);
    const eligible = later.filter(r => Date.parse(r.forecast.asOf) >= Date.parse(head.trainedThrough));
    report.laterBaseline = metrics(eligible); report.laterCandidate = metrics(eligible, head);
    report.laterExcludedModelNotYetAvailable = later.length - eligible.length;
    await writeFile(`${dir}/candidate-r5-head.json`, JSON.stringify(head, null, 2));
    await writeFile(`${dir}/candidate-r5-evaluation-rows.json`, JSON.stringify(eligible.map(r => ({ ...r, candidate: applyCbbMarketHead(r, head) }))));
  }
  await writeFile(`${dir}/market-reader-evaluation-report.json`, JSON.stringify(report, null, 2));
  await writeFile(`${dir}/market-reader-feature-rows.json`, JSON.stringify(rows));
  console.log(JSON.stringify({ selected: report.selected, laterBaseline: report.laterBaseline, laterCandidate: report.laterCandidate }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB market replay failed"); process.exitCode = 1; });
