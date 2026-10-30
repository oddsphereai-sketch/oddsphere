import assert from "node:assert/strict";
import { CbbBallDontLieClient } from "../lib/cbb/ballDontLie";
import { buildCbbTrainingGames, estimatedPossessions, matchCbbVenue } from "../lib/cbb/dataset";
import { CBB_CANDIDATES, cbbThresholdProbabilities, fitCbbRatings, forecastCbbGame, settleCbbMarket } from "../lib/cbb/model";
import { CBB_DEVELOPMENT_UNCERTAINTY } from "../lib/cbb/evaluation";
import { cbbPriceObservations, cbbSameBookMovement, normalizeCbbOdds, reviewCbbQuote } from "../lib/cbb/marketEvidence";
import { buildCbbObservedRosterContext, buildCbbRosterContext, buildCbbRosterContextAt, cbbPlayedMinutes } from "../lib/cbb/rosterContext";
import { CBB_ACTIVATION } from "../lib/cbb/releases";
import { bindCbbQuoteOrientation, normalizeCbbNamedBookOdds, type CbbNamedOddsRow } from "../lib/cbb/namedBookOdds";
import frozenCandidate from "../lib/cbb/artifacts/candidate-r1.json";
import frozenEvaluation from "../lib/cbb/artifacts/evaluation-r1.json";
import type { CbbBox, CbbGame, CbbOdds, CbbPlayerSeason } from "../lib/cbb/types";

const home = { id: 92, conference_id: 7, name: "Wildcats", full_name: "Villanova Wildcats", college: "Villanova", abbreviation: "VILL" };
const away = { ...home, id: 11, name: "Fighting Irish", full_name: "Notre Dame Fighting Irish", college: "Notre Dame", abbreviation: "ND" };
const game: CbbGame = { id: 1, date: "2025-11-01T18:00:00.000Z", season: 2025, home_team: home, visitor_team: away,
  status: "post", status_state: "final", period: 2, home_score: 76, away_score: 70,
  home_score_h1: 38, home_score_h2: 38, away_score_h1: 35, away_score_h2: 35 };
const homeBox: CbbBox = { team: home, game, fgm: 26, fga: 60, fg3m: 8, fg3a: 24, ftm: 16, fta: 20, oreb: 8, dreb: 25, turnovers: 12 };
const awayBox: CbbBox = { ...homeBox, team: away, fgm: 25, fg3m: 7, ftm: 13, fta: 18, oreb: 9, turnovers: 13 };
const event = { id: "espn-1", date: game.date, competitions: [{ neutralSite: true, venue: { fullName: "Rome" },
  competitors: [{ homeAway: "home", team: { displayName: home.full_name } }, { homeAway: "away", team: { displayName: away.full_name } }] }] };
const venue = matchCbbVenue(game, [event], "2026-10-28T12:00:00Z")!;
assert.equal(venue.neutral, true);
assert.equal(matchCbbVenue(game, [event, event], venue.fetchedAt), null);
assert.equal(matchCbbVenue(game, [{ ...event, date: "2025-11-02T18:00:00Z" }], venue.fetchedAt), null);
assert.equal(estimatedPossessions({ ...homeBox, fta: null }), null);
const data = buildCbbTrainingGames([game], [homeBox, awayBox], [venue]);
assert.equal(data.games.length, 1); assert.equal(data.games[0].neutral, true);
assert.equal(buildCbbTrainingGames([{ ...game, status_state: "scheduled" }], [homeBox, awayBox], [venue]).games.length, 0);
assert.equal(buildCbbTrainingGames([game], [homeBox, { ...awayBox, fga: null }], [venue]).games.length, 0);
const ot = { ...game, home_score: 86, away_score: 80, home_score_h2: 32, period: 3, home_ot_scores: [16], away_ot_scores: [10] };
assert.equal(buildCbbTrainingGames([game], [{ ...homeBox, fgm: 25 }, awayBox], [venue]).games.length, 0);
const otData = buildCbbTrainingGames([ot], [{ ...homeBox, fgm: 31 }, { ...awayBox, fgm: 30 }], [venue]);
assert.equal(otData.games.length, 1); assert.ok(otData.games[0].tempo < otData.games[0].possessions);
assert.equal(otData.games[0].homeRegulation, otData.games[0].awayRegulation);

const state = fitCbbRatings(data.games, { season: 2025, asOf: "2025-11-03T00:00:00.000Z", config: CBB_CANDIDATES[0] });
assert.equal(state.trainingGames, 1);
const before = fitCbbRatings(data.games, { season: 2025, asOf: game.date, config: CBB_CANDIDATES[0] });
assert.equal(before.trainingGames, 0);
const shortlyAfter = fitCbbRatings(data.games, { season: 2025, asOf: "2025-11-01T19:00:00.000Z", config: CBB_CANDIDATES[0] });
assert.equal(shortlyAfter.trainingGames, 0);
const neutralForecast = forecastCbbGame(state, { id: 2, date: "2025-11-04T12:00:00Z", homeId: home.id, awayId: away.id, neutral: true }, CBB_DEVELOPMENT_UNCERTAINTY);
const homeForecast = forecastCbbGame(state, { id: 2, date: "2025-11-04T12:00:00Z", homeId: home.id, awayId: away.id, neutral: false }, CBB_DEVELOPMENT_UNCERTAINTY);
assert.ok(homeForecast.margin > neutralForecast.margin);
assert.ok(Math.abs(homeForecast.total - neutralForecast.total) < 1e-10);
assert.equal(neutralForecast.homeScore + neutralForecast.awayScore, neutralForecast.total);
assert.throws(() => forecastCbbGame(state, { id: 2, date: game.date, homeId: 92, awayId: 11, neutral: true }, CBB_DEVELOPMENT_UNCERTAINTY), /future/);
assert.throws(() => forecastCbbGame(state, { id: 2, date: "2025-11-04T12:00:00Z", homeId: 92, awayId: 11, neutral: true }, { ...CBB_DEVELOPMENT_UNCERTAINTY, fitThroughSeason: 2025 }), /evaluated season/);
for (const market of ["spread", "total"] as const) for (const line of [0, 1, 1.5, -1, -1.5, 150, 150.5]) {
  const p = cbbThresholdProbabilities(neutralForecast, market, line);
  assert.ok(p.first >= 0 && p.second >= 0 && p.push >= 0);
  assert.ok(Math.abs(p.first + p.second + p.push - 1) < 1e-9);
  if (!Number.isInteger(line)) assert.ok(p.push < 1e-9);
}
assert.ok(cbbThresholdProbabilities(neutralForecast, "spread", 6).first > cbbThresholdProbabilities(neutralForecast, "spread", 3).first);
assert.ok(cbbThresholdProbabilities(neutralForecast, "total", 146).first > cbbThresholdProbabilities(neutralForecast, "total", 150).first);
assert.equal(settleCbbMarket("spread", "first", -6, 76, 70), "push");
assert.equal(settleCbbMarket("total", "first", 146, 76, 70), "push");
assert.equal(settleCbbMarket("moneyline", "second", null, 76, 70), "loss");
const zeroSpread = cbbThresholdProbabilities(neutralForecast, "spread", 0);
assert.ok(zeroSpread.push < 1e-10);
assert.ok(Math.abs(zeroSpread.first - neutralForecast.homeWinProbability) < 1e-10);

const odds: CbbOdds = { id: 1, game_id: 2, vendor: "pinnacle", moneyline_home_odds: -120, moneyline_away_odds: 110,
  spread_home_value: -1.5, spread_away_value: 1.5, spread_home_odds: -110, spread_away_odds: -110,
  total_value: "148.5", total_over_odds: -110, total_under_odds: -110, updated_at: "2025-11-03T11:00:00Z", opened_at: "2025-11-02T11:00:00Z" };
const opts = { gameId: 2, startsAt: "2025-11-04T12:00:00Z", asOf: "2025-11-03T12:00:00Z", fetchedAt: "2025-11-03T11:59:00Z", phase: "current" as const };
const current = normalizeCbbOdds([odds], opts);
assert.equal(current.quotes.length, 3);
assert.equal(normalizeCbbOdds([{ ...odds, game_id: 3 }], opts).quotes.length, 0);
assert.equal(normalizeCbbOdds([{ ...odds, updated_at: "2025-11-03T13:00:00Z" }], opts).quotes.length, 0);
assert.equal(normalizeCbbOdds([{ ...odds, spread_away_value: 2.5 }], opts).quotes.filter(quote => quote.market === "spread").length, 0);
const opening = normalizeCbbOdds([odds], { ...opts, phase: "opening" }).quotes;
assert.equal(cbbSameBookMovement(opening, current.quotes)[0].chronology, "opening_to_current");
assert.equal(cbbSameBookMovement(opening.map(quote => ({ ...quote, sportsbook: "circa" })), current.quotes)[0].opening, null);
const movedLine = current.quotes.map(quote => quote.market === "total" ? { ...quote, line: 147.5 } : quote);
assert.equal(cbbSameBookMovement(opening, movedLine).find(row => row.market === "total")!.sameLineFairProbabilityDelta, null);
assert.equal(cbbPriceObservations(current.quotes)[0].timing.availableAt, opts.fetchedAt);
assert.equal(cbbPriceObservations(current.quotes)[0].observedRole, "unknown");
const economics = reviewCbbQuote(neutralForecast, current.quotes[0]);
assert.equal(economics.playGrade, null); assert.equal(economics.stake, 0);
const namedBase: CbbNamedOddsRow = { id: "named-home", sportsbook: "pinnacle", league: "ncaab", event_id: "event-1",
  home_team: "Notre Dame", away_team: "Villanova", event_start_time: game.date, market_type: "moneyline",
  selection: "Villanova", selection_type: "away", odds_american: -120, line: null,
  timestamp: "2025-10-31T11:00:00Z", is_live: false, is_active: true, external_event_id: "book-mens-1" };
const namedRows = [namedBase, { ...namedBase, id: "named-away", selection: "Notre Dame", selection_type: "home", odds_american: 110 }];
const named = normalizeCbbNamedBookOdds(game, namedRows, "2025-10-31T11:01:00Z", "2025-10-31T12:00:00Z");
assert.equal(named.quotes.length, 1); assert.equal(named.quotes[0].firstPrice, -120);
const wrongCompetition = normalizeCbbNamedBookOdds(game, namedRows.map(row => ({ ...row, external_event_id: "KXNCAAWBGAME-wrong" })), "2025-10-31T11:01:00Z", "2025-10-31T12:00:00Z");
assert.equal(wrongCompetition.quotes.length, 0);
const lateQuotes = normalizeCbbNamedBookOdds(game, namedRows, "2025-10-31T10:00:00Z", "2025-10-31T12:00:00Z");
assert.equal(lateQuotes.quotes.length, 0);
const reversed = { ...named.quotes[0], firstPrice: 110, secondPrice: -120 };
assert.equal(bindCbbQuoteOrientation(reversed, named.quotes).orientation, "verified_reversed");
assert.equal(bindCbbQuoteOrientation({ ...reversed, phase: "opening" }, named.quotes).orientation, "unverified");
assert.equal(bindCbbQuoteOrientation({ ...reversed, sportsbook: "caesars" }, named.quotes).orientation, "unverified");
const player = { id: 20, first_name: "Transfer", last_name: "Player", team: home };
const historicalPlayer: CbbPlayerSeason = { player, team: away, season: 2024, games_played: 30, min: 30, pts: 500, fga: 350, fgm: 180, fg3m: 30, fta: 140, ftm: 110, turnover: 30 };
assert.equal(buildCbbRosterContext(92, [player], [historicalPlayer], 2024).incomingTransfers.length, 1);
const rosterReceipt = { fetchedAt: "2025-10-31T10:00:00Z", data: [player] };
const priorReceipt = { fetchedAt: "2025-10-31T09:00:00Z", data: [historicalPlayer] };
assert.equal(buildCbbRosterContextAt(92, rosterReceipt, priorReceipt, 2024, "2025-10-31T11:00:00Z").incomingTransfers.length, 1);
assert.throws(() => buildCbbRosterContextAt(92, rosterReceipt, priorReceipt, 2024, "2025-10-31T09:30:00Z"), /after pregame/);
assert.throws(() => buildCbbRosterContextAt(92, rosterReceipt, { ...priorReceipt, data: [{ ...historicalPlayer, season: 2025 }] }, 2024, "2025-10-31T11:00:00Z"), /mixes seasons/);
const appearances = [
  { player, team: home, game: { id: 10, date: "2025-11-01T18:00:00Z", season: 2025 }, min: 20 },
  { player, team: away, game: { id: 11, date: "2025-11-03T18:00:00Z", season: 2025 }, min: 20 },
];
assert.equal(buildCbbObservedRosterContext(92, appearances, [historicalPlayer], 2025, "2025-11-01T20:00:00Z").currentPlayers, 0);
assert.equal(buildCbbObservedRosterContext(92, appearances, [historicalPlayer], 2025, "2025-11-02T01:00:00Z").currentPlayers, 1);
assert.equal(buildCbbObservedRosterContext(92, appearances, [historicalPlayer], 2025, "2025-11-04T01:00:00Z").currentPlayers, 0);
assert.equal(cbbPlayedMinutes("12:30"), 12.5);
assert.equal(cbbPlayedMinutes(null), 0);
assert.equal(buildCbbObservedRosterContext(92, [{ ...appearances[0], min: null }], [historicalPlayer], 2025, "2025-11-02T01:00:00Z").currentPlayers, 0);
assert.deepEqual(CBB_ACTIVATION, { release: "cbb_member_activation_2026_10_30_r1_verified_writer",
  status: "member_live", memberPublication: true, predictionWrites: true, stakes: false });
assert.equal(frozenCandidate.release, frozenEvaluation.release);
assert.equal(frozenCandidate.selectedThroughSeason, 2024);
assert.equal(frozenCandidate.confirmationThroughSeason, 2025);
assert.equal(frozenCandidate.historicalDataSha256, frozenEvaluation.historicalDataSha256);
assert.equal(frozenEvaluation.confirmation.wins + frozenEvaluation.confirmation.losses, frozenEvaluation.confirmation.games);
const portableState = fitCbbRatings([], { season: 2026, asOf: "2026-10-28T20:00:00.000Z", config: frozenCandidate.config, prior: frozenCandidate.prior });
const portableForecast = forecastCbbGame(portableState, { id: 10882407, date: "2026-11-01T14:30:00.000Z", homeId: 92, awayId: 11, neutral: true }, frozenCandidate.uncertainty);
assert.ok(Math.abs(portableForecast.homeScore - 75.36810932159642) < 1e-9);
assert.ok(Math.abs(portableForecast.awayScore - 72.19753550516532) < 1e-9);

async function providerTests() {
  const seen: URL[] = [];
  const client = new CbbBallDontLieClient("test-secret", { delayMs: 0, fetch: (async (input) => {
    const url = new URL(String(input)); seen.push(url);
    return Response.json(url.searchParams.has("cursor") ? { data: [away] } : { data: [home], meta: { next_cursor: 1 } });
  }) as typeof fetch });
  assert.equal((await client.teams()).length, 2); assert.equal(seen.length, 2);
  const loop = new CbbBallDontLieClient("test-secret", { delayMs: 0, fetch: (async () => Response.json({ data: [home], meta: { next_cursor: 1 } })) as typeof fetch });
  await assert.rejects(() => loop.teams(), /pagination/);
  const wrongSeason = new CbbBallDontLieClient("test-secret", { fetch: (async () => Response.json({ data: [{ ...game, season: 2026 }] })) as typeof fetch });
  await assert.rejects(() => wrongSeason.games(2025), /season/);
  const playerClient = new CbbBallDontLieClient("test-secret", { fetch: (async () => Response.json({ data: appearances })) as typeof fetch });
  assert.equal((await playerClient.playerGames([10, 11], 2025)).length, 2);
  await assert.rejects(() => playerClient.playerGames([10], 2025), /filter/);
  const auth = new CbbBallDontLieClient("test-secret", { fetch: (async () => new Response("test-secret", { status: 401 })) as typeof fetch });
  await assert.rejects(() => auth.teams(), error => !String(error).includes("test-secret") && String(error).includes("401"));
}
providerTests().then(() => console.log("CBB launch tests passed: data, chronology, venue, coherent markets, W-L-P, roster identity, member publication, bounded provider."));
