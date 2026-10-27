import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { NflPreviewGame } from "../lib/services/football/balldontlieNflPreviewSlate";
import {
  rawPriceSha256,
  type FootballRawPriceObservation,
  type FootballRawPriceResponseManifest,
} from "../lib/services/football/footballRawPriceManifest";
import {
  NFL_FORWARD_CONTEXT_CAPTURE_RELEASE,
  type NflForwardContextCapture,
  type NflForwardContextMarket,
} from "../lib/services/football/nflForwardEvidenceCapture";
import {
  buildNflMarketBrainShadow,
  nflMarketBrainCaptureFailure,
} from "../lib/services/football/nflMarketBrainShadow";
import {
  normalizeSharpApiNflSplit,
  type NflSharpApiSplitSource,
} from "../lib/services/football/sharpApiNflSplits";
import { MARKET_BRAIN_CONTRACT_RELEASE } from "../lib/services/marketBrain/marketBrainContract";

const capturedAt = "2026-10-26T20:00:00.000Z";
const openedAt = "2026-10-26T16:00:00.000Z";
const game: NflPreviewGame = {
  providerGameId: "nfl-fixture",
  providerWeek: 8,
  season: 2026,
  scheduledStart: "2026-10-26T21:00:00.000Z",
  status: "scheduled",
  away: { id: 1, abbreviation: "NE", name: "New England Patriots" },
  home: { id: 2, abbreviation: "SEA", name: "Seattle Seahawks" },
};
const independentForecast = {
  marginDistribution: { values: [2, 3], probabilities: [0.5, 0.5] },
  totalDistribution: { values: [45, 47], probabilities: [0.5, 0.5] },
};
const distributionHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function market(name: "moneyline" | "spread" | "total"): NflForwardContextMarket {
  const line = name === "moneyline" ? null : name === "spread" ? -3.5 : 45.5;
  return {
    market: name,
    evaluated: { identity: `${name}-target`, family: "draftkings", side: name === "total" ? "o" : "h", line, price: -110, observedAt: capturedAt, completePairRetained: true },
    families: [
      ["circa", "s", "c", null, [openedAt, 240, "s", line, -105, -115], [capturedAt, 0, "f", line, -108, -112]],
      ["draftkings", "b", "n", null, [openedAt, 240, "s", line, -110, -110], [capturedAt, 0, "f", line, -110, -110]],
    ],
    targetExcludedFamilies: ["circa"],
    coverage: {
      completeObserved: 2, completeRetained: 2, completeOmitted: 0,
      targetExcludedObserved: 1, targetExcludedRetained: 1,
      chronologyPairsRetained: 2, targetExcludedChronologyPairsRetained: 1,
      ownershipMetadata: "not_loaded", truncated: false,
    },
    public: ["p", capturedAt, 12, 57, 43, 43, 57],
    sharp: null,
    final: null,
    coherence: { evaluatedFamilyExcluded: true, exactPairComplete: true },
    bytes: 1,
  };
}

const capture: NflForwardContextCapture = {
  release: NFL_FORWARD_CONTEXT_CAPTURE_RELEASE,
  schema: "nflfec4",
  mode: "market_sequence_and_capture",
  productionDecisionEffect: true,
  gameId: game.providerGameId,
  capturedAt,
  releases: { evidence: "evidence", collector: "collector", member: "member", model: "model", calibration: "calibration", decision: "decision" },
  prior: {
    status: "available", reason: "week_one_artifact_target_free", release: "target-free-prior",
    outcome: {
      pmf: {
        margin: { sha256: distributionHash(independentForecast.marginDistribution), support: 2, mass: 1, mean: 2.5, sd: 0.5 },
        total: { sha256: distributionHash(independentForecast.totalDistribution), support: 2, mass: 1, mean: 46, sd: 1 },
      },
      expected: [21.75, 24.25], representative: [21, 24], win: [0.43, 0.55, 0.02],
    },
  },
  authoritative: {
    pmf: {
      margin: { sha256: "auth-margin", support: 20, mass: 1, mean: 3, sd: 10 },
      total: { sha256: "auth-total", support: 30, mass: 1, mean: 45, sd: 9 },
    },
    expected: [21, 24], representative: [21, 24], win: [0.42, 0.56, 0.02], decisions: [],
  },
  markets: { moneyline: market("moneyline"), spread: market("spread"), total: market("total") },
  context: {
    rosterDepthSha256: "roster", injurySha256: null, weatherSha256: "weather",
    quarterbacks: { away: [null, null, "unknown", capturedAt], home: [null, null, "unknown", capturedAt] },
    injury: [null, null, null, 0], weather: ["controlled_indoor", capturedAt, "forecast"],
  },
  coherence: {
    priorPmfValid: true, authoritativePmfValid: true, expectedScoresMatchPmf: true,
    winnerMatchesScore: true, allEvaluatedFamiliesExcluded: true, missingEvidenceNeutral: true,
  },
  bytes: 1,
};

const splitRow = (sportsbook: string, homeMoney: number) => normalizeSharpApiNflSplit(game.providerGameId, capturedAt, {
  event_id: `${sportsbook}-event`, sportsbook, fetched_at: capturedAt,
  moneyline: { handle_pct: { home: homeMoney, away: 100 - homeMoney }, bets_pct: { home: 50, away: 50 } },
  spread: { handle_pct: { home: homeMoney, away: 100 - homeMoney }, bets_pct: { home: 50, away: 50 } },
  total: { handle_pct: { over: homeMoney, under: 100 - homeMoney }, bets_pct: { over: 50, under: 50 } },
});
const splitSources: NflSharpApiSplitSource[] = [
  { sportsbook: "circa", status: "observed", matchedRows: 1, observations: [splitRow("circa", 62)] },
  { sportsbook: "draftkings", status: "observed", matchedRows: 1, observations: [splitRow("draftkings", 37)] },
  { sportsbook: "betmgm", status: "unavailable", matchedRows: 0, observations: [] },
];

function priceManifest(
  sportsbook: string,
  observedAt: string,
  provider: "balldontlie" | "sharpapi",
  phase: "provider_opening" | "current",
  shifted = false,
): FootballRawPriceResponseManifest {
  const firstPrice = sportsbook === "DraftKings" ? -110 : shifted ? -108 : -105;
  const secondPrice = sportsbook === "DraftKings" ? -110 : shifted ? -112 : -115;
  const specs = [
    ["moneyline", "away", null, firstPrice], ["moneyline", "home", null, secondPrice],
    ["spread", "away", 3.5, firstPrice], ["spread", "home", -3.5, secondPrice],
    ["total", "over", 45.5, firstPrice], ["total", "under", 45.5, secondPrice],
  ] as const;
  const rows: FootballRawPriceObservation[] = specs.map(([marketName, selection, line, priceValue], index) => ({
    sourceObservationId: `${provider}-${sportsbook}-${phase}-${index}`,
    rawRowSha256: rawPriceSha256([provider, sportsbook, phase]),
    provider,
    feed: provider === "sharpapi" ? "main_odds" : phase === "current" ? "current_odds" : "opening_odds",
    phase,
    providerGameId: game.providerGameId,
    providerEventId: `${provider}-event`,
    sportsbook,
    market: marketName,
    selection,
    line,
    price: priceValue,
    providerObservedAt: observedAt,
    providerFetchedAt: observedAt,
    status: "observed",
    notes: [],
  }));
  return {
    provider,
    feed: rows[0]!.feed,
    participant: provider === "sharpapi" ? sportsbook.toLowerCase() : null,
    providerFetchedAt: observedAt,
    rawResponseSha256: rawPriceSha256(rows),
    returnedRows: 1,
    matchedRows: 1,
    unmatchedRows: 0,
    ambiguousRows: 0,
    rows: [{
      rowIndex: 0,
      rawRowSha256: rawPriceSha256(rows),
      disposition: "matched",
      providerGameId: game.providerGameId,
      sourceObservationIds: rows.map((row) => row.sourceObservationId),
    }],
    failed: false,
    failureReason: null,
    observationsByGame: { [game.providerGameId]: rows },
  };
}

const rawPriceResponseManifests = [
  priceManifest("Circa", openedAt, "sharpapi", "provider_opening"),
  priceManifest("DraftKings", openedAt, "balldontlie", "provider_opening"),
  priceManifest("Circa", capturedAt, "sharpapi", "current", true),
  priceManifest("DraftKings", capturedAt, "balldontlie", "current", true),
];

const shadow = buildNflMarketBrainShadow({ game, capture, independentForecast, knownPriorArtifactSha256: [], rawPriceResponseManifests, sharpSplitSources: splitSources });
const unchangedInputs = JSON.stringify({ capture, independentForecast, rawPriceResponseManifests, splitSources });
buildNflMarketBrainShadow({ game, capture, independentForecast, knownPriorArtifactSha256: [], rawPriceResponseManifests, sharpSplitSources: splitSources });
assert.equal(JSON.stringify({ capture, independentForecast, rawPriceResponseManifests, splitSources }), unchangedInputs, "shadow capture must not mutate source evidence");
assert.equal(shadow.case.release, MARKET_BRAIN_CONTRACT_RELEASE);
assert.equal(shadow.case.mode, "shadow_capture");
assert.ok(shadow.bytes > 0);
assert.equal(shadow.case.captureBoundary, "raw_provider_response");
assert.equal(shadow.case.sourceManifests.length, 4);
assert.equal(shadow.case.evaluatedTargets.spread?.family, "draftkings");
assert.equal(shadow.case.accounting.providedObservations, shadow.case.accounting.retainedObservations);
assert.equal(shadow.case.invariants.allExpectedInputsAccounted, true);
assert.equal(shadow.case.invariants.allReturnedSourceRowsAccounted, true);
assert.equal(shadow.case.invariants.productionInfluenceAllowed, false);
assert.equal(shadow.case.invariants.displayContractAuthority, false);
assert.equal(shadow.case.blindSpots.length, 7);
assert.equal(shadow.case.prior.kind, "margin_total_distribution");
assert.equal(shadow.case.prior.kind === "margin_total_distribution" && shadow.case.prior.artifact.eventId, game.providerGameId);
assert.equal(shadow.case.prior.kind === "margin_total_distribution" && shadow.case.prior.artifact.marginDistribution.values.length, 2);
assert.equal(shadow.case.prior.kind === "margin_total_distribution" && shadow.case.prior.artifact.sha256.length, 64);
const priorArtifactSha256 = shadow.case.prior.kind === "margin_total_distribution" ? shadow.case.prior.artifact.sha256 : "";
const referencedShadow = buildNflMarketBrainShadow({
  game, capture, independentForecast, knownPriorArtifactSha256: [priorArtifactSha256],
  rawPriceResponseManifests, sharpSplitSources: splitSources,
});
assert.equal(referencedShadow.case.prior.kind, "margin_total_distribution_ref");
assert.equal(referencedShadow.case.prior.kind === "margin_total_distribution_ref" &&
  referencedShadow.case.prior.artifactSha256, priorArtifactSha256);
assert.ok(shadow.bytes - referencedShadow.bytes > 100,
  "later captures must reference the immutable prior rather than duplicating its PMF bytes");
const corruptedPrior = structuredClone(shadow.case);
if (corruptedPrior.prior.kind === "margin_total_distribution") corruptedPrior.prior.artifact.marginDistribution.probabilities[0] = 0.4;
assert.throws(
  () => buildNflMarketBrainShadow({ game, capture, independentForecast: corruptedPrior.prior.kind === "margin_total_distribution" ? {
    marginDistribution: corruptedPrior.prior.artifact.marginDistribution,
    totalDistribution: corruptedPrior.prior.artifact.totalDistribution,
  } : null, knownPriorArtifactSha256: [], rawPriceResponseManifests, sharpSplitSources: splitSources }),
  /distribution mass|diverged/,
  "a mutated prior PMF must fail closed instead of being reconstructed from its mean",
);
assert.throws(
  () => buildNflMarketBrainShadow({ game, capture, independentForecast: null, knownPriorArtifactSha256: [], rawPriceResponseManifests, sharpSplitSources: splitSources }),
  /missing its exact distribution artifact/,
  "an available prior summary without exact PMF bytes must fail closed",
);
assert.equal(shadow.case.expectedInputs.find((row) => row.id === "availability:injury_report")?.availability, "unavailable");
assert.equal(shadow.case.observations.find((row) => row.id === "weather:game")?.categorical.status, "controlled_indoor");

const split = (book: string) => shadow.case.observations.find((row) =>
  row.modality === "identified_book_split" && row.market === "moneyline" && row.source.participant === book);
assert.equal(split("circa")?.values.first_money_pct.value, 38);
assert.equal(split("draftkings")?.values.first_money_pct.value, 63,
  "opposing identified-book observations must survive without a preferred-source collapse");
assert.equal(split("circa")?.observedRole, "unknown",
  "a professional-book reputation must not be mislabeled as observed leadership");
assert.equal(split("circa")?.sourcePrior, "professional_book");

for (const marketName of ["moneyline", "spread", "total"] as const) {
  const target = shadow.case.observations.filter((row) => row.market === marketName && row.modality === "price_quote" && row.targetRelation === "evaluated");
  const sameFamily = shadow.case.observations.filter((row) => row.market === marketName && row.modality === "price_quote" && row.targetRelation === "same_family_as_evaluated");
  const excluded = shadow.case.observations.filter((row) => row.market === marketName && row.modality === "price_quote" && row.targetRelation === "target_excluded");
  assert.equal(target.length, 1, `${marketName} must identify the exact evaluated current quote`);
  assert.equal(sameFamily.length, 3, `${marketName} must distinguish every other same-family side from the exact target`);
  assert.equal(excluded.length, 4, `${marketName} must retain both target-excluded sides at opening and current`);
}

const absent = shadow.case.expectedInputs.find((row) => row.id === "identified_book_split:moneyline:betmgm");
assert.deepEqual(absent && { availability: absent.availability, observations: absent.observationIds.length, reason: absent.reason },
  { availability: "unavailable", observations: 0, reason: "source_unavailable" });
assert.deepEqual(shadow.case.expectedInputs.find((row) => row.id === "price:moneyline:sharpapi:pinnacle"), {
  id: "price:moneyline:sharpapi:pinnacle", modality: "price_quote", provider: "sharpapi", participant: "pinnacle",
  expectation: "required", availability: "unavailable", observationIds: [], reason: "provider_source_unavailable",
}, "a missing required price source must remain visible in the manifest");
assert.ok(shadow.case.observations.every((row) => row.timing.availableAt.length > 0),
  "every observation must carry a replay-safe availability time");
assert.ok(shadow.case.observations.every((row) => !["leader", "follower", "resistor", "reversal"].includes(row.observedRole)),
  "a single snapshot cannot invent market sequence roles");
assert.deepEqual(nflMarketBrainCaptureFailure({ eventId: game.providerGameId, capturedAt, error: new Error("fixture") }), {
  release: shadow.release, status: "capture_failed", productionApplied: false,
  eventId: game.providerGameId, capturedAt, reason: "fixture",
}, "shadow capture failures must remain explicit without gaining production authority");

console.log("NFL Market Brain raw-provider tape: individual sides, response manifests, opposing splits, replay-safe time, explicit missingness, and no-authority gate passed");
