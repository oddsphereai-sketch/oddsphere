import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildNbaPlayerPropsForwardDecisions,
  nbaPlayerPropsFrozenRuntimeArtifact,
} from "../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import {
  mergeNbaPlayerPropsCurrentState,
  NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,
} from "../lib/services/nba/nbaPlayerPropsCurrentState";
import {
  decodeNbaPlayerPropsPrivatePayload,
  encodeNbaPlayerPropsPrivatePayload,
  mergeNbaPlayerPropsMarketHistory,
} from "../lib/services/nba/nbaPlayerPropsPrivateStore";
import {
  NBA_PLAYER_PROPS_OBSERVATION_RELEASE,
  NBA_PLAYER_PROPS_FOUNDATION_MARKETS,
  type NbaPlayerPropPriceObservation,
} from "../lib/services/nba/nbaPlayerPropsContract";
import {
  buildNbaPlayerPropsMarketEvidence,
  selectNbaPlayerPropsCurrentCanonicalOfferSets,
} from "../lib/services/nba/nbaPlayerPropsMarketEvidence";
import { buildNbaPlayerPropsPointInTimeFeatures } from "../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";
import { nbaPlayerPropsScheduleGameMatches } from "../lib/services/nba/nbaPlayerPropsPrivateWriter";
import type { NbaHistoricalGame, NbaHistoricalPlayerBox } from "../lib/services/nba/nbaPointInTimeFeatures";

const artifact = nbaPlayerPropsFrozenRuntimeArtifact();
assert.equal(artifact.publicEnabled, false);
assert.equal(artifact.release, "nba_player_props_frozen_runtime_artifact_2026_10_21_r1_private_forward");
assert.equal(nbaPlayerPropsScheduleGameMatches(
  { awayTeam: "GS", homeTeam: "LAL" },
  { awayTeam: "GSW", homeTeam: "LAL" },
), true, "ESPN and provider Golden State abbreviations must identify the same scheduled game");
assert.equal(nbaPlayerPropsScheduleGameMatches(
  { awayTeam: "MIL", homeTeam: "WSH" },
  { awayTeam: "MIL", homeTeam: "WAS" },
), true, "ESPN and provider Washington abbreviations must identify the same scheduled game");
assert.equal(nbaPlayerPropsScheduleGameMatches(
  { awayTeam: "IND", homeTeam: "NO" },
  { awayTeam: "IND", homeTeam: "NOP" },
), true, "ESPN and provider New Orleans abbreviations must identify the same scheduled game");
assert.equal(nbaPlayerPropsScheduleGameMatches(
  { awayTeam: "UTAH", homeTeam: "MEM" },
  { awayTeam: "UTA", homeTeam: "MEM" },
), true, "ESPN and provider Utah abbreviations must identify the same scheduled game");

const games: NbaHistoricalGame[] = [];
const boxes: NbaHistoricalPlayerBox[] = [];
for (let index = 0; index < 12; index += 1) {
  const gameId = index + 1;
  games.push({
    gameId,
    season: 2025,
    startTime: new Date(Date.UTC(2025, 9, index + 1)).toISOString(),
    homeTeamId: 1,
    awayTeamId: 2,
    homeTeam: "AAA",
    awayTeam: "BBB",
    homeScore: 110 + (index % 4),
    awayScore: 101 + (index % 5),
  });
  boxes.push(box(gameId, gameId * 10 + 1, 1, 10, 34 + (index % 3), 22 + (index % 7)));
  boxes.push(box(gameId, gameId * 10 + 2, 1, 11, 30, 15));
  boxes.push(box(gameId, gameId * 10 + 3, 2, 20, 35, 24));
}
const upcoming = {
  gameId: 99,
  season: 2026,
  startTime: "2026-10-22T00:00:00.000Z",
  homeTeamId: 1,
  awayTeamId: 2,
  homeTeam: "AAA",
  awayTeam: "BBB",
};
const features = buildNbaPlayerPropsPointInTimeFeatures({
  games,
  upcomingGames: [upcoming],
  boxes,
  candidates: [{ gameId: 99, playerId: 10, playerName: "Test Player", teamId: 1 }],
  emitGameIds: new Set([99]),
});
assert.equal(features.length, 1);
assert.equal(features[0]!.player_games_prior, 12);

const observations = NBA_PLAYER_PROPS_FOUNDATION_MARKETS.flatMap((market, marketIndex) =>
  ["fanduel", "pinnacle", "bet365"].flatMap((sportsbook, bookIndex) => {
    const line = [24.5, 7.5, 6.5, 2.5, 38.5, 31.5, 31.5, 14.5][marketIndex]!;
    const observedAt = "2026-10-21T12:00:00.000Z";
    return ["over", "under"].map((side, sideIndex): NbaPlayerPropPriceObservation => ({
      release: NBA_PLAYER_PROPS_OBSERVATION_RELEASE,
      provider: "balldontlie",
      providerObservationId: `${market}-${sportsbook}-${side}`,
      providerEventId: "99",
      canonicalGameId: "nba-bdl:99",
      canonicalPlayerId: "nba-bdl-player:10",
      providerPlayerId: "10",
      playerName: "Test Player",
      playerTeam: "1",
      sportsbook,
      market,
      providerMarket: market,
      offerType: "over_under",
      side: side as "over" | "under",
      line,
      americanPrice: sideIndex === 0 ? -108 - bookIndex : -112 + bookIndex,
      observedAt,
      fetchedAt: observedAt,
      isOpening: false,
      isLive: false,
      homeTeam: "AAA",
      awayTeam: "BBB",
      scheduledStart: upcoming.startTime,
    }));
  }));
const first = buildNbaPlayerPropsForwardDecisions({ features, observations });
const second = buildNbaPlayerPropsForwardDecisions({ features, observations });
assert.deepEqual(first, second, "frozen runtime scoring must be deterministic");
assert.equal(first.length, NBA_PLAYER_PROPS_FOUNDATION_MARKETS.length);
for (const decision of first) {
  assert.equal(decision.publicEnabled, false);
  assert.equal(decision.side, decision.finalProjection > decision.line ? "over" : "under");
  assert(decision.targetExcludedBooks >= 1);
  assert(decision.targetExcludedReferenceBooks >= 1);
  assert(decision.probability >= 0 && decision.probability <= 1);
}

const chronological = [
  ...observations.filter((row) => row.market === "points").map((row) => ({
    ...row,
    providerObservationId: `opening-${row.providerObservationId}`,
    line: 23.5,
    observedAt: "2026-10-21T10:00:00.000Z",
    isOpening: true,
  })),
  ...observations.filter((row) => row.market === "points").map((row) => ({
    ...row,
    providerObservationId: `current-${row.providerObservationId}`,
    line: 24.5,
    observedAt: "2026-10-21T12:00:00.000Z",
    isOpening: false,
  })),
];
const currentOffer = selectNbaPlayerPropsCurrentCanonicalOfferSets(chronological)[0]!;
assert.equal(currentOffer.canonicalLine, 24.5, "current selector must not let an older main line outvote the latest books");
const target = currentOffer.observations.find((row) => row.sportsbook === "fanduel" && row.side === "over")!;
const chronologicalEvidence = buildNbaPlayerPropsMarketEvidence({ target, observations: chronological, evaluatedAt: target.observedAt });
assert.equal(chronologicalEvidence.openingLine, 23.5);
assert.equal(chronologicalEvidence.currentLine, 24.5);
assert.equal(chronologicalEvidence.targetExcludedBooks, 2, "each target-excluded sportsbook counts only its latest complete pair");

const initialHistory = mergeNbaPlayerPropsMarketHistory({
  previous: null,
  current: observations,
  slateDate: "2026-10-21",
  capturedAt: "2026-10-21T15:00:00.000Z",
});
assert.equal(initialHistory.added, observations.length);
const nextQuote = { ...observations[0]!, observedAt: "2026-10-21T12:30:00.000Z", americanPrice: -120 };
const nextHistory = mergeNbaPlayerPropsMarketHistory({
  previous: initialHistory.history,
  current: [nextQuote],
  slateDate: "2026-10-21",
  capturedAt: "2026-10-21T15:30:00.000Z",
});
assert.equal(nextHistory.added, 1, "the same provider offer at a new timestamp must append to movement history");
const conflict = mergeNbaPlayerPropsMarketHistory({
  previous: nextHistory.history,
  current: [{ ...nextQuote, americanPrice: -999 }],
  slateDate: "2026-10-21",
  capturedAt: "2026-10-21T16:00:00.000Z",
});
assert.equal(conflict.conflicts, 1);
assert.equal(
  conflict.history.observations.find((row) => row.providerObservationId === observations[0]!.providerObservationId)?.americanPrice,
  observations[0]!.americanPrice,
);
assert.equal(
  conflict.history.observations.find((row) => row.providerObservationId === nextQuote.providerObservationId
    && row.observedAt === nextQuote.observedAt)?.americanPrice,
  nextQuote.americanPrice,
);
const envelope = encodeNbaPlayerPropsPrivatePayload(initialHistory.history, "market_history");
assert.deepEqual(decodeNbaPlayerPropsPrivatePayload(envelope, "market_history"), initialHistory.history);
assert.equal(decodeNbaPlayerPropsPrivatePayload({ ...envelope, checksum: "bad" }, "market_history"), null);

const state = mergeNbaPlayerPropsCurrentState({
  previous: null,
  season: 2025,
  capturedAt: "2026-04-20T00:00:00.000Z",
  games,
  boxes,
  advanced: [],
});
assert.equal(state.state.release, NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE);
assert.throws(() => mergeNbaPlayerPropsCurrentState({
  previous: state.state,
  season: 2025,
  capturedAt: "2026-04-21T00:00:00.000Z",
  games: [{ ...games[0]!, homeScore: 999 }],
  boxes: [],
  advanced: [],
}), /refuses to mutate stored game/);
const correctedState = mergeNbaPlayerPropsCurrentState({
  previous: state.state,
  season: 2025,
  capturedAt: "2026-04-21T00:00:00.000Z",
  games: [{ ...games[0]!, homeScore: 999 }],
  boxes: [], advanced: [],
  allowOfficialCorrections: true,
});
assert.equal(correctedState.corrected, 1);
assert.equal(correctedState.state.games.find((row) => row.gameId === games[0]!.gameId)?.homeScore, 999);

const route = readFileSync(path.join(process.cwd(), "app/api/cron/nba-daily-refresh/route.ts"), "utf8");
assert.match(route, /refreshNbaPlayerPropsPrivateCandidate/);
assert.match(route, /NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED/);
assert.match(route, /leaseGroup: "prediction_pipeline"/);
assert(!route.includes("setInterval("));

process.stdout.write("NBA player-props production-readiness contracts passed.\n");

function box(
  gameId: number, rowId: number, teamId: number, playerId: number, minutes: number, points: number,
): NbaHistoricalPlayerBox {
  return {
    gameId, rowId, teamId, playerId, minutes, points,
    fgm: 8, fga: 16, fg3m: 2, fg3a: 6, ftm: 4, fta: 5,
    oreb: 1, dreb: 6, ast: 7, stl: 1, blk: 1, turnover: 2, pf: 2, plusMinus: 4,
  };
}
