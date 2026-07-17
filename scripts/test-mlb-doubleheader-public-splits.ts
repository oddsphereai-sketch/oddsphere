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

console.log("mlb-doubleheader-public-splits: all assertions passed");
