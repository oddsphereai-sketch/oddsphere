import assert from "node:assert/strict";
import {
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_PHASE_ONE_MARKETS,
  NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE,
  buildNflPlayerPropsObservationSnapshot,
  summarizeNflPlayerPropsCoverage,
} from "../lib/services/football/nflPlayerPropsContract";
import {
  canonicalNflPlayerPropMarket,
  normalizeBalldontlieNflPlayerProps,
  normalizeSharpNflPlayerProps,
} from "../lib/services/football/nflPlayerPropsProviders";
import {
  __NFL_PLAYER_PROPS_COLLECTOR_TEST__,
  NFL_PLAYER_PROPS_COLLECTION_LIMITS,
} from "../lib/services/football/nflPlayerPropsCollector";

const fetchedAt = "2026-08-20T16:00:00Z";
const games = [{
  season: 2026,
  week: 1,
  phase: "regular" as const,
  providerGameId: "424129",
  scheduledStart: "2026-09-10T00:20:00Z",
  homeTeam: "PHI",
  awayTeam: "DAL",
  homeTeamName: "Philadelphia Eagles",
  awayTeamName: "Dallas Cowboys",
}];

assert.equal(canonicalNflPlayerPropMarket("player_passing_yards"), "passing_yards");
assert.equal(canonicalNflPlayerPropMarket("rushing_yards"), "rushing_yards");
assert.equal(canonicalNflPlayerPropMarket("unknown_fun_prop"), null);
assert.deepEqual(NFL_PLAYER_PROPS_PHASE_ONE_MARKETS, [
  "passing_attempts",
  "passing_completions",
  "passing_yards",
  "rushing_attempts",
  "rushing_yards",
  "receptions",
  "receiving_yards",
]);

const bdl = normalizeBalldontlieNflPlayerProps({
  fetchedAt,
  values: [
    {
      id: 111967700,
      game_id: 424129,
      player_id: 490,
      vendor: "fanduel",
      prop_type: "rushing_yards",
      line_value: "85.5",
      market: { type: "over_under", over_odds: -115, under_odds: -110 },
      updated_at: "2026-09-09T18:00:00Z",
    },
    {
      id: 112042232,
      game_id: 424129,
      player_id: 490,
      vendor: "draftkings",
      prop_type: "anytime_td",
      line_value: "0.5",
      market: { type: "milestone", odds: 150 },
      updated_at: "2026-09-09T18:01:00Z",
    },
    {
      id: 3,
      game_id: 424129,
      player_id: 490,
      vendor: "fanduel",
      prop_type: "mystery_prop",
      line_value: "1.5",
      market: { type: "over_under", over_odds: -110, under_odds: -110 },
      updated_at: "2026-09-09T18:00:00Z",
    },
  ],
});
assert.equal(bdl.rows.length, 3);
assert.equal(bdl.rejectedRows, 1);
assert.deepEqual(bdl.unknownMarkets, { mystery_prop: 1 });
assert.deepEqual(bdl.rows.slice(0, 2).map((row) => row.side), ["over", "under"]);
assert.equal(bdl.rows[2]?.offerType, "milestone");
assert.equal(bdl.rows[2]?.side, "yes");
assert.ok(bdl.rows.every((row) => row.playerName === null && row.providerPlayerId === "490"));

const opening = normalizeBalldontlieNflPlayerProps({
  fetchedAt,
  opening: true,
  values: [{
    id: 10,
    game_id: 424129,
    player_id: 630,
    vendor: "draftkings",
    prop_type: "anytime_td",
    line_value: "0.5",
    market: { type: "milestone", odds: 600 },
    opened_at: "2026-09-08T13:58:27.284Z",
  }],
});
assert.equal(opening.rows[0]?.isOpening, true);
assert.equal(opening.rows[0]?.observedAt, "2026-09-08T13:58:27.284Z");

const sharp = normalizeSharpNflPlayerProps({
  fetchedAt,
  values: [{
    id: "dk-prop-1",
    sportsbook: "draftkings",
    event_id: "sharp-event-1",
    league: "nfl",
    home_team: "Philadelphia Eagles",
    away_team: "Dallas Cowboys",
    market_type: "player_passing_yards",
    player_name: "Jalen Hurts",
    selection: "Over",
    selection_type: "over",
    odds_american: -105,
    line: 245.5,
    event_start_time: "2026-09-10T00:20:00Z",
    timestamp: "2026-09-09T18:02:00Z",
    is_live: false,
  }],
});
assert.equal(sharp.rows.length, 1);
assert.equal(sharp.rows[0]?.playerName, "Jalen Hurts");
assert.equal(sharp.rows[0]?.side, "over", "Sharp selection is the side; player_name owns player identity");
assert.equal(sharp.rows[0]?.market, "passing_yards");
const reconciledSharp = __NFL_PLAYER_PROPS_COLLECTOR_TEST__.reconcileSharpRowsToSlate(sharp.rows, games);
assert.equal(reconciledSharp.unmatchedRows, 0);
assert.equal(reconciledSharp.rows[0]?.canonicalGameId, "424129");

const observations = [...bdl.rows, ...opening.rows, ...reconciledSharp.rows];
const coverage = summarizeNflPlayerPropsCoverage(observations);
assert.equal(coverage.completeTwoWayBuckets, 1);
assert.equal(coverage.openingRows, 1);
assert.equal(coverage.phaseOneTwoWayRows, 3);
assert.equal(coverage.milestoneRows, 2);
assert.deepEqual(coverage.sportsbooks, ["draftkings", "fanduel"]);

const snapshot = buildNflPlayerPropsObservationSnapshot({
  generatedAt: fetchedAt,
  fetchedAt,
  season: 2026,
  week: 1,
  phase: "regular",
  games,
  observations,
  providerRequests: { balldontlie: 3, sharpapi: 1 },
  providerComplete: { balldontlie: true, sharpapi: true },
});
assert.equal(snapshot.actionable, false);
assert.equal(snapshot.mode, "local_observe_only");
assert.equal(snapshot.shadowModelRelease, NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE);
assert.equal(snapshot.decisionRelease, NFL_PLAYER_PROPS_DECISION_RELEASE);
assert.equal(snapshot.collectionComplete, true);
assert.equal(snapshot.modelingReady, false);
assert.throws(
  () => buildNflPlayerPropsObservationSnapshot({
    generatedAt: fetchedAt,
    fetchedAt,
    season: 2026,
    week: 1,
    phase: "regular",
    games,
    observations: [{ ...bdl.rows[0]!, providerEventId: "outside-slate" }],
    providerRequests: { balldontlie: 1 },
    providerComplete: { balldontlie: true },
  }),
  /outside the requested slate/,
);

assert.equal(NFL_PLAYER_PROPS_COLLECTION_LIMITS.bdlConcurrency, 3);
assert.ok(NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxSharpPages <= 8);
assert.deepEqual(
  __NFL_PLAYER_PROPS_COLLECTOR_TEST__.nextSharpPropsPage({ has_more: true, next_offset: 200 }, 0),
  { offset: 200, cursor: null },
);
assert.deepEqual(
  __NFL_PLAYER_PROPS_COLLECTOR_TEST__.nextSharpPropsPage({ has_more: true, next_offset: undefined, next_cursor: "cursor-400" } as never, 400),
  { offset: 400, cursor: "cursor-400" },
);
assert.deepEqual(
  __NFL_PLAYER_PROPS_COLLECTOR_TEST__.nextSharpPropsPage({ has_more: true, next_offset: undefined } as never, 400),
  { offset: 600, cursor: null },
  "a provider response with has_more but no continuation token advances by the bounded requested page size",
);
assert.equal(__NFL_PLAYER_PROPS_COLLECTOR_TEST__.nextSharpPropsPage({ has_more: false }, 400), null);
assert.throws(() => __NFL_PLAYER_PROPS_COLLECTOR_TEST__.validateRequest(2026, 4, "preseason"), /1 through 3/);
assert.equal(
  __NFL_PLAYER_PROPS_COLLECTOR_TEST__.inSlateWindow("2026-09-10T01:00:00Z", games),
  true,
);
assert.equal(
  __NFL_PLAYER_PROPS_COLLECTOR_TEST__.normalizeGame({
    id: 1,
    season: 2026,
    week: 3,
    date: "2026-08-20T23:00:00Z",
    home_team: { abbreviation: "NE" },
    visitor_team: { abbreviation: "NYG" },
  }, "preseason")?.week,
  2,
  "BALLDONTLIE preseason week includes the Hall of Fame offset",
);
const identity = __NFL_PLAYER_PROPS_COLLECTOR_TEST__.normalizePlayerIdentity({
  id: 490,
  first_name: "Test",
  last_name: "Runner",
  team: { abbreviation: "PHI" },
});
assert.deepEqual(identity, { id: "490", name: "Test Runner", team: "PHI" });
const enriched = __NFL_PLAYER_PROPS_COLLECTOR_TEST__.enrichPlayerIdentities(
  bdl.rows,
  new Map([["490", { name: "Test Runner", team: "PHI" }]]),
);
assert.ok(enriched.every((row) => row.playerName === "Test Runner" && row.playerTeam === "PHI"));

console.log("NFL player-props foundation: all focused tests passed");
