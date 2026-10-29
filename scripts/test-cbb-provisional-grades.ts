import assert from "node:assert/strict";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { advanceCbbProvisionalSnapshot, readCbbProvisionalSnapshot,
  settleLockedCbbProvisionalBoard } from "../lib/cbb/provisionalLifecycle";
import { gradeCbbProvisional } from "../lib/cbb/provisionalGradePolicy";
import { cbbCurrentSplitEvidence } from "../lib/cbb/owlsSplitEvidence";
import { cbbObservedPricePaths, type CbbQualifiedNamedQuote } from "../lib/cbb/owlsMarketEvidence";
import { buildCbbProvisionalReader } from "../lib/cbb/provisionalReader";
import type { CbbForecast, CbbQuote } from "../lib/cbb/types";

const asOf = "2026-11-01T12:00:00.000Z";
const forecast: CbbForecast = {
  release: "cbb_candidate_test", gameId: 10882407, asOf, homeId: 92, awayId: 11,
  homeScore: 78.5, awayScore: 68.3, margin: 10.2, total: 146.8,
  possessions: 71, homeWinProbability: 0.81,
  uncertainty: { marginSd: 11, totalSd: 16, marginTotalCorrelation: 0,
    marginCorrection: 0, totalCorrection: 0, fitThroughSeason: 2025, games: 3000 },
  inputStatus: "complete", issues: [],
};
const target: CbbQuote = {
  gameId: forecast.gameId, sportsbook: "fanduel", market: "spread", line: -7.5,
  firstPrice: -105, secondPrice: -115, providerObservedAt: "2026-11-01T11:50:00.000Z",
  fetchedAt: "2026-11-01T11:55:00.000Z", phase: "current",
};
const input = { target, forecast, asOf, references: [] as CbbQuote[] };
const withoutSharp = gradeCbbProvisional(input);
assert.equal(withoutSharp.grade, "Lean");
assert.equal(withoutSharp.referenceState, "unavailable");
assert.equal(withoutSharp.professionalReferences, 0);
assert.equal(withoutSharp.stake, 0);

const sharp: CbbQuote = { ...target, sportsbook: "pinnacle", line: -9.5,
  firstPrice: -110, secondPrice: -110 };
const withSharp = gradeCbbProvisional({ ...input, references: [sharp] });
assert.equal(withSharp.grade, "Best Angle");
assert.equal(withSharp.referenceState, "agrees");
assert.equal(withSharp.professionalReferences, 1);
assert.equal(gradeCbbProvisional({ ...input, references: [sharp, { ...sharp, sportsbook: "ps3838" }] })
  .professionalReferences, 1);
assert.equal(gradeCbbProvisional({ ...input, references: [sharp, { ...sharp, sportsbook: "ps3838", line: -5.5 }] })
  .professionalReferences, 0);
const against = gradeCbbProvisional({ ...input, references: [{ ...sharp, line: -5.5 }] });
assert.equal(against.referenceState, "opposes");
assert.notEqual(against.grade, "Best Angle");
assert.notEqual(against.grade, "Lean");
const mixed = gradeCbbProvisional({ ...input, references: [sharp, { ...sharp, sportsbook: "circa", line: -5.5 }] });
assert.equal(mixed.referenceState, "mixed");
assert.equal(mixed.grade, "Watchlist");
assert.equal(gradeCbbProvisional({ ...input, references: [{ ...sharp, sportsbook: "fanduel" }] })
  .referenceState, "unavailable");
assert.equal(gradeCbbProvisional({ ...input, target: { ...target, fetchedAt: "2026-11-01T09:00:00.000Z" } })
  .grade, "Held");
assert.equal(gradeCbbProvisional({ ...input, target: { ...target, providerObservedAt: "2026-11-01T09:00:00.000Z" } })
  .grade, "Held");
assert.equal(gradeCbbProvisional({ ...input, references: [{ ...sharp, providerObservedAt: "2026-11-01T09:00:00.000Z" }] })
  .referenceState, "unavailable");
assert.equal(gradeCbbProvisional({ ...input, forecast: { ...forecast, inputStatus: "incomplete" } })
  .grade, "Held");
assert.throws(() => gradeCbbProvisional({ ...input, forecast: { ...forecast, gameId: 9 } }), /identity/);
const moneyline: CbbQuote = { ...target, market: "moneyline", line: null,
  firstPrice: -305, secondPrice: 255 };
const total: CbbQuote = { ...target, market: "total", line: 148.5,
  firstPrice: -110, secondPrice: -110 };
const board = buildCbbProvisionalBoard(forecast, [moneyline, target, total, sharp]);
const beforeProfessionalArrival = buildCbbProvisionalBoard(forecast, [moneyline, target, total]);
assert.equal(beforeProfessionalArrival.rows.find(row => row.market === "spread")?.referenceState, "unavailable");
assert.equal(board.rows.find(row => row.market === "spread")?.referenceState, "agrees");
assert.deepEqual(board.score, beforeProfessionalArrival.score);
assert.equal(board.rows.length, 3);
assert.deepEqual(board.rows.map(row => row.market), ["moneyline", "spread", "total"]);
assert.equal(board.rows.find(row => row.market === "spread")?.grade, "Best Angle");
assert.equal(board.targetBook, "fanduel");
assert.ok(Math.abs(board.score.home + board.score.away - board.score.total) < 1e-8);
assert.ok(Math.abs(board.score.home - board.score.away - board.score.margin) < 1e-8);
assert.throws(() => buildCbbProvisionalBoard({ ...forecast, total: forecast.total + 1 }, [moneyline, target, total]), /coherent/);
assert.throws(() => buildCbbProvisionalBoard(forecast, [{ ...target, gameId: 9 }]), /cross-game/);
const cbbGame = { id: forecast.gameId, date: "2026-11-01T14:30:00.000Z", season: 2026,
  status: "pre", period: 0, home_score: 0, away_score: 0,
  home_team: { id: forecast.homeId, full_name: "Villanova Wildcats", college: "Villanova",
    name: "Wildcats", abbreviation: "VILL", conference_id: 1 },
  visitor_team: { id: forecast.awayId, full_name: "Notre Dame Fighting Irish", college: "Notre Dame",
    name: "Fighting Irish", abbreviation: "ND", conference_id: 2 } };
const providerOdds = { success: true, data: [{ id: "provider-7", sport: "ncaab",
  home_team: "Notre Dame", away_team: "Villanova", commence_time: cbbGame.date }] };
const providerSplitGame = { event_id: "provider-7", home_team: "Notre Dame", away_team: "Villanova",
  splits: [{ book: "circa", as_of: "2026-11-01T11:50:00.000Z",
    moneyline: { home_bets_pct: 20, away_bets_pct: 80, home_handle_pct: 60, away_handle_pct: 40 },
    spread: { home_bets_pct: 30, away_bets_pct: 70, home_line: 7.5, away_line: -7.5 } }] };
const providerSplits = { sport: "ncaab", data: [providerSplitGame], meta: { status: "partial" } };
const splitEvidence = cbbCurrentSplitEvidence(cbbGame, providerOdds, providerSplits,
  "2026-11-01T11:55:00.000Z", asOf);
assert.equal(splitEvidence.eventId, "provider-7");
assert.equal(splitEvidence.rows.length, 4);
assert.equal(cbbCurrentSplitEvidence(cbbGame, { ...providerOdds, data: [...providerOdds.data, providerOdds.data[0]] },
  providerSplits, "2026-11-01T11:55:00.000Z", asOf).rows.length, 4);
assert.equal(cbbCurrentSplitEvidence(cbbGame, { ...providerOdds, data: [...providerOdds.data,
  { ...providerOdds.data[0], id: "different-event" }] }, providerSplits,
"2026-11-01T11:55:00.000Z", asOf).reason, "ambiguous_odds_event");
assert.deepEqual(splitEvidence.rows.find(row => row.market === "moneyline" && row.selection === "second"), {
  market: "moneyline", sourceBook: "circa", observedAt: "2026-11-01T11:50:00.000Z",
  selection: "second", ticketsPct: 0.2, moneyPct: 0.6, moneyMinusTicketsPoints: 40 });
assert.equal(splitEvidence.rows.find(row => row.market === "spread" && row.selection === "second")?.moneyMinusTicketsPoints, null);
assert.equal(cbbCurrentSplitEvidence(cbbGame, providerOdds, { ...providerSplits,
  data: [{ ...providerSplitGame, event_id: "other" }] }, "2026-11-01T11:55:00.000Z", asOf).reason,
"event_split_unavailable");
assert.equal(cbbCurrentSplitEvidence(cbbGame, providerOdds, { ...providerSplits,
  data: [{ ...providerSplitGame, home_team: "Duke" }] }, "2026-11-01T11:55:00.000Z", asOf).reason,
"split_participant_mismatch");
assert.equal(cbbCurrentSplitEvidence(cbbGame, providerOdds, { ...providerSplits,
  data: [{ ...providerSplitGame, splits: [{ ...providerSplitGame.splits[0], as_of: "2026-11-01T09:00:00.000Z" }] }] },
"2026-11-01T11:55:00.000Z", asOf).rows.length, 0);
const pathQuote: CbbQualifiedNamedQuote = { ...sharp, provider: "owls", orientationVerified: true };
const paths = cbbObservedPricePaths([pathQuote,
  { ...pathQuote, providerObservedAt: "2026-11-01T11:57:00.000Z", line: -8.5 },
  { ...pathQuote, sportsbook: "fanduel" }], "fanduel");
assert.equal(paths.length, 1);
assert.equal(paths[0].book, "pinnacle");
assert.equal(paths[0].distinctStates, 2);
assert.equal(paths[0].trueOpeningKnown, false);
assert.equal(paths[0].causalLeadership, "unknown");
const startsAt = "2026-11-01T14:30:00.000Z";
const captured = advanceCbbProvisionalSnapshot({ existing: null, candidate: board,
  startsAt, now: "2026-11-01T12:01:00.000Z" });
const storedBytes = JSON.stringify(captured);
assert.equal(captured.lockedAt, null);
assert.throws(() => advanceCbbProvisionalSnapshot({ existing: null, candidate: board,
  startsAt, now: "2026-11-01T13:31:00.000Z" }), /T-60/);
assert.throws(() => advanceCbbProvisionalSnapshot({ existing: captured,
  candidate: { ...board, gameId: 99 }, startsAt, now: "2026-11-01T12:10:00.000Z" }), /identity/);
const locked = advanceCbbProvisionalSnapshot({ existing: captured, candidate: null,
  startsAt, now: "2026-11-01T13:30:00.000Z" });
assert.equal(JSON.stringify(captured), storedBytes);
assert.equal(locked.board, captured.board);
assert.equal(locked.lockedAt, "2026-11-01T13:30:00.000Z");
const laterBoard = buildCbbProvisionalBoard({ ...forecast, asOf, homeScore: 68.3, awayScore: 78.5,
  margin: -10.2, homeWinProbability: 0.19 }, [moneyline, target, total]);
assert.equal(readCbbProvisionalSnapshot({ locked, unlocked: { ...captured, board: laterBoard } }), locked);
assert.equal(advanceCbbProvisionalSnapshot({ existing: locked, candidate: laterBoard,
  startsAt, now: "2026-11-01T14:00:00.000Z" }), locked);
const reader = buildCbbProvisionalReader({ game: cbbGame, locked: null, unlocked: captured,
  homeLogo: "https://example.com/villanova.png", awayLogo: "https://example.com/notre-dame.png",
  currentSplits: splitEvidence, currentPricePaths: paths });
assert.ok(reader);
assert.equal(reader.status, "open");
assert.equal(reader.predictionMarketReader, "unqualified");
assert.equal(reader.home.name, "Villanova Wildcats");
assert.equal(reader.away.name, "Notre Dame Fighting Irish");
assert.equal(reader.markets.find(row => row.market === "spread")?.side, "Villanova Wildcats");
assert.equal(reader.markets.find(row => row.market === "spread")?.selectedLine, -7.5);
assert.equal(reader.markets.find(row => row.market === "moneyline")?.splits.length, 2);
assert.deepEqual(reader.markets.find(row => row.market === "moneyline")?.splits.map(row => row.side).sort(),
  ["Villanova Wildcats", "Notre Dame Fighting Irish"].sort());
assert.equal(reader.markets.find(row => row.market === "spread")?.pricePaths.length, 1);
const lockedReader = buildCbbProvisionalReader({ game: cbbGame, locked,
  unlocked: { ...captured, board: laterBoard }, homeLogo: null, awayLogo: null,
  currentSplits: splitEvidence, currentPricePaths: paths });
assert.ok(lockedReader);
assert.equal(lockedReader.status, "locked");
assert.equal(lockedReader.score.home, board.score.home);
assert.equal(lockedReader.marketEvidenceState, "not_stored_at_lock");
assert.deepEqual(lockedReader.markets.map(row => [row.market, row.grade, row.price]),
  reader.markets.map(row => [row.market, row.grade, row.price]));
assert.ok(lockedReader.markets.every(row => row.splits.length === 0 && row.pricePaths.length === 0));
assert.throws(() => buildCbbProvisionalReader({ game: { ...cbbGame, id: 999 },
  locked, unlocked: null, homeLogo: null, awayLogo: null }), /identity/);
assert.throws(() => settleLockedCbbProvisionalBoard(captured, { home: 80, away: 72 }), /unlocked/);
const settled = settleLockedCbbProvisionalBoard(locked, { home: 80, away: 72 });
assert.deepEqual(settled.map(row => row.outcome), ["win", "win", "loss"]);
const pushBoard = buildCbbProvisionalBoard(forecast, [moneyline, { ...target, line: -8 }, total]);
const pushCaptured = advanceCbbProvisionalSnapshot({ existing: null, candidate: pushBoard,
  startsAt, now: "2026-11-01T12:01:00.000Z" });
const pushLocked = advanceCbbProvisionalSnapshot({ existing: pushCaptured, candidate: null,
  startsAt, now: "2026-11-01T13:30:00.000Z" });
assert.equal(settleLockedCbbProvisionalBoard(pushLocked, { home: 80, away: 72 })
  .find(row => row.market === "spread")?.outcome, "push");
console.log("CBB provisional exact-quote grade tests passed");
