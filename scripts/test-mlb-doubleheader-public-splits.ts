import assert from "node:assert/strict";

import { matchPlaybookSplitsToSlateGames } from "../lib/services/syncPublicSplitsObservations";
import type { PlaybookSplitGame } from "../lib/providers/playbook/types";

const early: PlaybookSplitGame = {
  gameId: "pb-early",
  awayTeamName: "Tampa Bay Rays",
  homeTeamName: "Boston Red Sox",
  startTime: "2026-07-17T17:35:00Z",
  splits: { moneyline: { bets: { awayPercent: 36, homePercent: 64 } } },
};
const late: PlaybookSplitGame = {
  gameId: "pb-late",
  awayTeamName: "Tampa Bay Rays",
  homeTeamName: "Boston Red Sox",
  startTime: "2026-07-17T23:10:00Z",
  splits: { moneyline: { bets: { awayPercent: 40, homePercent: 60 } } },
};
const games = [
  { id: 31438, key: "TB@BOS", gameDate: "2026-07-17T17:35:00Z" },
  { id: 31441, key: "TB@BOS", gameDate: "2026-07-17T23:10:00Z" },
];

// Provider order must not matter; each canonical game gets its own event row.
const matched = matchPlaybookSplitsToSlateGames(games, [late, early], "mlb");
assert.equal(matched.get(31438)?.gameId, "pb-early");
assert.equal(matched.get(31441)?.gameId, "pb-late");
assert.notEqual(matched.get(31438)?.gameId, matched.get(31441)?.gameId);

// Fail closed when a repeated matchup cannot be uniquely identified.
const ambiguous = matchPlaybookSplitsToSlateGames(games, [
  { ...early, gameId: "pb-a", startTime: undefined },
  { ...late, gameId: "pb-b", startTime: undefined },
], "mlb");
assert.equal(ambiguous.size, 0);

// Playbook returns today and tomorrow together. Repeated team matchups must
// select the row near the requested slate game instead of rejecting both.
const todayGame = [{ id: 37261, key: "CWS@TB", gameDate: "2026-07-31T23:10:00Z" }];
const todayRow: PlaybookSplitGame = {
  gameId: "pb-today",
  awayTeamName: "Chicago White Sox",
  homeTeamName: "Tampa Bay Rays",
  startTime: "2026-07-31T23:11:00Z",
};
const tomorrowRow: PlaybookSplitGame = {
  ...todayRow,
  gameId: "pb-tomorrow",
  startTime: "2026-08-01T20:11:00Z",
};
const repeatedDateMatch = matchPlaybookSplitsToSlateGames(
  todayGame,
  [tomorrowRow, todayRow],
  "mlb",
);
assert.equal(repeatedDateMatch.get(37261)?.gameId, "pb-today");

// Never attach tomorrow's row to today's game merely because it is the only
// remaining provider row after today's event disappears from the feed.
const wrongDateOnly = matchPlaybookSplitsToSlateGames(todayGame, [tomorrowRow], "mlb");
assert.equal(wrongDateOnly.size, 0);

console.log("mlb-doubleheader-public-splits: all assertions passed");
