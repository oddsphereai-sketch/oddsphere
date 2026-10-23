import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildNbaPlayerPropsForwardDecisions,
  buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit,
  nbaPlayerPropsFrozenRuntimeArtifact,
} from "../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import { nbaPlayerPropsArtifactSha256 } from "../lib/services/nba/nbaPlayerPropsArtifactChecksum";
import {
  mergeNbaPlayerPropsCurrentState,
  NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,
} from "../lib/services/nba/nbaPlayerPropsCurrentState";
import { nbaPlayerPropsSlateDate } from "../lib/services/nba/nbaPlayerPropsLifecycle";
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
const frozenRuntimeSource = readFileSync(
  path.join(process.cwd(), "lib/services/nba/nbaPlayerPropsFrozenRuntime.ts"),
  "utf8",
);
assert.equal(artifact.publicEnabled, false);
assert.equal(artifact.release, "nba_player_props_frozen_runtime_artifact_2026_10_23_r7_rebound_family_market_reader");
assert.equal(
  artifact.sourceGradeRelease,
  "nba_player_props_exact_price_grade_2026_10_22_r13_rebound_recalibration_private_only",
);
assert.equal(artifact.gradePolicies.rebounds.kind, "slate_relative_lean");
assert.equal(artifact.gradePolicies.rebounds.policy.signalFamily, "model_market_conservative_expected_value");
assert.equal(artifact.gradePolicies.rebounds.policy.eligibilityGate, "established_role");
assert.equal(artifact.gradePolicies.rebounds.policy.maxPerSlate, 1);
assert.equal(artifact.gradePolicies.rebounds.policy.requireReferenceBook, true);
assert.equal(artifact.selectedByMarket.rebounds, "robust_component_counts");
assert.equal(artifact.exactPriceArbitrationMinimumDistance.rebounds, 0.04);
assert.equal(artifact.exactPriceArbitrationMinimumDistance.rebounds_assists, 0.04);
assert.equal(artifact.exactPriceArbitrationMinimumDistance.points_rebounds_assists, 0.04);
assert.equal(artifact.exactPriceArbitrationMovementPolicy.rebounds, "not_opposed");
assert.equal(artifact.exactPriceArbitrationMovementPolicy.rebounds_assists, "not_opposed");
assert.equal(artifact.exactPriceArbitrationMovementPolicy.points_rebounds_assists, "not_opposed");
assert.match(
  frozenRuntimeSource,
  /readFileSync\(artifactPath, "utf8"\)/,
  "production scoring must verify the exact traced artifact bytes instead of a bundler-rewritten JSON object",
);
assert.doesNotMatch(
  frozenRuntimeSource,
  /import frozenArtifactJson/,
  "the frozen runtime must not import the large numeric JSON artifact through the server bundler",
);
assert(artifact.robustMinuteModel, "robust rebound release requires its rotation-aware minute model");
assert(artifact.robustModels?.rebounds, "robust rebound release requires a frozen rebound component");
assert.equal(artifact.gradePolicies.points_rebounds.kind, "slate_relative_lean");
assert.equal(
  nbaPlayerPropsSlateDate(new Date("2026-10-22T03:59:59.000Z")),
  "2026-10-21",
  "the current NBA props slate remains present through 11:59:59 p.m. Eastern",
);
assert.equal(
  nbaPlayerPropsSlateDate(new Date("2026-10-22T04:00:00.000Z")),
  "2026-10-22",
  "the NBA props slate rolls at midnight Eastern instead of waiting for game completion",
);
assert.equal(
  nbaPlayerPropsSlateDate(new Date("2026-11-02T05:00:00.000Z")),
  "2026-11-02",
  "the midnight Eastern boundary remains DST-safe",
);
assert.equal(artifact.gradePolicies.points_rebounds.policy.maxPerSlate, 1);
assert.equal(artifact.gradePolicies.points_rebounds.policy.signalFamily, "target_price_probability");
assert.equal(
  nbaPlayerPropsArtifactSha256({ beta: 2, alpha: { delta: [3, 4], gamma: 1 } }),
  nbaPlayerPropsArtifactSha256({ alpha: { gamma: 1, delta: [3, 4] }, beta: 2 }),
  "artifact checksums must remain stable when a server bundler reorders object keys",
);
assert.notEqual(
  nbaPlayerPropsArtifactSha256({ alpha: 1.0000000000000002 }),
  nbaPlayerPropsArtifactSha256({ alpha: 1 }),
  "artifact checksums must retain exact finite-number identity",
);
assert.equal(
  nbaPlayerPropsArtifactSha256({ alpha: -0 }),
  nbaPlayerPropsArtifactSha256({ alpha: 0 }),
  "artifact checksums must follow ordinary JSON negative-zero semantics",
);
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
      americanPrice: market === "rebounds"
        ? (sportsbook === "bet365" ? (sideIndex === 0 ? -105 : -115) : (sideIndex === 0 ? 130 : -160))
        : (sideIndex === 0 ? -108 - bookIndex : -112 + bookIndex),
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
  assert(decision.independentProjection > 0, "offered standard props require a positive independent forecast");
  assert(decision.finalProjection > 0, "market arbitration may not manufacture a zero forecast");
  assert(decision.targetExcludedBooks >= 1);
  assert(decision.targetExcludedReferenceBooks >= 1);
  assert(decision.probability >= 0 && decision.probability <= 1);
}
const calibratedRebound = first.find((decision) => decision.market === "rebounds");
assert.equal(calibratedRebound?.calibrationRelease, artifact.sourceGradeRelease);
assert.equal(
  calibratedRebound?.grade,
  "Lean",
  "the approved established-role/reference-book rebound selector must activate on a coherent forward slate",
);

const underMarket = observations.filter((row) => row.market === "points").map((row) => ({
  ...row,
  line: 0.5,
  americanPrice: row.side === "over" ? 150 : -200,
}));
const coherentUnder = buildNbaPlayerPropsForwardDecisions({ features, observations: underMarket });
assert.equal(coherentUnder.length, 1);
assert.equal(coherentUnder[0]?.side, "under");
assert.equal(coherentUnder[0]?.finalProjection, 0.45,
  "a market disagreement may not reflect a positive counting forecast through zero");

const reboundStressFeature = [{
  ...features[0]!,
  rebounds_per_minute_10: 10,
  rebounds_per_minute_20: 10,
  rebounds_per_minute_season: 10,
}];
const reboundMarket = observations.filter((row) => row.market === "rebounds");
const robustFallback = buildNbaPlayerPropsForwardDecisions({
  features: reboundStressFeature,
  observations: reboundMarket,
});
assert.equal(robustFallback.length, 1);
assert((robustFallback[0]?.independentProjection ?? 0) > 0,
  "an out-of-domain robust clamp must fall back to the positive frozen ridge forecast");

const independentReboundSide = calibratedRebound!.independentSide;
const marketReboundSide = independentReboundSide === "over" ? "under" : "over";
const reboundMovementRows = ["fanduel", "pinnacle", "bet365"].flatMap((sportsbook) =>
  [
    { observedAt: "2026-10-21T10:00:00.000Z", opening: true },
    { observedAt: "2026-10-21T12:00:00.000Z", opening: false },
  ].flatMap(({ observedAt, opening }) => ["over", "under"].map((side): NbaPlayerPropPriceObservation => {
    const marketOver = marketReboundSide === "over";
    const overPrice = opening ? (marketOver ? -220 : 170) : (marketOver ? -150 : 125);
    const underPrice = opening ? (marketOver ? 170 : -220) : (marketOver ? 125 : -150);
    return {
      ...reboundMarket.find((row) => row.sportsbook === sportsbook && row.side === side)!,
      providerObservationId: `${sportsbook}-${side}-${observedAt}`,
      americanPrice: side === "over" ? overPrice : underPrice,
      observedAt,
      fetchedAt: observedAt,
      isOpening: opening,
    };
  })));
const unrestrictedArtifact = {
  ...artifact,
  exactPriceArbitrationMovementPolicy: {
    ...artifact.exactPriceArbitrationMovementPolicy,
    rebounds: "none" as const,
  },
};
const unrestrictedRebound = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
  artifact: unrestrictedArtifact,
  features,
  observations: reboundMovementRows,
  evaluatedAt: "2026-10-21T12:00:00.000Z",
})[0]!;
const guardedRebound = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
  artifact,
  features,
  observations: reboundMovementRows,
  evaluatedAt: "2026-10-21T12:00:00.000Z",
})[0]!;
assert.equal(unrestrictedRebound.side, marketReboundSide,
  "a qualified target-excluded disagreement would flip without the movement guard");
assert.equal(guardedRebound.side, independentReboundSide,
  "same-book movement opposing a proposed rebound-family flip must preserve the independent side");

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
const refreshedQuote = { ...observations[0]!, observedAt: "2026-10-21T12:30:00.000Z", fetchedAt: "2026-10-21T12:30:01.000Z" };
const refreshedHistory = mergeNbaPlayerPropsMarketHistory({
  previous: initialHistory.history,
  current: [refreshedQuote],
  slateDate: "2026-10-21",
  capturedAt: "2026-10-21T15:30:00.000Z",
});
assert.equal(refreshedHistory.added, 0, "an unchanged quote heartbeat is not a new market state");
assert.equal(refreshedHistory.refreshed, 1, "an unchanged quote heartbeat must refresh current evidence");
assert.equal(refreshedHistory.history.observations.length, initialHistory.history.observations.length + 1,
  "the first quote and newest heartbeat are retained without unbounded duplicate polling rows");
const nextQuote = { ...refreshedQuote, observedAt: "2026-10-21T13:00:00.000Z", americanPrice: -120 };
const nextHistory = mergeNbaPlayerPropsMarketHistory({
  previous: refreshedHistory.history,
  current: [nextQuote],
  slateDate: "2026-10-21",
  capturedAt: "2026-10-21T16:00:00.000Z",
});
assert.equal(nextHistory.added, 1, "a genuine same-line price change must append to movement history");
const conflict = mergeNbaPlayerPropsMarketHistory({
  previous: nextHistory.history,
  current: [{ ...nextQuote, americanPrice: -999 }],
  slateDate: "2026-10-21",
  capturedAt: "2026-10-21T16:30:00.000Z",
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
assert.deepEqual(decodeNbaPlayerPropsPrivatePayload({
  ...envelope,
  release: "nba_player_props_private_store_2026_10_21_r3_chronological_observation_identity",
}, "market_history"), initialHistory.history, "the deployed r3 private payload must migrate without losing observations");
assert.equal(decodeNbaPlayerPropsPrivatePayload({ ...envelope, checksum: "bad" }, "market_history"), null);

let boundedHistory = initialHistory.history;
for (let index = 1; index <= 8; index += 1) {
  boundedHistory = mergeNbaPlayerPropsMarketHistory({
    previous: boundedHistory,
    current: [{
      ...observations[0]!,
      observedAt: new Date(Date.parse(observations[0]!.observedAt) + index * 60_000).toISOString(),
      americanPrice: observations[0]!.americanPrice - index,
    }],
    slateDate: "2026-10-21",
    capturedAt: new Date(Date.parse("2026-10-21T15:00:00.000Z") + index * 60_000).toISOString(),
  }).history;
}
assert.equal(
  boundedHistory.observations.filter((row) => row.providerObservationId === observations[0]!.providerObservationId).length,
  3,
  "market storage retains the first, prior, and current distinct quote states",
);

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
assert.match(route, /nbaPlayerPropsSlateDate\(now\)/);
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
