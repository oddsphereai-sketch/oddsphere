import assert from "node:assert/strict";
import { normalizeCbbOwlsCurrent, normalizeCbbOwlsHistory, cbbObservedPricePaths } from "../lib/cbb/owlsMarketEvidence";
import { applyCbbMarketHead, buildCbbMarketReaderFeatures, CBB_MARKET_READER_FEATURES, CBB_MARKET_READER_RESEARCH_RELEASE, fitCbbJointMarketLogLoss } from "../lib/cbb/marketReaderResearch";
import { evaluateCbbMarketReaderRows } from "../lib/cbb/marketReaderEvaluation";
import { cbbThresholdProbabilities } from "../lib/cbb/model";
import { CBB_DEVELOPMENT_UNCERTAINTY } from "../lib/cbb/evaluation";
import type { CbbForecast, CbbGame, CbbTrainingGame, CbbQuote } from "../lib/cbb/types";
import type { RawOwlsOddsResponse } from "../lib/providers/owls/owlsSharpBookOdds";
const team = (id: number, college: string, full_name: string) => ({ id, college, full_name, name: full_name, abbreviation: college, conference_id: 1 });
const fixture: CbbGame = { id: 100, date: "2026-11-01T14:30:00Z", season: 2026, status: "pre", period: 0,
  home_team: team(1, "Villanova", "Villanova Wildcats"), visitor_team: team(2, "Notre Dame", "Notre Dame Fighting Irish"), home_score: 0, away_score: 0 };
const asOf = "2026-10-28T22:00:00Z", observed = "2026-10-28T21:55:00Z";
const raw: RawOwlsOddsResponse = { success: true, data: [{ eventId: "ncaab:Villanova@Notre Dame-20261101", sport: "ncaab", commence_time: fixture.date,
  home_team: "Notre Dame", away_team: "Villanova", bookmakers: [{ key: "fanduel", last_update: observed,
    markets: [{ key: "h2h", outcomes: [{ name: "Villanova", price: -300 }, { name: "Notre Dame", price: 240 }] },
      { key: "spreads", outcomes: [{ name: "Villanova", price: -110, point: -7.5 }, { name: "Notre Dame", price: -110, point: 7.5 }] },
      { key: "totals", outcomes: [{ name: "Over", price: -110, point: 148.5 }, { name: "Under", price: -110, point: 148.5 }] }] }] }] };
const parsed = normalizeCbbOwlsCurrent(fixture, raw, asOf, asOf);
assert.equal(parsed.quotes.length, 3);
assert.equal(parsed.quotes.find(q => q.market === "spread")!.line, -7.5);
assert.equal(parsed.quotes.find(q => q.market === "moneyline")!.firstPrice, -300);
assert.equal(normalizeCbbOwlsCurrent(fixture, raw, asOf, "2026-10-29T23:00:00Z").quotes.length, 0);
assert.throws(() => normalizeCbbOwlsCurrent(fixture, raw, asOf, "2026-11-02T00:00:00Z"), /pregame/);
const different = structuredClone(raw); if (Array.isArray(different.data)) different.data[0].sport = "ncaaw";
assert.equal(normalizeCbbOwlsCurrent(fixture, different, asOf, asOf).quotes.length, 0);
const history = [
  { book: "fanduel", market: "spreads", side: "home", price: -110, pointValue: 7.5, recordedAt: observed, recordedAtUtc: observed },
  { book: "fanduel", market: "spreads", side: "away", price: -110, pointValue: -7.5, recordedAt: observed, recordedAtUtc: observed },
];
const source = { homeTeam: "Notre Dame", awayTeam: "Villanova" };
const tape = normalizeCbbOwlsHistory(fixture, source, history, asOf, asOf);
assert.equal(tape.quotes[0].line, -7.5);
assert.equal(normalizeCbbOwlsHistory(fixture, source, history.map(r => ({ ...r, recordedAtUtc: null })), asOf, asOf).quotes.length, 0);
assert.equal(normalizeCbbOwlsHistory(fixture, source, history.map(r => ({ ...r, inPlay: true })), asOf, asOf).quotes.length, 0);
assert.equal(normalizeCbbOwlsHistory(fixture, source, history, asOf, "2026-10-28T20:00:00Z").quotes.length, 0);
const path = cbbObservedPricePaths([...tape.quotes, { ...tape.quotes[0], providerObservedAt: "2026-10-28T21:58:00Z", firstPrice: -115, secondPrice: -105 }], "draftkings")[0];
assert.equal(path.distinctStates, 2); assert.equal(path.trueOpeningKnown, false); assert.equal(path.causalLeadership, "unknown");
assert.equal(cbbObservedPricePaths(tape.quotes, "fanduel").length, 0);
const forecast: CbbForecast = { release: "test", gameId: 100, asOf, homeId: 1, awayId: 2, homeScore: 75, awayScore: 70, margin: 5, total: 145,
  homeWinProbability: 0.65, possessions: 70, uncertainty: CBB_DEVELOPMENT_UNCERTAINTY, inputStatus: "complete", issues: [] };
const evidence = parsed.quotes.map(quote => ({ quote, orientation: "named_selections_verified" as const, availability: "observed_live" as const }));
const feature = buildCbbMarketReaderFeatures(forecast, evidence, "draftkings", { archiveReplay: false });
assert.equal(feature.features.length, CBB_MARKET_READER_FEATURES.length);
assert.equal(feature.retained.length, 3);
assert.equal(buildCbbMarketReaderFeatures(forecast, evidence, "fanduel", { archiveReplay: false }).retained.length, 0);
const archived = evidence.map(r => ({ ...r, quote: { ...r.quote, phase: "opening" as const }, availability: "provider_archived_opening" as const }));
assert.equal(buildCbbMarketReaderFeatures(forecast, archived, "draftkings", { archiveReplay: false }).retained.length, 0);
assert.equal(buildCbbMarketReaderFeatures(forecast, archived, "draftkings", { archiveReplay: true }).retained.length, 3);
assert.deepEqual(buildCbbMarketReaderFeatures(forecast, [...evidence, ...evidence], "draftkings", { archiveReplay: false }).features, feature.features);
const game: CbbTrainingGame = { id: 100, date: fixture.date, season: 2026, homeId: 1, awayId: 2, homeScore: 75, awayScore: 70,
  homeRegulation: 75, awayRegulation: 70, overtime: false, possessions: 70, tempo: 70, neutral: true,
  homeFactors: { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 },
  awayFactors: { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 } };
const row = { game, forecast, features: feature.features, targets: parsed.quotes as CbbQuote[] };
const head = { release: CBB_MARKET_READER_RESEARCH_RELEASE, trainedThrough: "2026-03-01T00:00:00Z", trainingGameIds: [], mode: "ridge" as const,
  margin: feature.features.map((_, i) => i === 0 ? -15 : 0), total: feature.features.map((_, i) => i === 0 ? 8 : 0) };
const result = applyCbbMarketHead(row, head);
assert.equal(result.margin, -10); assert.equal(result.total, 153); assert.ok(result.homeWinProbability < 0.5, "supported learned winner crossing is not artificially blocked");
assert.equal(result.homeScore + result.awayScore, result.total); assert.equal(result.homeScore - result.awayScore, result.margin);
assert.ok(Math.abs(cbbThresholdProbabilities(result, "spread", 0).first - result.homeWinProbability) < 1e-10);
assert.deepEqual(result, applyCbbMarketHead(row, JSON.parse(JSON.stringify(head))));
assert.throws(() => applyCbbMarketHead(row, { ...head, trainedThrough: "2026-12-01T00:00:00Z" }), /future/);
assert.throws(() => applyCbbMarketHead(row, { ...head, trainingGameIds: [100] }), /in-sample/);
assert.throws(() => applyCbbMarketHead({ ...row, forecast: { ...forecast, gameId: 101 } }, head), /exact-game/);
assert.throws(() => applyCbbMarketHead({ ...row, forecast: { ...forecast, asOf: "invalid" } }, head), /future/);
const totalOnly = { ...head, margin: head.margin.map(() => 0) }, shifted = applyCbbMarketHead(row, totalOnly);
assert.equal(shifted.margin, forecast.margin); assert.equal(shifted.homeScore - forecast.homeScore, shifted.awayScore - forecast.awayScore);
assert.deepEqual(applyCbbMarketHead({ ...row, features: row.features.map((v, i) => i === CBB_MARKET_READER_FEATURES.indexOf("reference_book_count") ? 0 : v) }, head), forecast);
const train = Array.from({ length: 110 }, (_, i) => ({ ...row, game: { ...game, id: 1000 + i, date: "2026-02-01T12:00:00Z" }, forecast: { ...forecast, gameId: 1000 + i, asOf: "2026-02-01T00:00:00Z" }, targets: row.targets.map(q => ({ ...q, gameId: 1000 + i })) }));
const learned = fitCbbJointMarketLogLoss(train, 10);
assert.equal(learned.objective, "joint_market_log_loss");
assert.deepEqual(learned, fitCbbJointMarketLogLoss(train, 10));
const evaluated = evaluateCbbMarketReaderRows([row], head);
assert.equal(evaluated.markets.moneyline.harms, 1);
assert.equal(evaluated.markets.total.harms, 1);
console.log("CBB market reader: source names/orientation, UTC/T-60 exclusion, no fabricated paths, target-family exclusion, receipt policy, chronological learned heads, deterministic fitting, coherent flips and exact-line W/L/P passed.");
