import assert from "node:assert/strict";
import {
  americanImpliedProbability,
  buildNflPlayerPropsExactBoard,
  materiallyChangedNflPropsOffer,
} from "../lib/services/football/nflPlayerPropsMarketBoard";
import {
  NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,
  NFL_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE,
  NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE,
  type NflPlayerPropPriceObservation,
  type NflPlayerPropsObservationSnapshot,
} from "../lib/services/football/nflPlayerPropsContract";

const base: NflPlayerPropPriceObservation = {
  provider: "balldontlie",
  providerObservationId: "one:over",
  providerEventId: "game-1",
  canonicalGameId: "game-1",
  providerPlayerId: "player-1",
  playerName: "Test Receiver",
  playerTeam: "SEA",
  sportsbook: "fanduel",
  market: "receiving_yards",
  providerMarket: "receiving_yards",
  offerType: "over_under",
  side: "over",
  line: 60.5,
  americanPrice: -110,
  observedAt: "2026-09-09T12:00:00Z",
  fetchedAt: "2026-09-09T12:00:05Z",
  isOpening: false,
  isLive: false,
  homeTeam: null,
  awayTeam: null,
  scheduledStart: null,
};
const observations: NflPlayerPropPriceObservation[] = [
  { ...base, providerObservationId: "open:over", observedAt: "2026-09-08T12:00:00Z", isOpening: true, americanPrice: -105 },
  { ...base, providerObservationId: "open:under", observedAt: "2026-09-08T12:00:00Z", isOpening: true, side: "under", americanPrice: -115 },
  base,
  { ...base, providerObservationId: "one:under", side: "under", americanPrice: -110 },
];
const snapshot: NflPlayerPropsObservationSnapshot = {
  schemaRelease: NFL_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE,
  snapshotRelease: NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,
  shadowModelRelease: NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE,
  calibrationRelease: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
  mode: "local_observe_only",
  actionable: false,
  generatedAt: "2026-09-09T12:00:06Z",
  fetchedAt: "2026-09-09T12:00:05Z",
  season: 2026,
  week: 1,
  phase: "regular",
  games: [{ season: 2026, week: 1, phase: "regular", providerGameId: "game-1", scheduledStart: "2026-09-10T00:20:00Z", homeTeam: "SEA", awayTeam: "NE", homeTeamName: "Seattle Seahawks", awayTeamName: "New England Patriots" }],
  observations,
  providerCoverage: {},
  providerRequests: { balldontlie: 1 },
  collectionComplete: true,
  modelingReady: false,
  healthFindings: [],
};

const [offer] = buildNflPlayerPropsExactBoard({ snapshots: [snapshot], evaluatedAt: "2026-09-09T13:00:00Z" });
assert.ok(offer);
assert.equal(offer.state, "unlocked");
assert.equal(offer.exactPriceComplete, true);
assert.equal(offer.gradeEligibleMarket, true);
assert.equal(offer.openingOverPrice, -105);
assert.equal(offer.overNoVigProbability, 0.5);
assert.equal(offer.lockAt, "2026-09-09T23:20:00.000Z");
assert.ok(Math.abs(americanImpliedProbability(150) - 0.4) < 1e-12);

const locked = buildNflPlayerPropsExactBoard({ snapshots: [snapshot], evaluatedAt: "2026-09-10T00:00:00Z" })[0]!;
assert.equal(locked.state, "locked");
assert.equal(locked.observedAt, offer.observedAt, "lock freezes the latest authorized observation");
assert.equal(materiallyChangedNflPropsOffer({ previous: offer, current: { ...offer, overPrice: -115 }, previousRoleFingerprint: "role-1", currentRoleFingerprint: "role-1" }), true);
assert.equal(materiallyChangedNflPropsOffer({ previous: offer, current: offer, previousRoleFingerprint: "role-1", currentRoleFingerprint: "role-2" }), true);
assert.equal(materiallyChangedNflPropsOffer({ previous: offer, current: offer, previousRoleFingerprint: "role-1", currentRoleFingerprint: "role-1" }), false);

console.log("NFL player-props exact market board: pairing, no-vig, material-change, and lock checks passed");
