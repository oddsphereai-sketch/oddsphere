import assert from "node:assert/strict";
import {
  completeSharpApiNflSplitSet,
  matchSharpApiNflSplitRows,
  normalizeSharpApiNflSplit,
  type SharpApiNflSplitRow,
} from "../lib/services/football/sharpApiNflSplits";
import type { NflPreviewGame } from "../lib/services/football/balldontlieNflPreviewSlate";

const game: NflPreviewGame = {
  providerGameId: "week1-ne-sea",
  providerWeek: 1,
  season: 2026,
  scheduledStart: "2026-09-10T00:20:00.000Z",
  status: "scheduled",
  away: { id: 1, abbreviation: "NE", name: "New England Patriots" },
  home: { id: 2, abbreviation: "SEA", name: "Seattle Seahawks" },
};

const row: SharpApiNflSplitRow = {
  event_id: "nfl_patriots_seahawks_2026-09-09",
  event_start_time: game.scheduledStart,
  league: "nfl",
  away_team: "New England Patriots",
  home_team: "Seattle Seahawks",
  sportsbook: "circa",
  fetched_at: "2026-08-21T17:00:00Z",
  moneyline: { bets_pct: { home: 0.42, away: 0.58 }, handle_pct: { home: 0.61, away: 0.39 } },
  spread: { bets_pct: { home: 48, away: 52 }, handle_pct: { home: 55, away: 45 } },
  total: { bets_pct: { over: 0.57, under: 0.43 }, handle_pct: { over: 0.63, under: 0.37 } },
};

const normalized = normalizeSharpApiNflSplit(game.providerGameId, "2026-08-21T17:01:00Z", row);
assert.equal(normalized.moneyline.homeBetsPct, 42);
assert.equal(normalized.moneyline.homeMoneyPct, 61);
assert.equal(normalized.spread.awayBetsPct, 52);
assert.equal(normalized.total.overMoneyPct, 63);
assert.equal(completeSharpApiNflSplitSet(normalized), true);

const matched = matchSharpApiNflSplitRows([game], [{ date: "2026-09-09", rows: [row] }], "2026-08-21T17:01:00Z");
assert.equal(matched[game.providerGameId]?.total.underBetsPct, 43);
assert.equal(matched[game.providerGameId]?.moneyline.sourceSportsbook, "circa");

const draftKings = { ...row, sportsbook: "draftkings", fetched_at: "2026-08-21T17:02:00Z" };
const betMgm = { ...row, sportsbook: "betmgm", fetched_at: "2026-08-21T17:03:00Z" };
assert.equal(
  matchSharpApiNflSplitRows(
    [game],
    [{ date: "2026-09-09", rows: [betMgm, draftKings, row] }],
    "2026-08-21T17:04:00Z",
  )[game.providerGameId]?.moneyline.sourceSportsbook,
  "circa",
);

const incompleteCirca = {
  ...row,
  total: { bets_pct: { over: 0.57, under: 0.43 }, handle_pct: null },
};
assert.equal(
  matchSharpApiNflSplitRows(
    [game],
    [{ date: "2026-09-09", rows: [betMgm, draftKings, incompleteCirca] }],
    "2026-08-21T17:04:00Z",
  )[game.providerGameId]?.moneyline.sourceSportsbook,
  "draftkings",
);
assert.equal(
  matchSharpApiNflSplitRows(
    [game],
    [{ date: "2026-09-09", rows: [betMgm, incompleteCirca] }],
    "2026-08-21T17:04:00Z",
  )[game.providerGameId]?.moneyline.sourceSportsbook,
  "betmgm",
);

const consensus = { ...row, sportsbook: "consensus" };
assert.deepEqual(
  matchSharpApiNflSplitRows([game], [{ date: "2026-09-09", rows: [consensus] }], "2026-08-21T17:01:00Z"),
  {},
);
assert.equal(
  matchSharpApiNflSplitRows(
    [game],
    [{ date: "2026-09-09", rows: [row, { ...row }] }],
    "2026-08-21T17:01:00Z",
  )[game.providerGameId],
  undefined,
);

const stale = { ...row, event_start_time: "2026-09-11T00:20:00.000Z" };
assert.deepEqual(
  matchSharpApiNflSplitRows([game], [{ date: "2026-09-09", rows: [stale] }], "2026-08-21T17:01:00Z"),
  {},
);

const crossLeague = { ...row, league: "cfl" };
assert.deepEqual(
  matchSharpApiNflSplitRows([game], [{ date: "2026-09-09", rows: [crossLeague] }], "2026-08-21T17:01:00Z"),
  {},
);

const partial = normalizeSharpApiNflSplit(game.providerGameId, "2026-08-21T17:01:00Z", {
  ...row,
  total: { bets_pct: { over: 0.57, under: 0.43 }, handle_pct: null },
});
assert.equal(completeSharpApiNflSplitSet(partial), false);

console.log("NFL SharpAPI split normalization, identity, date, and completeness tests passed.");
