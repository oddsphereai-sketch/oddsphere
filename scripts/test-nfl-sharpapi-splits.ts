import assert from "node:assert/strict";
import {
  completeSharpApiNflSplitSet,
  fetchSharpApiNflSplits,
  matchAllSharpApiNflSplitRows,
  matchSharpApiNflSplitRows,
  NFL_SHARP_API_SPLITS_RELEASE,
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

const providerPrefixedNames = {
  ...row,
  away_team: "NE Patriots",
  home_team: "SEA Seahawks",
};
assert.equal(
  matchSharpApiNflSplitRows(
    [game],
    [{ date: "2026-09-09", rows: [providerPrefixedNames] }],
    "2026-08-21T17:01:00Z",
  )[game.providerGameId]?.moneyline.sourceSportsbook,
  "circa",
  "provider abbreviation-plus-nickname identities must match exactly",
);

const ramsGame: NflPreviewGame = {
  ...game,
  providerGameId: "week1-buf-lar",
  away: { id: 3, abbreviation: "BUF", name: "Buffalo Bills" },
  home: { id: 4, abbreviation: "LAR", name: "Los Angeles Rams" },
};
assert.ok(matchSharpApiNflSplitRows(
  [ramsGame],
  [{ date: "2026-09-09", rows: [{ ...row, away_team: "BUF Bills", home_team: "LA Rams" }] }],
  "2026-08-21T17:01:00Z",
)[ramsGame.providerGameId], "provider LA Rams identity must map only to LAR");

const draftKings = { ...row, sportsbook: "draftkings", fetched_at: "2026-08-21T17:02:00Z" };
const betMgm = { ...row, sportsbook: "betmgm", fetched_at: "2026-08-21T17:03:00Z" };
const allSources = matchAllSharpApiNflSplitRows(
  [game],
  [{ date: "2026-09-09", rows: [
    row,
    { ...draftKings, moneyline: { ...draftKings.moneyline, handle_pct: { home: 35, away: 65 } } },
    betMgm,
  ] }],
  "2026-08-21T17:04:00Z",
)[game.providerGameId]!;
assert.deepEqual(allSources.map((source) => source.sportsbook), ["circa", "draftkings", "betmgm"]);
assert.ok(allSources.every((source) => source.status === "observed" && source.observations.length === 1));
assert.equal(allSources.find((source) => source.sportsbook === "circa")?.observations[0]?.moneyline.homeMoneyPct, 61);
assert.equal(allSources.find((source) => source.sportsbook === "draftkings")?.observations[0]?.moneyline.homeMoneyPct, 35,
  "conflicting identified-book observations must survive independently");
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
const sourceStates = matchAllSharpApiNflSplitRows(
  [game], [{ date: "2026-09-09", rows: [row, { ...row }, incompleteCirca, draftKings] }],
  "2026-08-21T17:04:00Z",
)[game.providerGameId]!;
assert.equal(sourceStates.find((source) => source.sportsbook === "circa")?.status, "duplicate");
assert.equal(sourceStates.find((source) => source.sportsbook === "circa")?.observations.length, 3,
  "duplicate exact-identity rows must be retained instead of dropped");
assert.equal(sourceStates.find((source) => source.sportsbook === "betmgm")?.status, "unavailable");
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

async function testFetchContract(): Promise<void> {
  const calls: Array<{ path: string; query: unknown; maxPages?: number }> = [];
  const fetched = await fetchSharpApiNflSplits({
    apiKey: "test-key",
    games: [game],
    capturedAt: "2026-08-21T17:04:00Z",
    clock: () => "2026-08-21T17:04:05Z",
    client: {
      async fetchAll<T>(options: { path: string; query?: unknown; maxPages?: number }): Promise<T[]> {
        calls.push({ path: options.path, query: options.query, maxPages: options.maxPages });
        return [row] as T[];
      },
    },
  });
  assert.equal(fetched.release, NFL_SHARP_API_SPLITS_RELEASE);
  assert.equal(fetched.requests, 1);
  assert.equal(fetched.rows, 1);
  assert.equal(fetched.captureManifest.returnedRows, 1);
  assert.equal(fetched.captureManifest.matchedRows, 1);
  assert.equal(fetched.captureManifest.responseReceivedAt, "2026-08-21T17:04:05.000Z");
  assert.deepEqual(calls, [{
    path: "/splits",
    query: { league: "nfl", sportsbook: "circa,draftkings,betmgm", limit: 200 },
    maxPages: 1,
  }]);
  assert.equal(fetched.splitsByGame[game.providerGameId]?.moneyline.sourceSportsbook, "circa");
  assert.equal(fetched.sourcesByGame[game.providerGameId]?.length, 3);
  assert.equal(fetched.sourcesByGame[game.providerGameId]?.find((source) => source.sportsbook === "draftkings")?.status,
    "unavailable");
}

async function testTruncationFailsClosed(): Promise<void> {
  await assert.rejects(() => fetchSharpApiNflSplits({
    apiKey: "test-key",
    games: [game],
    capturedAt: "2026-08-21T17:04:00Z",
    clock: () => "2026-08-21T17:04:05Z",
    client: { async fetchAll<T>(): Promise<T[]> { return Array.from({ length: 200 }, () => row) as T[]; } },
  }), /completeness is unproved/);
}

async function testExactFullPageRequiresExplicitCompleteness(): Promise<void> {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    ...row,
    event_id: `unmatched-${index}`,
    away_team: "Unknown Away",
    home_team: "Unknown Home",
  }));
  const fetched = await fetchSharpApiNflSplits({
    apiKey: "test-key",
    games: [game],
    capturedAt: "2026-08-21T17:04:00Z",
    clock: () => "2026-08-21T17:04:05Z",
    client: {
      async fetchAll<T>(): Promise<T[]> { throw new Error("direct page metadata path expected"); },
      async fetch<T>(): Promise<{ data: T; pagination: { total: number; count: number; offset: number; has_more: boolean } }> {
        return { data: rows as T, pagination: { total: 200, count: 200, offset: 0, has_more: false } };
      },
    },
  });
  assert.equal(fetched.captureManifest.returnedRows, 200);
  assert.equal(fetched.captureManifest.unmatchedRows, 200);
}

async function testShortPageStillFailsWhenProviderDeclaresMore(): Promise<void> {
  await assert.rejects(() => fetchSharpApiNflSplits({
    apiKey: "test-key",
    games: [game],
    capturedAt: "2026-08-21T17:04:00Z",
    client: {
      async fetchAll<T>(): Promise<T[]> { throw new Error("direct page metadata path expected"); },
      async fetch<T>(): Promise<{ data: T; pagination: { total: number; count: number; offset: number; has_more: boolean } }> {
        return { data: Array.from({ length: 100 }, () => row) as T,
          pagination: { total: 250, count: 100, offset: 0, has_more: true } };
      },
    },
  }), /completeness is unproved/,
  "provider-declared truncation must fail closed even when the returned page is shorter than the requested limit");
}

void Promise.all([testFetchContract(), testTruncationFailsClosed(), testExactFullPageRequiresExplicitCompleteness(),
  testShortPageStillFailsWhenProviderDeclaresMore()]).then(() => {
  console.log("NFL SharpAPI lossless all-source split manifest and backward-compatible selection tests passed.");
});
