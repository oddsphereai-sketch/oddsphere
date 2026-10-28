import assert from "node:assert/strict";
import {
  NBA_PLAYER_PROPS_OBSERVATION_RELEASE,
  type NbaPlayerPropPriceObservation,
} from "../lib/services/nba/nbaPlayerPropsContract";
import {
  buildNbaPlayerPropsSameBookMovement,
  selectNbaPlayerPropsMovementTarget,
} from "../lib/services/nba/nbaPlayerPropsMovement";

function observation(overrides: Partial<NbaPlayerPropPriceObservation> = {}): NbaPlayerPropPriceObservation {
  return {
    release: NBA_PLAYER_PROPS_OBSERVATION_RELEASE,
    provider: "balldontlie",
    providerObservationId: "quote",
    providerEventId: "game-1",
    canonicalGameId: "nba-bdl:game-1",
    canonicalPlayerId: "nba-bdl-player:10",
    providerPlayerId: "10",
    playerName: "Test Player",
    playerTeam: "1",
    sportsbook: "fanduel",
    market: "rebounds",
    providerMarket: "rebounds",
    offerType: "over_under",
    side: "over",
    line: 7.5,
    americanPrice: -110,
    observedAt: "2026-10-28T12:00:00.000Z",
    fetchedAt: "2026-10-28T12:00:01.000Z",
    isOpening: false,
    isLive: false,
    homeTeam: "AAA",
    awayTeam: "BBB",
    scheduledStart: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

function pair(overrides: Partial<NbaPlayerPropPriceObservation>): NbaPlayerPropPriceObservation[] {
  const over = observation({ ...overrides, side: "over" });
  return [over, { ...over, providerObservationId: `${over.providerObservationId}-under`, side: "under", americanPrice: -110 }];
}

const officialOpening = pair({
  providerObservationId: "opening",
  line: 7.5,
  observedAt: "2026-10-28T10:00:00.000Z",
  isOpening: true,
});
const prior = pair({
  providerObservationId: "prior",
  line: 8.5,
  americanPrice: -105,
  observedAt: "2026-10-28T11:00:00.000Z",
});
const target = observation({
  providerObservationId: "target",
  line: 8.5,
  americanPrice: -125,
  observedAt: "2026-10-28T12:00:00.000Z",
});
const ordinaryMovement = buildNbaPlayerPropsSameBookMovement({
  observations: [...officialOpening, ...prior, ...pair({ ...target })],
  target,
});
assert.deepEqual(ordinaryMovement, {
  sportsbook: "fanduel",
  openingLine: 7.5,
  priorLine: 8.5,
  currentLine: 8.5,
  openingPrice: -110,
  priorPrice: -105,
  currentPrice: -125,
}, "a unique paired main-line trail retains line and price movement and ends at the evaluated quote");

const owlTarget = observation({
  provider: "owls",
  sportsbook: "betmgm",
  providerObservationId: "owl-target",
  line: 2.5,
  americanPrice: -125,
  observedAt: "2026-10-28T12:00:00.000Z",
});
const ambiguousAlternates = [
  ...pair({
    provider: "owls",
    sportsbook: "betmgm",
    providerObservationId: "owl-alt-a",
    line: 8.5,
    observedAt: "2026-10-28T11:00:00.000Z",
  }),
  ...pair({
    provider: "owls",
    sportsbook: "betmgm",
    providerObservationId: "owl-alt-b",
    line: 9.5,
    observedAt: "2026-10-28T11:00:00.000Z",
  }),
];
const alternateSafe = buildNbaPlayerPropsSameBookMovement({
  observations: [
    ...pair({
      provider: "owls",
      sportsbook: "betmgm",
      providerObservationId: "owl-open",
      line: 2.5,
      observedAt: "2026-10-28T10:00:00.000Z",
      isOpening: true,
    }),
    ...ambiguousAlternates,
    ...pair({ ...owlTarget }),
  ],
  target: owlTarget,
});
assert.equal(alternateSafe?.openingLine, 2.5);
assert.equal(alternateSafe?.priorLine, 2.5,
  "the genuine exact-line opening remains the prior state");
assert.notEqual(alternateSafe?.priorLine, 8.5);
assert.notEqual(alternateSafe?.priorLine, 9.5,
  "multiple simultaneous alternate ladders cannot masquerade as prior main-line movement");
assert.equal(alternateSafe?.currentLine, owlTarget.line);
assert.equal(alternateSafe?.currentPrice, owlTarget.americanPrice,
  "the displayed current quote must equal the exact evaluated member quote");

const foreignProvider = pair({
  provider: "owls",
  sportsbook: "fanduel",
  providerObservationId: "foreign",
  line: 99.5,
  americanPrice: -999,
  observedAt: "2026-10-28T11:30:00.000Z",
});
const providerSafe = buildNbaPlayerPropsSameBookMovement({
  observations: [...officialOpening, ...foreignProvider, ...pair({ ...target })],
  target,
});
assert.notEqual(providerSafe?.priorLine, 99.5, "a different provider cannot be stitched into the same-book trail");
assert.equal(providerSafe?.currentLine, target.line);
assert.equal(providerSafe?.currentPrice, target.americanPrice);

const exactEvaluatedTarget = selectNbaPlayerPropsMovementTarget({
  observations: [
    target,
    { ...target, provider: "owls", observedAt: "2026-10-28T12:01:00.000Z", americanPrice: -130 },
  ],
  sportsbook: target.sportsbook,
  side: target.side as "over" | "under",
  line: target.line,
  americanPrice: target.americanPrice,
});
assert.equal(exactEvaluatedTarget?.provider, "balldontlie");
assert.equal(exactEvaluatedTarget?.americanPrice, -125,
  "a fresher different-provider price cannot replace the exact price evaluated by the model");

console.log("NBA player-prop movement integrity: exact endpoint, unique line changes, alternate-ladder rejection, and provider separation passed.");
