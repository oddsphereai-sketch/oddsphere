import assert from "node:assert/strict";

import {
  NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE,
  NFL_EXACT_PROVIDER_SCORE_ARTIFACT_SHA256,
  NFL_EXACT_PROVIDER_SCORE_CONTEXT_RELEASE,
  NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE,
} from "../lib/services/football/nflExactProviderScoreRuntime";
import { NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE } from
  "../lib/services/football/nflPlayerPropsCurrentSeasonState";
import {
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_SHA256,
} from "../lib/services/football/nflV1WeekOneOutcome";

import {
  bindMarketBrainMarginTotalPrior,
  bindMarketBrainPriorInputLineage,
  buildMarketBrainCase,
  assertMarketBrainCase,
  numericFeature,
  type MarketBrainObservation,
} from "../lib/services/marketBrain/marketBrainContract";
import { marketBrainSha256 } from "../lib/services/marketBrain/marketBrainCanonical";
import { assertNflMarketBrainPriorInputLineageQualified } from
  "../lib/services/marketBrain/nflMarketBrainPriorLineage";
import {
  buildNflMarketBrainResolverFeatures,
  nflMarketBrainTrainerInput,
  vectorizeNflMarketBrainTrainerInput,
} from "../lib/services/marketBrain/nflMarketBrainResolverFeatures";
import { materializeNflMarketBrainSequence } from "../lib/services/marketBrain/nflMarketBrainSequenceMaterializer";
import { buildNflMarketBrainCaseAudit } from
  "../lib/services/marketBrain/nflMarketBrainCaseAudit";
import { NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE, fixtureMarketBrainPriorInputLineage } from
  "./fixtures/marketBrainPriorInputLineage";

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
  providerEventId?: string;
}): MarketBrainObservation {
  const market = args.market ?? "spread";
  const sourceObservationId = [market, args.participant, args.selection, args.observedAt, args.line, args.price].join(":");
  return {
    id: `quote:${sourceObservationId}`,
    eventId,
    sport: "nfl",
    market,
    modality: "price_quote",
    source: { provider: "fixture", feed: "fixture", participant: args.participant },
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
    categorical: {
      selection: args.selection,
      phase: args.observedAt.endsWith("00:00.000Z") ? "provider_opening" : "current",
      providerEventId: args.providerEventId ?? "sensitive-provider-event-id",
      rawRowSha256: "f".repeat(64),
      playerName: "Sensitive Fixture Player",
      detail: "free-text fixture detail",
    },
    audit: { sourceRelease: "fixture-source-manifest-r1", sourceObservationId, notes: [] },
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

function identifiedSplit(participant: string, suffix: string): MarketBrainObservation {
  return {
    id: `split:${participant}:${suffix}`,
    eventId,
    sport: "nfl",
    market: "spread",
    modality: "identified_book_split",
    source: { provider: "fixture", feed: "fixture", participant },
    sourcePrior: participant === "circa" ? "professional_book" : "retail_book",
    observedRole: "unknown",
    observedAt: null,
    timing: {
      providerObservedAt: null,
      providerFetchedAt: "2026-10-26T19:45:00.000Z",
      ingestedAt: "2026-10-26T19:45:00.000Z",
      availableAt: "2026-10-26T19:45:00.000Z",
    },
    availability: "observed",
    targetRelation: "unknown",
    values: {
      first_money_pct: numericFeature(54),
      first_bets_pct: numericFeature(47),
      first_money_minus_bets_pp: numericFeature(7),
    },
    categorical: { denominatorKnown: false, exactLineMatched: null },
    audit: { sourceRelease: "fixture-source-manifest-r1", sourceObservationId: `split:${participant}:${suffix}`, notes: [] },
  };
}

const observations = [
  ...pair("draftkings", "2026-10-26T19:00:00.000Z", -3, -110, -110, "same_family_as_evaluated"),
  ...pair("draftkings", "2026-10-26T19:50:00.000Z", -3.5, -110, -110, "evaluated"),
  ...pair("fanduel", "2026-10-26T19:00:00.000Z", -3, -110, -110),
  ...pair("fanduel", "2026-10-26T19:20:00.000Z", -2.75, -111, -109),
  ...pair("fanduel", "2026-10-26T19:30:00.000Z", -2.75, -110, -110),
  ...pair("circa", "2026-10-26T19:00:00.000Z", -3, -110, -110),
  ...pair("circa", "2026-10-26T19:40:00.000Z", -2.75, -111, -109),
  ...moneylinePair("fanduel", "2026-10-26T19:00:00.000Z", -110, -110),
  ...moneylinePair("fanduel", "2026-10-26T19:10:00.000Z", -111, -109),
  ...moneylinePair("circa", "2026-10-26T19:00:00.000Z", -110, -110),
  ...moneylinePair("circa", "2026-10-26T19:30:00.000Z", -111, -109),
  identifiedSplit("draftkings", "target-family"),
  identifiedSplit("circa", "target-excluded"),
  quote({ participant: "betmgm", selection: "away", line: 3, price: null,
    observedAt: "2026-10-26T19:30:00.000Z", availability: "incomplete" }),
  quote({ participant: "circa", selection: "away", line: 3.5, price: -112,
    observedAt: "2026-10-26T19:55:00.000Z", availableAt: "2026-10-26T20:05:00.000Z",
    availability: "future" }),
  quote({ participant: "circa", selection: "home", line: -3.5, price: -108,
    observedAt: "2026-10-26T19:55:00.000Z", availableAt: "2026-10-26T20:05:00.000Z",
    availability: "future" }),
];
const manifestParticipants = [...new Set(observations.map((observation) => observation.source.participant!))];
const independentPrior = bindMarketBrainMarginTotalPrior({
  eventId,
  release: NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
  availableAt: "2026-10-26T18:00:00.000Z",
  inputLineage: fixtureMarketBrainPriorInputLineage({
    eventId, asOf: "2026-10-26T18:00:00.000Z",
  }),
  marginDistribution: { values: [-3, 3], probabilities: [0.55, 0.45] },
  totalDistribution: { values: [41, 45], probabilities: [0.45, 0.55] },
});
const marketCase = buildMarketBrainCase({
  sport: "nfl",
  eventId,
  evaluatedAt: cutoffAt,
  captureBoundary: "raw_provider_response",
  captureLimitations: [],
  subject: { kind: "two_team_game", awayId: "NE", homeId: "SEA", startsAt: "2026-10-26T21:00:00.000Z" },
  prior: independentPrior,
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
    release: "fixture-source-manifest-r1",
    provider: "fixture",
    feed: "fixture",
    participant: null,
    providerFetchedAt: cutoffAt,
    receivedAt: cutoffAt,
    rawResponseSha256: "a".repeat(64),
    rawParserInputSchemaRelease: null,
    rawParserInputSha256: null,
    returnedRows: manifestParticipants.length,
    matchedRows: manifestParticipants.length,
    unmatchedRows: 0,
    ambiguousRows: 0,
    ledgerScope: "full_response",
    ledgerRows: manifestParticipants.length,
    omittedRows: 0,
    rows: manifestParticipants.map((participant, rowIndex) => ({
      rowIndex,
      rawRowSha256: (rowIndex + 1).toString(16).repeat(64),
      disposition: "matched",
      providerGameId: eventId,
      participant,
      retainedObservationIds: observations.filter((row) => row.source.participant === participant).map((row) => row.id),
    })),
    retainedObservationIds: observations.map((row) => row.id),
    status: "observed",
    failureReason: null,
  }],
  expectedInputs: [
    {
      id: "identified_book_split:spread:draftkings", market: "spread", modality: "identified_book_split",
      provider: "sharpapi", participant: "draftkings", expectation: "opportunistic",
      availability: "observed", observationIds: ["split:draftkings:target-family"], reason: null,
    },
    {
      id: "identified_book_split:spread:circa", market: "spread", modality: "identified_book_split",
      provider: "sharpapi", participant: "circa", expectation: "opportunistic",
      availability: "observed", observationIds: ["split:circa:target-excluded"], reason: null,
    },
  ],
  blindSpots: [],
});
const forgedReleaseCase = structuredClone(marketCase);
forgedReleaseCase.sourceManifests[0]!.release = "forged-source-release";
assert.throws(() => assertMarketBrainCase(forgedReleaseCase), /release or feed diverged/,
  "a checksum-consistent case must reject a manifest release that is not owned by its retained observations");
const conflictingOwnerCase = structuredClone(marketCase);
const conflictingManifest = structuredClone(conflictingOwnerCase.sourceManifests[0]!);
conflictingManifest.id = "fixture-source-manifest-conflicting-owner";
conflictingOwnerCase.sourceManifests.push(conflictingManifest);
assert.throws(() => assertMarketBrainCase(conflictingOwnerCase), /claimed by conflicting manifests/,
  "a retained observation must have exactly one source-manifest owner");
const unownedSourceCase = structuredClone(marketCase);
unownedSourceCase.sourceManifests = [];
assert.throws(() => assertMarketBrainCase(unownedSourceCase), /has no source manifest owner/,
  "source-backed price and identified-split observations cannot enter features without provenance");
const mismatchedParticipantCase = structuredClone(marketCase);
mismatchedParticipantCase.sourceManifests[0]!.participant = "circa";
assert.throws(() => assertMarketBrainCase(mismatchedParticipantCase), /release or feed diverged/,
  "a participant-scoped manifest cannot claim observations from another book");
const broadManifestForgeryCase = structuredClone(marketCase);
broadManifestForgeryCase.observations[0]!.source.participant = "forgedbook";
assert.throws(() => assertMarketBrainCase(broadManifestForgeryCase), /row participant diverged/,
  "an all-books manifest must still bind each retained observation to its exact raw-row participant");
const forgedPriorLineageCase = structuredClone(marketCase);
if (forgedPriorLineageCase.prior.kind !== "margin_total_distribution") throw new Error("fixture prior missing");
forgedPriorLineageCase.prior.artifact.inputLineage.components[0]!.sha256 = "f".repeat(64);
assert.throws(() => assertMarketBrainCase(forgedPriorLineageCase), /input lineage is invalid/,
  "a prior component cannot be changed without invalidating the content-addressed lineage");

const relabeledExternalPrior = bindMarketBrainMarginTotalPrior({
  eventId: "relabeled-external-prior-fixture",
  release: NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
  availableAt: "2026-10-26T18:00:00.000Z",
  inputLineage: bindMarketBrainPriorInputLineage({
    eventId: "relabeled-external-prior-fixture",
    modelPath: "external_projection",
    modelRelease: NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
    asOf: "2026-10-26T18:00:00.000Z",
    declaredMarketInputPolicy: "market_inputs_prohibited",
    components: [{
      id: "external_projection_relabel_attempt",
      category: "model_artifact",
      release: "external_projection_relabel_attempt_r1",
      availableAt: "2026-10-26T18:00:00.000Z",
      sha256: marketBrainSha256({ external: true, relabeled: true }),
      marketRelation: "excluded_by_construction",
    }],
  }),
  marginDistribution: independentPrior.artifact.marginDistribution,
  totalDistribution: independentPrior.artifact.totalDistribution,
});
const exactProviderLineage = bindMarketBrainPriorInputLineage({
  eventId: "exact-provider-attestation-fixture",
  modelPath: "nfl_exact_provider",
  modelRelease: NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE,
  asOf: "2026-10-26T18:00:00.000Z",
  declaredMarketInputPolicy: "market_inputs_prohibited",
  components: [
    {
      id: "nfl_discrete_score_shape", category: "model_artifact",
      release: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
      availableAt: "2026-08-23T00:00:00.000Z", sha256: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_SHA256,
      marketRelation: "excluded_by_construction",
    },
    {
      id: "nfl_exact_provider_model_artifact", category: "model_artifact",
      release: NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE,
      availableAt: "2026-10-15T00:00:00.000Z", sha256: NFL_EXACT_PROVIDER_SCORE_ARTIFACT_SHA256,
      marketRelation: "excluded_by_construction",
    },
    {
      id: "nfl_completed_game_state", category: "team_statistics",
      release: NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
      availableAt: "2026-10-26T17:00:00.000Z", sha256: marketBrainSha256({ state: "fixture" }),
      marketRelation: "excluded_by_construction",
    },
    {
      id: "nfl_pregame_schedule_venue_context", category: "venue_context",
      release: NFL_EXACT_PROVIDER_SCORE_CONTEXT_RELEASE,
      availableAt: "2026-10-26T18:00:00.000Z", sha256: marketBrainSha256({ context: "fixture" }),
      marketRelation: "excluded_by_construction",
    },
  ],
});
const exactProviderPrior = bindMarketBrainMarginTotalPrior({
  eventId: "exact-provider-attestation-fixture",
  release: NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE,
  availableAt: "2026-10-26T18:00:00.000Z",
  inputLineage: exactProviderLineage,
  marginDistribution: { values: [-3, 3], probabilities: [0.5, 0.5] },
  totalDistribution: { values: [41, 45], probabilities: [0.5, 0.5] },
});
assert.doesNotThrow(() => assertNflMarketBrainPriorInputLineageQualified(exactProviderPrior),
  "the exact registered provider/component manifest must remain executable");
const malformedExactLineage = bindMarketBrainPriorInputLineage({
  eventId: exactProviderLineage.eventId,
  modelPath: exactProviderLineage.modelPath,
  modelRelease: exactProviderLineage.modelRelease,
  asOf: exactProviderLineage.asOf,
  declaredMarketInputPolicy: exactProviderLineage.declaredMarketInputPolicy,
  components: exactProviderLineage.components.map((component) => component.id === "nfl_completed_game_state"
    ? { ...component, release: "unregistered-state-release" } : component),
});
const malformedExactPrior = bindMarketBrainMarginTotalPrior({
  eventId: "exact-provider-attestation-fixture",
  release: NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE,
  availableAt: "2026-10-26T18:00:00.000Z",
  inputLineage: malformedExactLineage,
  marginDistribution: { values: [-3, 3], probabilities: [0.5, 0.5] },
  totalDistribution: { values: [41, 45], probabilities: [0.5, 0.5] },
});
assert.throws(() => assertNflMarketBrainPriorInputLineageQualified(malformedExactPrior),
  /component attestation failed/,
  "a checksum-consistent exact-provider relabel with an unregistered component release must fail");
assert.equal(relabeledExternalPrior.artifact.inputLineage.qualification, "ineligible",
  "an external path cannot self-attest by relabeling its policy and components");
const relabeledOtherLineage = bindMarketBrainPriorInputLineage({
  eventId: "relabeled-other-prior-fixture",
  modelPath: "other",
  modelRelease: "relabeled-other-prior-r1",
  asOf: "2026-10-26T18:00:00.000Z",
  declaredMarketInputPolicy: "market_inputs_prohibited",
  components: [{
    id: "other_relabel_attempt",
    category: "other",
    release: "other_relabel_attempt_r1",
    availableAt: "2026-10-26T18:00:00.000Z",
    sha256: marketBrainSha256({ other: true, relabeled: true }),
    marketRelation: "excluded_by_construction",
  }],
});
assert.equal(relabeledOtherLineage.qualification, "ineligible",
  "an unregistered other path cannot self-attest by relabeling its policy and components");
const relabeledExternalCase = buildMarketBrainCase({
  sport: "nfl", eventId: "relabeled-external-prior-fixture", evaluatedAt: cutoffAt,
  captureBoundary: "normalized_provider_observation", captureLimitations: ["fixture"],
  subject: { kind: "two_team_game", awayId: "AWY", homeId: "HME", startsAt: "2026-10-27T00:00:00.000Z" },
  prior: relabeledExternalPrior, evaluatedTargets: {}, observations: [], sourceManifests: [], expectedInputs: [], blindSpots: [],
});
const relabeledExternalSequence = materializeNflMarketBrainSequence({ cases: [relabeledExternalCase], cutoffAt });
assert.throws(() => buildNflMarketBrainResolverFeatures(relabeledExternalSequence),
  /not qualified against market double counting/,
  "a self-consistently relabeled external projection must fail the full case-to-feature path");

const materialized = materializeNflMarketBrainSequence({ cases: [marketCase], cutoffAt });
assert.equal(materialized.targetFamilyByMarket.spread, "draftkings");
assert.equal(materialized.accounting.targetExcluded, 5,
  "the exact target, same-family quotes, and same-family splits must be excluded before features");
assert.equal(materialized.accounting.targetExcludedExpectedInputs, 1,
  "same-family source missingness must not become a backdoor target feature");
assert.equal(materialized.accounting.afterCutoff, 2, "provider rows unavailable by cutoff must not enter features");
assert.equal(materialized.accounting.unavailableOrUnsupported, 3,
  "masked incomplete and explicitly future evidence must remain accounted for instead of disappearing");
assert.equal(materialized.quotePaths.some((path) => path.participant === "draftkings"), false);
assert.equal(materialized.quotePaths.some((path) => path.participant === "betmgm"), false);

const fanduel = materialized.quotePaths.find((path) => path.participant === "fanduel" && path.market === "spread");
const circa = materialized.quotePaths.find((path) => path.participant === "circa" && path.market === "spread");
assert.ok(fanduel && circa);
assert.equal(fanduel.observedRole, "reversal", "later buyback must remain visible on a first-moving path");
assert.equal(fanduel.wasFirstMover, true,
  "leadership and later reversal must be composable rather than mutually exclusive labels");
assert.equal(circa.observedRole, "follower", "a professional book that moves second must remain a follower");
assert.equal(circa.wasFirstMover, false);
assert.equal(fanduel.lineDelta, 0.25, "sub-half-point movement must survive without a threshold gate");
assert.ok(fanduel.fairProbabilityBuybackDistance > 0,
  "a price buyback must survive even after the line has already moved on its separate axis");
assert.equal(fanduel.lineBuybackDistance, 0,
  "price-only buyback must not fabricate a line retracement");
assert.equal(circa.points.length, 2, "future-available quote pair must be removed before sequence features");
assert.equal(materialized.crossMarket.sideRelationship, "aligned",
  "Moneyline and Spread must be coordinated in one orientation instead of interpreted in isolation");
assert.equal(materialized.crossMarket.sideLeader, "moneyline");
assert.equal(materialized.crossMarket.sideLeadLagMinutes, 10);
assert.equal(materialized.invariants.productionInfluenceAllowed, false);
assert.equal(materialized.checksum.length, 64);
const resolverFeatures = buildNflMarketBrainResolverFeatures(materialized);
assert.equal(resolverFeatures.contextTokens.some((token) => token.participant === "draftkings"), false);
assert.equal(resolverFeatures.contextTokens.some((token) => token.participant === "circa"), true);
assert.equal(resolverFeatures.contextTokens.some((token) =>
  token.participant === "betmgm" && token.availability === "incomplete"), true,
"incomplete single-sided evidence must survive as a masked token without becoming a quote path");
assert.equal(resolverFeatures.expectedInputTokens.some((token) => token.participant === "draftkings"), false);
assert.equal(resolverFeatures.expectedInputTokens.some((token) => token.participant === "circa"), true);
assert.equal(resolverFeatures.invariants.productionInfluenceAllowed, false);
assert.doesNotMatch(JSON.stringify(resolverFeatures),
  /sensitive-provider-event-id|Sensitive Fixture Player|free-text fixture detail|f{64}/,
  "high-cardinality provider, player, free-text, and raw-hash identities must not become trainer features");
const trainerInput = nflMarketBrainTrainerInput(resolverFeatures);
const vector = vectorizeNflMarketBrainTrainerInput(trainerInput);
assert.equal(vector.names.length, vector.values.length);
assert.ok(vector.names.length > 96,
  "the executable vector must retain source, current-state, split, transition, and cross-market nuance");
assert.equal(new Set(vector.names).size, vector.names.length,
  "the executable vector schema must contain every contextual feature exactly once");
const feature = (name: string) => vector.values[vector.names.indexOf(name)]!;
assert.ok(feature("spread_key_crossing_count_mean") > 0,
  "key-number transitions must enter the executable vector rather than remain audit-only prose");
assert.ok(feature("spread_professional_source_rate") > 0,
  "professional-versus-retail context must be learnable without a fixed sportsbook weight");
assert.equal(feature("spread_circa_observed"), 1,
  "named professional quote paths must remain distinguishable to the learned model");
assert.ok(feature("aligned_spread_probability_delta") !== 0,
  "cross-market state must interact with price movement instead of acting as an isolated vote");
assert.equal(trainerInput.independentPrior.availableSecondsBeforeCutoff, 7_200);
assert.equal(JSON.stringify(trainerInput).includes(eventId), false,
  "event identity must remain provenance, never a trainer shortcut");
assert.equal(JSON.stringify(trainerInput).includes(independentPrior.artifact.sha256), false,
  "the content-addressed prior hash must remain provenance, never a trainer shortcut");
const caseAudit = buildNflMarketBrainCaseAudit({ sequence: materialized, features: resolverFeatures });
assert.equal(caseAudit.timeline.every((row, index, rows) => index === 0 ||
  Date.parse(rows[index - 1]!.observedAt) <= Date.parse(row.observedAt)), true,
"the real-tape review dossier must preserve chronological quote order");
assert.equal(caseAudit.splitEvidence.some((row) => row.sportsbook === "circa" && row.eligible), true,
  "identified professional split evidence must remain independently inspectable");
assert.equal(caseAudit.excludedEvidence.some((row) => row.reasons.includes("same_target_family")), true,
  "the dossier must show what was excluded so a reviewer can detect hidden evidence gaps");
assert.equal(caseAudit.observationLedger.length, materialized.observations.length,
  "the dossier must retain every normalized observation, including unpaired and excluded rows");
assert.equal(caseAudit.sourceManifests.length, materialized.sourceManifests.length,
  "the dossier must retain raw-response hash and row-accounting manifests");
assert.equal(caseAudit.consumedFeatureVector.names.length, vector.names.length,
  "the dossier must expose the exact vector consumed by the fitted model");
assert.equal(caseAudit.invariants.manualVerdictAssigned, false);

const targetIdentityWithoutExactMatch = structuredClone(marketCase);
for (const observation of targetIdentityWithoutExactMatch.observations) {
  if (observation.targetRelation === "evaluated") observation.targetRelation = "unknown";
}
const withoutExactMatch = materializeNflMarketBrainSequence({ cases: [targetIdentityWithoutExactMatch], cutoffAt });
assert.equal(withoutExactMatch.quotePaths.some((path) => path.participant === "draftkings"), false,
  "the explicit evaluated-target manifest must exclude its whole family even when an exact raw side cannot be matched");

const extraTargetOnlyCase = structuredClone(marketCase);
extraTargetOnlyCase.observations.push(identifiedSplit("draftkings", "second-target-only-row"));
const extraTargetOnly = materializeNflMarketBrainSequence({ cases: [extraTargetOnlyCase], cutoffAt });
assert.notEqual(extraTargetOnly.checksum, materialized.checksum,
  "the audited sequence must still account for the extra excluded target row");
assert.equal(buildNflMarketBrainResolverFeatures(extraTargetOnly).featurePayloadSha256, resolverFeatures.featurePayloadSha256,
  "target-only evidence changes must not change the resolver feature payload");

const relationProtectedCase = structuredClone(marketCase);
const relationProtected = relationProtectedCase.observations.find((observation) =>
  observation.source.participant === "circa" && observation.modality === "identified_book_split")!;
relationProtected.targetRelation = "evaluated";
const relationProtectedSequence = materializeNflMarketBrainSequence({ cases: [relationProtectedCase], cutoffAt });
assert.equal(buildNflMarketBrainResolverFeatures(relationProtectedSequence).contextTokens.some((token) =>
  token.participant === "circa" && token.modality === "identified_book_split"), false,
"an explicit evaluated-target relation must be excluded even when participant text does not match the target family");

const earlierAvailabilityCase = structuredClone(marketCase);
earlierAvailabilityCase.evaluatedAt = "2026-10-26T19:00:00.000Z";
earlierAvailabilityCase.observations = earlierAvailabilityCase.observations.filter((observation) =>
  Date.parse(observation.timing.availableAt) <= Date.parse(earlierAvailabilityCase.evaluatedAt));
earlierAvailabilityCase.sourceManifests = [];
earlierAvailabilityCase.expectedInputs = [{
  id: "identified_book_split:spread:circa", market: "spread", modality: "identified_book_split",
  provider: "sharpapi", participant: "circa", expectation: "opportunistic",
  availability: "unavailable", observationIds: [], reason: "provider_temporarily_unavailable",
}];
const availabilitySequence = materializeNflMarketBrainSequence({
  cases: [earlierAvailabilityCase, marketCase], cutoffAt,
});
const availabilityFeatures = buildNflMarketBrainResolverFeatures(availabilitySequence);
assert.equal(availabilityFeatures.sourceAvailability.snapshots.length, 2);
assert.equal(availabilityFeatures.sourceAvailability.snapshots[0]?.regime, "unavailable");
assert.equal(availabilityFeatures.sourceAvailability.snapshots[1]?.regime, "complete");
assert.ok(availabilityFeatures.expectedInputTokens.some((token) =>
  token.participant === "circa" && token.availability === "unavailable" &&
  token.capturedSecondsBeforeCutoff === 3_600),
"an earlier source outage must survive after the source later recovers");

const unpairedCase = structuredClone(marketCase);
unpairedCase.observations.push(
  quote({ participant: "conflictbook", selection: "away", line: 3, price: -110,
    observedAt: "2026-10-26T19:35:00.000Z" }),
  quote({ participant: "conflictbook", selection: "away", line: 3, price: -115,
    observedAt: "2026-10-26T19:35:00.000Z" }),
  quote({ participant: "conflictbook", selection: "home", line: -3, price: -105,
    observedAt: "2026-10-26T19:35:00.000Z" }),
);
const unpairedFeatures = buildNflMarketBrainResolverFeatures(
  materializeNflMarketBrainSequence({ cases: [unpairedCase], cutoffAt }),
);
assert.equal(unpairedFeatures.quotePathTokens.some((token) => token.participant === "conflictbook"), false);
assert.equal(unpairedFeatures.contextTokens.filter((token) =>
  token.participant === "conflictbook" && token.quotePairStatus === "unpaired_observed_quote").length, 3,
"conflicting same-time prices must remain visible as uncertain raw quote tokens");

const skewFirst = structuredClone(marketCase);
skewFirst.evaluatedAt = "2026-10-26T19:15:00.000Z";
const skewObserved = quote({ participant: "clockskew", selection: "away", line: 3, price: -110,
  observedAt: "2026-10-26T19:10:00.000Z", availableAt: "2026-10-26T19:15:00.000Z", availability: "future" });
skewFirst.observations.push(skewObserved);
const skewSecond = structuredClone(skewFirst);
skewSecond.evaluatedAt = "2026-10-26T19:30:00.000Z";
skewSecond.observations[skewSecond.observations.length - 1] = {
  ...skewObserved,
  availability: "observed",
  timing: { ...skewObserved.timing, ingestedAt: "2026-10-26T19:30:00.000Z", availableAt: "2026-10-26T19:30:00.000Z" },
};
const skewSequence = materializeNflMarketBrainSequence({ cases: [skewFirst, skewSecond], cutoffAt });
assert.equal(skewSequence.observations.find((row) => row.observation.source.participant === "clockskew")?.observation.availability,
  "observed", "a later causally observed state must replace the earlier provider-clock-skew mask");

const directionConflictCase = structuredClone(marketCase);
directionConflictCase.observations.push(
  ...pair("conflictpath", "2026-10-26T19:00:00.000Z", -3, -110, -110),
  ...pair("conflictpath", "2026-10-26T19:20:00.000Z", -2.5, -100, -120),
  ...pair("conflictpath", "2026-10-26T19:40:00.000Z", -2.75, -110, -110),
);
const conflictPath = materializeNflMarketBrainSequence({ cases: [directionConflictCase], cutoffAt })
  .quotePaths.find((path) => path.participant === "conflictpath")!;
assert.equal(conflictPath.directionConflictCount, 0,
  "a new price attached to a different line must not be misread as an opposing market vote");
assert.equal(conflictPath.observedRole, "reversal",
  "the actual line move and buyback must remain visible without inventing a line-versus-price conflict");

const eventIdentityCase = structuredClone(marketCase);
eventIdentityCase.observations.push(
  quote({ participant: "identitybook", selection: "away", line: 3, price: -110,
    observedAt: "2026-10-26T19:00:00.000Z", providerEventId: "event-a" }),
  quote({ participant: "identitybook", selection: "home", line: -3, price: -110,
    observedAt: "2026-10-26T19:00:00.000Z", providerEventId: "event-a" }),
  quote({ participant: "identitybook", selection: "away", line: 2.5, price: -110,
    observedAt: "2026-10-26T19:30:00.000Z", providerEventId: "event-b" }),
  quote({ participant: "identitybook", selection: "home", line: -2.5, price: -110,
    observedAt: "2026-10-26T19:30:00.000Z", providerEventId: "event-b" }),
);
assert.throws(() => materializeNflMarketBrainSequence({ cases: [eventIdentityCase], cutoffAt }),
  /multiple provider event identities/,
  "provider event identity changes may not silently merge two games into one quote path");

const conflicting = structuredClone(marketCase);
conflicting.observations[0]!.values.price = numericFeature(-120);
assert.throws(
  () => materializeNflMarketBrainSequence({ cases: [marketCase, conflicting], cutoffAt }),
  /Conflicting Market Brain observation identity/,
  "immutable observation identities must fail closed when economics conflict",
);

console.log("NFL Market Brain materializer: cutoff, target-family exclusion, continuous movement, chronological roles, cross-market coordination, missingness, and immutable dedup passed");
