import assert from "node:assert/strict";

import {
  buildMarketBrainCase,
  numericFeature,
  type MarketBrainObservation,
} from "../lib/services/marketBrain/marketBrainContract";
import { materializeNflMarketBrainSequence } from "../lib/services/marketBrain/nflMarketBrainSequenceMaterializer";

const cutoffAt = "2026-10-26T20:00:00.000Z";
const eventId = "nfl-sequence-fixture";

function quote(args: {
  participant: string;
  selection: "away" | "home";
  market?: "moneyline" | "spread";
  line: number | null;
  price: number | null;
  observedAt: string;
  availableAt?: string;
  relation?: MarketBrainObservation["targetRelation"];
  availability?: MarketBrainObservation["availability"];
}): MarketBrainObservation {
  const market = args.market ?? "spread";
  const sourceObservationId = [market, args.participant, args.selection, args.observedAt, args.line, args.price].join(":");
  return {
    id: `quote:${sourceObservationId}`,
    eventId,
    sport: "nfl",
    market,
    modality: "price_quote",
    source: { provider: args.participant === "circa" ? "sharpapi" : "balldontlie", feed: "fixture", participant: args.participant },
    sourcePrior: args.participant === "circa" ? "professional_book" : "retail_book",
    observedRole: "unknown",
    observedAt: args.observedAt,
    timing: {
      providerObservedAt: args.observedAt,
      providerFetchedAt: args.availableAt ?? args.observedAt,
      ingestedAt: args.availableAt ?? args.observedAt,
      availableAt: args.availableAt ?? args.observedAt,
    },
    availability: args.availability ?? "observed",
    targetRelation: args.relation ?? "target_excluded",
    values: { line: numericFeature(args.line), price: numericFeature(args.price) },
    categorical: { selection: args.selection, phase: args.observedAt.endsWith("00:00.000Z") ? "provider_opening" : "current" },
    audit: { sourceRelease: "fixture", sourceObservationId, notes: [] },
  };
}

function moneylinePair(participant: string, observedAt: string, awayPrice: number, homePrice: number): MarketBrainObservation[] {
  return [
    quote({ market: "moneyline", participant, selection: "away", line: null, price: awayPrice, observedAt }),
    quote({ market: "moneyline", participant, selection: "home", line: null, price: homePrice, observedAt }),
  ];
}

function pair(participant: string, observedAt: string, homeLine: number, awayPrice: number, homePrice: number,
  relation: MarketBrainObservation["targetRelation"] = "target_excluded"): MarketBrainObservation[] {
  return [
    quote({ participant, selection: "away", line: -homeLine, price: awayPrice, observedAt,
      relation: relation === "evaluated" ? "same_family_as_evaluated" : relation }),
    quote({ participant, selection: "home", line: homeLine, price: homePrice, observedAt, relation }),
  ];
}

const observations = [
  ...pair("draftkings", "2026-10-26T19:00:00.000Z", -3, -110, -110, "same_family_as_evaluated"),
  ...pair("draftkings", "2026-10-26T19:50:00.000Z", -3.5, -110, -110, "evaluated"),
  ...pair("fanduel", "2026-10-26T19:00:00.000Z", -3, -110, -110),
  ...pair("fanduel", "2026-10-26T19:20:00.000Z", -2.75, -111, -109),
  ...pair("circa", "2026-10-26T19:00:00.000Z", -3, -110, -110),
  ...pair("circa", "2026-10-26T19:40:00.000Z", -2.75, -111, -109),
  ...moneylinePair("fanduel", "2026-10-26T19:00:00.000Z", -110, -110),
  ...moneylinePair("fanduel", "2026-10-26T19:10:00.000Z", -111, -109),
  ...moneylinePair("circa", "2026-10-26T19:00:00.000Z", -110, -110),
  ...moneylinePair("circa", "2026-10-26T19:30:00.000Z", -111, -109),
  quote({ participant: "betmgm", selection: "away", line: 3, price: null,
    observedAt: "2026-10-26T19:30:00.000Z", availability: "incomplete" }),
  quote({ participant: "circa", selection: "away", line: 3.5, price: -112,
    observedAt: "2026-10-26T19:55:00.000Z", availableAt: "2026-10-26T20:05:00.000Z" }),
  quote({ participant: "circa", selection: "home", line: -3.5, price: -108,
    observedAt: "2026-10-26T19:55:00.000Z", availableAt: "2026-10-26T20:05:00.000Z" }),
];
const marketCase = buildMarketBrainCase({
  sport: "nfl",
  eventId,
  evaluatedAt: cutoffAt,
  captureBoundary: "raw_provider_response",
  captureLimitations: [],
  subject: { kind: "two_team_game", awayId: "NE", homeId: "SEA", startsAt: "2026-10-26T21:00:00.000Z" },
  prior: { kind: "unavailable", release: "fixture", reason: "fixture" },
  evaluatedTargets: {
    spread: {
      identity: "draftkings-spread-target",
      family: "draftkings",
      selection: "home",
      line: -3.5,
      price: -110,
      observedAt: "2026-10-26T19:50:00.000Z",
    },
  },
  observations,
  sourceManifests: [{
    id: "source:fixture",
    provider: "fixture",
    feed: "fixture",
    participant: null,
    providerFetchedAt: cutoffAt,
    rawResponseSha256: "a".repeat(64),
    returnedRows: 1,
    matchedRows: 1,
    unmatchedRows: 0,
    ambiguousRows: 0,
    rows: [{
      rowIndex: 0,
      rawRowSha256: "b".repeat(64),
      disposition: "matched",
      providerGameId: eventId,
      retainedObservationIds: observations.map((row) => row.id),
    }],
    retainedObservationIds: observations.map((row) => row.id),
    status: "observed",
    failureReason: null,
  }],
  expectedInputs: [],
  blindSpots: [],
});

const materialized = materializeNflMarketBrainSequence({ cases: [marketCase], cutoffAt });
assert.equal(materialized.targetFamilyByMarket.spread, "draftkings");
assert.equal(materialized.accounting.targetExcluded, 4,
  "the exact target and every other observation from its family must be excluded before features");
assert.equal(materialized.accounting.afterCutoff, 2, "provider rows unavailable by cutoff must not enter features");
assert.equal(materialized.accounting.unavailableOrUnsupported, 1, "missing data must stay explicit rather than becoming zero");
assert.equal(materialized.quotePaths.some((path) => path.participant === "draftkings"), false);
assert.equal(materialized.quotePaths.some((path) => path.participant === "betmgm"), false);

const fanduel = materialized.quotePaths.find((path) => path.participant === "fanduel" && path.market === "spread");
const circa = materialized.quotePaths.find((path) => path.participant === "circa" && path.market === "spread");
assert.ok(fanduel && circa);
assert.equal(fanduel.observedRole, "leader", "chronology, not book reputation, must determine leadership");
assert.equal(circa.observedRole, "follower", "a professional book that moves second must remain a follower");
assert.equal(fanduel.lineDelta, 0.25, "sub-half-point movement must survive without a threshold gate");
assert.notEqual(fanduel.firstFairProbabilityDelta, 0, "small price movement must remain continuous evidence");
assert.equal(circa.points.length, 2, "future-available quote pair must be removed before sequence features");
assert.equal(materialized.crossMarket.sideRelationship, "aligned",
  "Moneyline and Spread must be coordinated in one orientation instead of interpreted in isolation");
assert.equal(materialized.crossMarket.sideLeader, "moneyline");
assert.equal(materialized.crossMarket.sideLeadLagMinutes, 10);
assert.equal(materialized.invariants.productionInfluenceAllowed, false);
assert.equal(materialized.checksum.length, 64);

const targetIdentityWithoutExactMatch = structuredClone(marketCase);
for (const observation of targetIdentityWithoutExactMatch.observations) {
  if (observation.targetRelation === "evaluated") observation.targetRelation = "unknown";
}
const withoutExactMatch = materializeNflMarketBrainSequence({ cases: [targetIdentityWithoutExactMatch], cutoffAt });
assert.equal(withoutExactMatch.quotePaths.some((path) => path.participant === "draftkings"), false,
  "the explicit evaluated-target manifest must exclude its whole family even when an exact raw side cannot be matched");

const conflicting = structuredClone(marketCase);
conflicting.observations[0]!.values.price = numericFeature(-120);
assert.throws(
  () => materializeNflMarketBrainSequence({ cases: [marketCase, conflicting], cutoffAt }),
  /Conflicting Market Brain observation identity/,
  "immutable observation identities must fail closed when economics conflict",
);

console.log("NFL Market Brain materializer: cutoff, target-family exclusion, continuous movement, chronological roles, cross-market coordination, missingness, and immutable dedup passed");
