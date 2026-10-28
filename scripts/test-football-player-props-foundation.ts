import assert from "node:assert/strict";
import {
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_PHASE_ONE_MARKETS,
  NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,
  NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE,
  buildNflPlayerPropsObservationSnapshot,
  summarizeNflPlayerPropsCoverage,
} from "../lib/services/football/nflPlayerPropsContract";
import {
  canonicalNflPlayerPropMarket,
  normalizeBalldontlieNflPlayerProps,
  normalizeOwlsNflPlayerProps,
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
assert.equal(canonicalNflPlayerPropMarket("player_total_receptions"), "receptions");
assert.equal(canonicalNflPlayerPropMarket("player_total_rush_attempts"), "rushing_attempts");
assert.equal(canonicalNflPlayerPropMarket("player_rushing_+_receiving_yards"), "rushing_receiving_yards");
assert.equal(canonicalNflPlayerPropMarket("rush_rec_yards"), "rushing_receiving_yards");
assert.equal(canonicalNflPlayerPropMarket("longest_completion"), "longest_pass");
assert.equal(canonicalNflPlayerPropMarket("field_goals_made"), "fg_made");
assert.equal(canonicalNflPlayerPropMarket("unknown_fun_prop"), null);
assert.equal(NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE, "nfl_player_props_provider_observation_2026_10_28_r14_owls_reference_prices");
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

const receivingMarketIntegrity = normalizeBalldontlieNflPlayerProps({
  fetchedAt,
  values: [
    bdlTwoWay(20, "fanduel", "receiving_yards", 67.5),
    bdlTwoWay(21, "fanduel", "receiving_yards", 11.5),
    bdlTwoWay(22, "draftkings", "receiving_yards", 11.5),
    bdlTwoWay(23, "betmgm", "receiving_yards", 12.5),
    bdlTwoWay(24, "betmgm", "player_rushing_+_receiving_yards", 67.5),
  ],
});
assert.equal(receivingMarketIntegrity.inputRows, 5);
assert.equal(receivingMarketIntegrity.rejectedRows, 1);
assert.equal(receivingMarketIntegrity.rows.length, 8);
assert.equal(receivingMarketIntegrity.rows.some((row) => row.sportsbook === "fanduel" && row.market === "receiving_yards" && row.line === 67.5), false);
assert.equal(receivingMarketIntegrity.rows.some((row) => row.sportsbook === "fanduel" && row.market === "receiving_yards" && row.line === 11.5), true);

const ambiguousReceivingMarket = normalizeBalldontlieNflPlayerProps({
  fetchedAt,
  values: [
    bdlTwoWay(30, "fanduel", "receiving_yards", 67.5),
    bdlTwoWay(31, "draftkings", "receiving_yards", 11.5),
    bdlTwoWay(32, "betmgm", "player_rushing_+_receiving_yards", 67.5),
  ],
});
assert.equal(ambiguousReceivingMarket.rejectedRows, 0, "one independent receiving book cannot prove a semantic mismatch");
assert.equal(ambiguousReceivingMarket.rows.length, 6);

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
const reconciledSharp = __NFL_PLAYER_PROPS_COLLECTOR_TEST__.reconcileProviderRowsToSlate(sharp.rows, games);
assert.equal(reconciledSharp.unmatchedRows, 0);
assert.equal(reconciledSharp.rows[0]?.canonicalGameId, "424129");
assert.equal(reconciledSharp.rows[0]?.provider, "sharpapi", "legacy Sharp fixtures retain truthful provenance");

const owls = normalizeOwlsNflPlayerProps({
  fetchedAt,
  values: [{
    gameId: "nfl:Dallas Cowboys@Philadelphia Eagles-20260910",
    homeTeam: "Philadelphia Eagles",
    awayTeam: "Dallas Cowboys",
    commenceTime: "2026-09-10T00:20:00Z",
    isLive: false,
    books: [{
      key: "novig",
      lastUpdate: "2026-09-09T18:03:00Z",
      props: [
        { playerName: "Jalen Hurts", category: "passing_yards", line: 245.5, overPrice: -105, underPrice: -115, lastUpdate: "2026-09-09T18:03:30Z" },
        { playerName: "Jalen Hurts", category: "first_touchdown_scorer", line: 0.5, overPrice: 900, underPrice: null, lastUpdate: "2026-09-09T18:03:30Z" },
      ],
    }],
  }],
});
assert.equal(owls.inputRows, 2);
assert.equal(owls.rows.length, 2, "only complete two-way Owls pairs enter the model contract");
assert.equal(owls.rejectedRows, 1);
assert.deepEqual(owls.rows.map((row) => row.side), ["over", "under"]);
assert.ok(owls.rows.every((row) => row.provider === "owls" && row.sportsbook === "novig"));
const reconciledOwls = __NFL_PLAYER_PROPS_COLLECTOR_TEST__.reconcileProviderRowsToSlate(owls.rows, games);
assert.equal(reconciledOwls.unmatchedRows, 0);
assert.ok(reconciledOwls.rows.every((row) => row.canonicalGameId === "424129"));
assert.equal(__NFL_PLAYER_PROPS_COLLECTOR_TEST__.dedupeObservations([
  reconciledOwls.rows[0]!,
  { ...reconciledOwls.rows[0]!, fetchedAt: "2026-08-20T16:01:00Z" },
]).length, 1, "the isolated reference lane cannot duplicate an existing provider observation");

const observations = [...bdl.rows, ...opening.rows, ...reconciledOwls.rows];
const coverage = summarizeNflPlayerPropsCoverage(observations);
assert.equal(coverage.completeTwoWayBuckets, 2);
assert.equal(coverage.openingRows, 1);
assert.equal(coverage.phaseOneTwoWayRows, 4);
assert.equal(coverage.milestoneRows, 2);
assert.deepEqual(coverage.sportsbooks, ["draftkings", "fanduel", "novig"]);

const snapshot = buildNflPlayerPropsObservationSnapshot({
  generatedAt: fetchedAt,
  fetchedAt,
  season: 2026,
  week: 1,
  phase: "regular",
  games,
  observations,
  providerRequests: { balldontlie: 3, owls: 1 },
  providerComplete: { balldontlie: true, owls: true },
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
assert.equal(NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxOwlsEvents, 18);
assert.equal(NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxOwlsBooksPerEvent, 16);
assert.equal(NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxOwlsPropsPerBook, 1_000);
assert.equal(NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxOwlsQuoteAgeHours, 6);
assert.deepEqual([...NFL_PLAYER_PROPS_COLLECTION_LIMITS.owlsReferenceResearchBooks].sort(), ["novig", "pinnacle"]);

function bdlTwoWay(id: number, vendor: string, propType: string, line: number) {
  return {
    id,
    game_id: 424129,
    player_id: 490,
    vendor,
    prop_type: propType,
    line_value: String(line),
    market: { type: "over_under", over_odds: -110, under_odds: -110 },
    updated_at: "2026-09-09T18:00:00Z",
  };
}
assert.equal(NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxPlayerIdentities, 768);
assert.equal(NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxPlayerIdentitiesPerGame, 64);
const capacityRows = Array.from({ length: 613 }, (_, index) => ({
  providerEventId: `game-${Math.floor(index / 32)}`,
  providerPlayerId: `player-${index}`,
}));
assert.deepEqual(
  __NFL_PLAYER_PROPS_COLLECTOR_TEST__.collectBoundedPlayerIdentities([
    ...capacityRows,
    capacityRows[0]!,
  ]),
  capacityRows.map((row) => row.providerPlayerId),
  "the observed 613-player regular-season slate is accepted with exact deduplicated identity order",
);
assert.throws(
  () => __NFL_PLAYER_PROPS_COLLECTOR_TEST__.collectBoundedPlayerIdentities(
    Array.from({ length: 769 }, (_, index) => ({
      providerEventId: `game-${Math.floor(index / 32)}`,
      providerPlayerId: `player-${index}`,
    })),
  ),
  /opened at 769 players/,
  "aggregate identity contamination remains fail-closed",
);
assert.throws(
  () => __NFL_PLAYER_PROPS_COLLECTOR_TEST__.collectBoundedPlayerIdentities(
    Array.from({ length: 65 }, (_, index) => ({
      providerEventId: "polluted-game",
      providerPlayerId: `player-${index}`,
    })),
  ),
  /opened for game polluted-game at 65 players/,
  "one polluted game cannot consume the expanded slate budget",
);
assert.deepEqual(__NFL_PLAYER_PROPS_COLLECTOR_TEST__.owlsEvents({ data: [{ gameId: "one" }] }), [{ gameId: "one" }]);
assert.throws(() => __NFL_PLAYER_PROPS_COLLECTOR_TEST__.owlsEvents({ data: {} }), /malformed data/);
assert.throws(
  () => __NFL_PLAYER_PROPS_COLLECTOR_TEST__.validateOwlsCapacity(Array.from({ length: 19 }, () => ({}))),
  /exceeded 18 events/,
  "one league-level Owls response remains bounded",
);
assert.throws(
  () => __NFL_PLAYER_PROPS_COLLECTOR_TEST__.validateOwlsCapacity([{ books: [{ props: Array.from({ length: 1_001 }, () => ({})) }] }]),
  /per-book prop limit/,
  "a contaminated Owls book cannot expand memory without bound",
);
assert.equal(__NFL_PLAYER_PROPS_COLLECTOR_TEST__.freshAtFetch("2026-10-28T03:20:00Z", "2026-10-28T03:25:00Z"), true);
assert.equal(__NFL_PLAYER_PROPS_COLLECTOR_TEST__.freshAtFetch("2026-10-27T20:00:00Z", "2026-10-28T03:25:00Z"), false);
assert.equal(__NFL_PLAYER_PROPS_COLLECTOR_TEST__.freshAtFetch("2026-10-28T03:27:00Z", "2026-10-28T03:25:00Z"), false);
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
