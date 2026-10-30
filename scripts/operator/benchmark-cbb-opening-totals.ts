/** Fixed-calendar, named-book Total benchmark. Not a closing-line or live-record claim. */
import { readFile, writeFile } from "node:fs/promises";
import { CbbBallDontLieClient } from "../../lib/cbb/ballDontLie";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { fitCbbScoreResearchState, cbbScoreFeatures, correctCbbScoreForecast, type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import { forecastCbbGame, settleCbbMarket } from "../../lib/cbb/model";
import { applyCbbShotHead, enrichCbbShotProfiles, type CbbShotHead } from "../../lib/cbb/shotProfileResearch";
import type { CbbBox, CbbGame, CbbOdds, CbbRatingState, CbbUncertainty, CbbVenue } from "../../lib/cbb/types";
import type { CbbScoreCorrection } from "../../lib/cbb/scoreResearch";
const dir = "/private/tmp/oddsphere-cbb-data";
const dates = ["2026-02-07", "2026-02-14", "2026-02-21", "2026-02-28", "2026-03-07", "2026-03-14", "2026-03-21", "2026-03-28"];
const books = ["draftkings", "fanduel", "betmgm", "caesars"];
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
type BetResult = { pick: string; result: string; units: number };
type BenchmarkRow = { gameId: number; date: string; asOf: string; sportsbook: string; line: number; actual: number; overtime: boolean;
  quoteId: number; overPrice: number; underPrice: number;
  openingError: number; r2Total: number; r3Total: number; r2Error: number; r3Error: number; r2: BetResult; r3: BetResult };
async function main() {
  const capture = `${dir}/opening-total-benchmark-raw.json`;
  let odds: CbbOdds[], requests = 0;
  try { odds = JSON.parse(await readFile(capture, "utf8")).data; } catch {
    const client = new CbbBallDontLieClient(process.env.BALLDONTLIE_API_KEY ?? "", { maxRequests: 60 });
    odds = await client.odds(dates, "opening"); requests = client.calls;
    await writeFile(capture, JSON.stringify({ fetchedAt: new Date().toISOString(), dates, requests, data: odds }));
  }
  console.log(JSON.stringify({ capturedRows: odds.length, requests }));
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games, gameMap = new Map(history.map(g => [g.id, g]));
  const artifact = await read<{ config: CbbScoreResearchConfig; uncertainty: CbbUncertainty; correction: CbbScoreCorrection }>("candidate-r2-artifact.json");
  const shot = await read<CbbShotHead>("candidate-r3-head.json");
  let prior: CbbRatingState | undefined;
  for (const season of [2022, 2023, 2024]) prior = fitCbbScoreResearchState(history, { season, asOf: `${season + 1}-07-01T00:00:00Z`, config: artifact.config, prior });
  const rejected: Record<string, number> = {}, selected = new Map<number, CbbOdds>();
  const reject = (why: string) => { rejected[why] = (rejected[why] ?? 0) + 1; };
  for (const o of odds) {
    const g = gameMap.get(o.game_id), line = o.total_value == null ? NaN : Number(o.total_value), at = Date.parse(o.opened_at ?? "");
    if (!g || g.season !== 2025 || !dates.includes(g.date.slice(0, 10))) { reject("unmatched_accepted_game"); continue; }
    if (!books.includes(o.vendor)) { reject("non_selected_book"); continue; }
    if (!(line > 80 && line < 250) || Math.round(line * 2) !== line * 2 ||
      ![o.total_over_odds, o.total_under_odds].every(p => typeof p === "number" && Number.isFinite(p) && Math.abs(p) >= 100)) { reject("incomplete_total_pair"); continue; }
    if (!Number.isFinite(at) || at >= Date.parse(g.date)) { reject("not_verified_pregame_opening_time"); continue; }
    const implied = (p: number) => p > 0 ? 100 / (p + 100) : -p / (-p + 100);
    const hold = implied(o.total_over_odds!) + implied(o.total_under_odds!);
    if (hold < 0.98 || hold > 1.3) { reject("incoherent_total_pair"); continue; }
    const old = selected.get(g.id);
    if (!old || books.indexOf(o.vendor) < books.indexOf(old.vendor)) selected.set(g.id, o);
    else if (old.vendor === o.vendor && old.id !== o.id) throw new Error("ambiguous opening Total at selected book");
  }
  const rows: BenchmarkRow[] = [];
  for (const [id, o] of selected) {
    const game = gameMap.get(id)!, asOf = o.opened_at!;
    const state = fitCbbScoreResearchState(history, { season: 2025, asOf, config: artifact.config, prior });
    const raw = forecastCbbGame(state, game, artifact.uncertainty);
    const available = history.filter(g => g.season === 2025 && Date.parse(g.date) + 21600000 <= Date.parse(asOf));
    const features = cbbScoreFeatures(raw, state, game, available);
    const r2 = correctCbbScoreForecast(raw, features, artifact.correction, 2025);
    const r3 = applyCbbShotHead(enrichCbbShotProfiles([{ game, forecast: raw, features }], history, boxes), shot)[0].forecast;
    const line = Number(o.total_value), actual = game.homeScore + game.awayScore;
    const result = (total: number) => {
      if (total === line) return { pick: "pass", result: "pass", units: 0 };
      const pick = total > line ? "over" : "under";
      const outcome = settleCbbMarket("total", pick === "over" ? "first" : "second", line, game.homeScore, game.awayScore);
      const price = pick === "over" ? o.total_over_odds! : o.total_under_odds!;
      return { pick, result: outcome, units: outcome === "push" ? 0 : outcome === "loss" ? -1 : price > 0 ? price / 100 : 100 / -price };
    };
    rows.push({ gameId: id, date: game.date, asOf, sportsbook: o.vendor, line, actual, overtime: game.overtime,
      quoteId: o.id, overPrice: o.total_over_odds!, underPrice: o.total_under_odds!,
      openingError: Math.abs(actual - line), r2Total: r2.total, r3Total: r3.total,
      r2Error: Math.abs(actual - r2.total), r3Error: Math.abs(actual - r3.total), r2: result(r2.total), r3: result(r3.total) });
  }
  const summarize = (rs: typeof rows) => {
    const model = (key: "r2" | "r3") => ({ wins: rs.filter(r => r[key].result === "win").length,
      losses: rs.filter(r => r[key].result === "loss").length, pushes: rs.filter(r => r[key].result === "push").length,
      passes: rs.filter(r => r[key].result === "pass").length, unitsAtOneRisked: rs.reduce((s, r) => s + r[key].units, 0),
      totalMae: rs.reduce((s, r) => s + r[key === "r2" ? "r2Error" : "r3Error"], 0) / Math.max(1, rs.length) });
    return { games: rs.length, openingTotalMae: rs.reduce((s, r) => s + r.openingError, 0) / Math.max(1, rs.length), r2: model("r2"), r3: model("r3") };
  };
  const report = { productionWrites: 0, dates, booksInFixedPreference: books, requests, rawRows: odds.length, rejected,
    method: "Forecast rerun at exact selected named-book opening timestamp with six-hour result holdback. One book per game, fixed preference. Total is orientation invariant.",
    limitations: "2025 season already opened; retrospective sample, not untouched validation. Opening only, not closing prices or movement. All-game picks, not calibrated grades or a betting recommendation. Units are hypothetical one-risked replay, not live locked tracking.",
    summary: summarize(rows), regulation: summarize(rows.filter(r => !r.overtime)),
    byDate: Object.fromEntries(dates.map(date => [date, summarize(rows.filter(r => r.date.startsWith(date)))])), rows };
  await writeFile(`${dir}/opening-total-benchmark-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summary: report.summary, rejected, byDate: report.byDate }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "opening benchmark failed"); process.exitCode = 1; });
