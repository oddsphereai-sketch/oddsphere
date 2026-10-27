import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BALLDONTLIE_NFL_RAW_PRICE_MANIFEST_RELEASE,
  type NflPreviewGame,
} from "../lib/services/football/balldontlieNflPreviewSlate";
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
  FOOTBALL_SHARP_RAW_PRICE_MANIFEST_RELEASE,
} from "../lib/services/football/sharpApiFootballSharpOdds";
import {
  NFL_SHARP_API_SPLIT_CAPTURE_MANIFEST_RELEASE,
  normalizeSharpApiNflSplit,
  type NflSharpApiSplitSource,
} from "../lib/services/football/sharpApiNflSplits";
import { MARKET_BRAIN_CONTRACT_RELEASE } from "../lib/services/marketBrain/marketBrainContract";
import {
  MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE,
  NFL_MARKET_BRAIN_EVIDENCE_ROSTER,
} from "../lib/services/marketBrain/marketBrainEvidenceRoster";
import {
  buildNflMarketBrainResolverFeatures,
  nflMarketBrainTrainerInput,
  vectorizeNflMarketBrainTrainerInput,
} from
  "../lib/services/marketBrain/nflMarketBrainResolverFeatures";
import { materializeNflMarketBrainSequence } from
  "../lib/services/marketBrain/nflMarketBrainSequenceMaterializer";
import {
  NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
  fixtureMarketBrainPriorDistributions,
  fixtureMarketBrainPriorInputLineage,
} from
  "./fixtures/marketBrainPriorInputLineage";

const capturedAt = "2026-10-26T20:00:00.000Z";
const openedAt = "2026-10-26T16:00:00.000Z";
const game: NflPreviewGame = {
  providerGameId: "1392216",
  providerWeek: 8,
  season: 2026,
  scheduledStart: "2026-10-26T21:00:00.000Z",
  status: "scheduled",
  away: { id: 1, abbreviation: "NE", name: "New England Patriots" },
  home: { id: 2, abbreviation: "SEA", name: "Seattle Seahawks" },
};
const independentForecast = fixtureMarketBrainPriorDistributions(game.providerGameId);
const authoritativeForecast = {
  marginDistribution: {
    values: [-3, 0, 7.607142857142857],
    probabilities: [0.42, 0.02, 0.56],
  },
  totalDistribution: { values: [45], probabilities: [1] },
};
const distributionHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const distributionStats = (distribution: typeof independentForecast.marginDistribution) => {
  const mean = distribution.values.reduce((sum, value, index) =>
    sum + value * distribution.probabilities[index]!, 0);
  const variance = distribution.values.reduce((sum, value, index) =>
    sum + (value - mean) ** 2 * distribution.probabilities[index]!, 0);
  return { support: distribution.values.length, mass: 1, mean, sd: Math.sqrt(variance) };
};

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
    status: "available", reason: "week_one_artifact_target_free", release: NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
    outcome: {
      pmf: {
        margin: { sha256: distributionHash(independentForecast.marginDistribution),
          ...distributionStats(independentForecast.marginDistribution) },
        total: { sha256: distributionHash(independentForecast.totalDistribution),
          ...distributionStats(independentForecast.totalDistribution) },
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
    rosterDepthSha256: "roster", injurySha256: "injury", weatherSha256: "weather",
    quarterbacks: { away: [null, null, "unknown", capturedAt], home: [null, null, "unknown", capturedAt] },
    injury: ["BALLDONTLIE", capturedAt, "current", 1], weather: ["forecast_available", capturedAt, "forecast"],
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
    sourceRelease: provider === "sharpapi"
      ? FOOTBALL_SHARP_RAW_PRICE_MANIFEST_RELEASE
      : BALLDONTLIE_NFL_RAW_PRICE_MANIFEST_RELEASE,
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
    release: provider === "sharpapi"
      ? FOOTBALL_SHARP_RAW_PRICE_MANIFEST_RELEASE
      : BALLDONTLIE_NFL_RAW_PRICE_MANIFEST_RELEASE,
    provider,
    feed: rows[0]!.feed,
    participant: provider === "sharpapi" ? sportsbook.toLowerCase() : null,
    providerFetchedAt: observedAt,
    rawResponseSha256: rawPriceSha256(rows),
    rawParserInput: {
      schema: "football_raw_price_parser_input_2026_10_27_r4_streaming_response_hash",
      sha256: rawPriceSha256(rows),
      payload: rows,
      bytes: Buffer.byteLength(JSON.stringify(rows), "utf8"),
    },
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
const sharpSplitCaptureManifest = {
  release: NFL_SHARP_API_SPLIT_CAPTURE_MANIFEST_RELEASE,
  responseReceivedAt: capturedAt,
  rawResponseSha256: rawPriceSha256(splitSources),
  status: "observed" as const,
  failureReason: null,
  returnedRows: 2,
  matchedRows: 2,
  unmatchedRows: 0,
  ambiguousRows: 0,
  rows: ["circa", "draftkings"].map((sportsbook, rowIndex) => ({
    rowIndex,
    rawRowSha256: rawPriceSha256(sportsbook),
    disposition: "matched" as const,
    providerGameId: game.providerGameId,
    participant: sportsbook as "circa" | "draftkings",
  })),
};
const baseShadowArgs = {
  game, capture, independentForecast,
  authoritativeForecast,
  injuries: {
    eventId: game.providerGameId,
    awayTeam: game.away.abbreviation,
    homeTeam: game.home.abbreviation,
    source: "BALLDONTLIE" as const,
    sourceLabel: "BALLDONTLIE",
    sourceUrl: null,
    freshnessStatus: "current" as const,
    reportUpdatedAt: capturedAt,
    teams: [{
      abbreviation: game.away.abbreviation,
      teamName: game.away.name,
      players: [{
        name: "Fixture Receiver",
        status: "Questionable",
        detail: "hamstring",
        position: "WR",
        reportedAt: capturedAt,
      }],
    }],
  },
  weather: {
    venueTeam: game.home.abbreviation,
    venueName: "Fixture Stadium",
    roofType: "outdoor" as const,
    status: "forecast_available" as const,
    capturedAt,
    forecast: {
      forecast_for: game.scheduledStart,
      fetched_at: capturedAt,
      temperature_f: 49,
      feels_like_f: 45,
      humidity_pct: 65,
      precipitation_mm: 1.2,
      precipitation_probability: 0.4,
      wind_speed_mph: 17,
      wind_direction_degrees: 245,
      conditions: "Rain",
    },
  },
  independentForecastAvailableAt: capturedAt,
  independentForecastProvenance: "fresh" as const,
  independentPriorInputLineage: fixtureMarketBrainPriorInputLineage({
    eventId: game.providerGameId, asOf: capturedAt,
  }),
  retrievalCompletedAt: capturedAt,
  knownPriorArtifactSha256: [] as string[],
  rawPriceResponseManifests,
  sharpSplitSources: splitSources,
  sharpSplitCaptureManifest,
};

const shadow = buildNflMarketBrainShadow(baseShadowArgs);
const mismatchedReleaseManifests = structuredClone(rawPriceResponseManifests);
mismatchedReleaseManifests[0]!.observationsByGame[game.providerGameId]![0]!.sourceRelease =
  "forged-source-release";
assert.throws(() => buildNflMarketBrainShadow({
  ...baseShadowArgs,
  rawPriceResponseManifests: mismatchedReleaseManifests,
}), /observation provenance diverged/,
"a recomputed shadow must reject evidence whose source release diverges from its owning manifest");
const unchangedInputs = JSON.stringify({ capture, independentForecast, rawPriceResponseManifests, splitSources });
buildNflMarketBrainShadow(baseShadowArgs);
assert.equal(JSON.stringify({ capture, independentForecast, rawPriceResponseManifests, splitSources }), unchangedInputs, "shadow capture must not mutate source evidence");
assert.equal(shadow.case.release, MARKET_BRAIN_CONTRACT_RELEASE);
assert.equal(shadow.case.mode, "shadow_capture");
assert.ok(shadow.bytes > 0);
assert.equal(shadow.bytes, Buffer.byteLength(JSON.stringify(shadow)), "the persisted byte counter must include itself");
assert.equal(shadow.case.captureBoundary, "raw_provider_response");
assert.equal(shadow.case.sourceManifests.length, 5);
assert.deepEqual(
  [...new Set(shadow.case.sourceManifests.map((manifest) => manifest.release))].sort(),
  [
    BALLDONTLIE_NFL_RAW_PRICE_MANIFEST_RELEASE,
    FOOTBALL_SHARP_RAW_PRICE_MANIFEST_RELEASE,
    NFL_SHARP_API_SPLIT_CAPTURE_MANIFEST_RELEASE,
  ].sort(),
  "each research source manifest must bind its own exported sidecar release",
);
assert.equal(
  shadow.case.observations.find((row) => row.source.feed === "splits")?.audit.sourceRelease,
  NFL_SHARP_API_SPLIT_CAPTURE_MANIFEST_RELEASE,
);
assert.equal(shadow.case.evaluatedTargets.spread?.family, "draftkings");
assert.equal(shadow.case.accounting.providedObservations, shadow.case.accounting.retainedObservations);
assert.equal(shadow.case.invariants.allExpectedInputsAccounted, true);
assert.equal(shadow.case.invariants.allReturnedSourceRowsAccounted, true);
assert.equal(shadow.case.invariants.productionInfluenceAllowed, false);
assert.equal(shadow.case.invariants.displayContractAuthority, false);
assert.equal(shadow.case.blindSpots.length, 7);
assert.equal(NFL_MARKET_BRAIN_EVIDENCE_ROSTER.release, MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE);
assert.equal(
  shadow.case.expectedInputs.filter((row) => row.id.startsWith("price_feed:")).length,
  NFL_MARKET_BRAIN_EVIDENCE_ROSTER.feeds.length * 3,
  "every frozen expected feed must remain visible for every game market",
);
const injuryPlayer = shadow.case.observations.find((row) => row.source.feed === "injury_report_player");
assert.equal(injuryPlayer?.categorical.playerName, "Fixture Receiver");
assert.equal(injuryPlayer?.categorical.status, "Questionable");
const weatherObservation = shadow.case.observations.find((row) => row.source.feed === "venue_forecast");
assert.equal(weatherObservation?.values.wind_speed_mph?.value, 17);
assert.equal(weatherObservation?.categorical.conditions, "Rain");
const unrelatedRows = Array.from({ length: 500 }, (_, index) => ({
  rowIndex: index + 1,
  rawRowSha256: rawPriceSha256(["unrelated", index]),
  disposition: "matched" as const,
  providerGameId: `other-game-${index}`,
  sourceObservationIds: [] as string[],
}));
const noisyManifest = {
  ...rawPriceResponseManifests[0]!,
  returnedRows: rawPriceResponseManifests[0]!.returnedRows + unrelatedRows.length,
  matchedRows: rawPriceResponseManifests[0]!.matchedRows + unrelatedRows.length,
  rows: [...rawPriceResponseManifests[0]!.rows, ...unrelatedRows],
};
const noisyShadow = buildNflMarketBrainShadow({
  ...baseShadowArgs,
  rawPriceResponseManifests: [noisyManifest, ...rawPriceResponseManifests.slice(1)],
});
assert.ok(noisyShadow.bytes - shadow.bytes < 256,
  "unrelated slate rows must be represented by digest/accounting, not copied into every game tape");
assert.equal(noisyShadow.case.sourceManifests[0]?.omittedRows, 500);
assert.equal(shadow.case.prior.kind, "margin_total_distribution");
assert.equal(shadow.case.prior.kind === "margin_total_distribution" && shadow.case.prior.artifact.eventId, game.providerGameId);
assert.equal(shadow.case.prior.kind === "margin_total_distribution" &&
  shadow.case.prior.artifact.marginDistribution.values.length > 2, true);
assert.equal(shadow.case.prior.kind === "margin_total_distribution" && shadow.case.prior.artifact.sha256.length, 64);
const priorArtifactSha256 = shadow.case.prior.kind === "margin_total_distribution" ? shadow.case.prior.artifact.sha256 : "";
const laterCapture = structuredClone(capture);
laterCapture.capturedAt = "2026-10-26T20:30:00.000Z";
laterCapture.context.quarterbacks.home = ["qb-home", "Fixture Quarterback", "confirmed",
  "2026-10-26T20:15:00.000Z"];
const laterShadow = buildNflMarketBrainShadow({
  ...baseShadowArgs,
  capture: laterCapture,
  retrievalCompletedAt: "2026-10-26T20:30:00.000Z",
  knownPriorArtifactSha256: [priorArtifactSha256],
  sharpSplitCaptureManifest: {
    ...sharpSplitCaptureManifest,
    responseReceivedAt: "2026-10-26T20:30:00.000Z",
  },
});
const newsSequence = materializeNflMarketBrainSequence({
  cases: [shadow.case, laterShadow.case], cutoffAt: "2026-10-26T20:30:00.000Z",
});
const newsFeatures = buildNflMarketBrainResolverFeatures(newsSequence);
assert.equal(newsFeatures.contextTokens.filter((row) =>
  row.feed === "depth_chart" && row.participant === "home").length, 2,
"a quarterback status change across captures must survive as a time-versioned news sequence");
const newsVector = vectorizeNflMarketBrainTrainerInput(nflMarketBrainTrainerInput(newsFeatures));
assert.equal(newsVector.values[newsVector.names.indexOf("home_quarterback_observed")], 1,
  "the latest quarterback state must enter the executable learned vector");
assert.equal(newsVector.values[newsVector.names.indexOf("wind_speed_mph")], 17,
  "numeric weather context must enter the executable learned vector rather than remain audit-only");
const referencedShadow = buildNflMarketBrainShadow({
  ...baseShadowArgs, knownPriorArtifactSha256: [priorArtifactSha256],
});
assert.equal(referencedShadow.case.prior.kind, "margin_total_distribution_ref");
assert.equal(referencedShadow.case.prior.kind === "margin_total_distribution_ref" &&
  referencedShadow.case.prior.artifactSha256, priorArtifactSha256);
const forgedLineageReference = structuredClone(referencedShadow.case);
if (forgedLineageReference.prior.kind !== "margin_total_distribution_ref") throw new Error("fixture reference missing");
forgedLineageReference.prior.inputLineageSha256 = "f".repeat(64);
assert.throws(() => materializeNflMarketBrainSequence({
  cases: [shadow.case, forgedLineageReference], cutoffAt: capturedAt,
}), /prior reference diverged/,
"a prior reference cannot substitute a different input lineage for the content-addressed artifact");
assert.ok(shadow.bytes - referencedShadow.bytes > 100,
  "later captures must reference the immutable prior rather than duplicating its PMF bytes");
const corruptedPrior = structuredClone(shadow.case);
if (corruptedPrior.prior.kind === "margin_total_distribution") corruptedPrior.prior.artifact.marginDistribution.probabilities[0] = 0.4;
assert.throws(
  () => buildNflMarketBrainShadow({ ...baseShadowArgs, independentForecast: corruptedPrior.prior.kind === "margin_total_distribution" ? {
    marginDistribution: corruptedPrior.prior.artifact.marginDistribution,
    totalDistribution: corruptedPrior.prior.artifact.totalDistribution,
  } : null }),
  /distribution mass|diverged/,
  "a mutated prior PMF must fail closed instead of being reconstructed from its mean",
);
assert.throws(
  () => buildNflMarketBrainShadow({ ...baseShadowArgs, independentForecast: null }),
  /missing its exact distribution artifact/,
  "an available prior summary without exact PMF bytes must fail closed",
);
assert.equal(shadow.case.expectedInputs.find((row) => row.id === "availability:injury_report")?.availability, "observed");
assert.equal(shadow.case.observations.find((row) => row.source.feed === "venue_forecast")?.categorical.status,
  "forecast_available");

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
  id: "price:moneyline:sharpapi:pinnacle", market: "moneyline", modality: "price_quote", provider: "sharpapi", participant: "pinnacle",
  expectation: "required", availability: "unavailable", observationIds: [], reason: "expected_participant_not_returned",
}, "a missing required price source must remain visible in the manifest");
assert.deepEqual(shadow.case.expectedInputs.find((row) =>
  row.id === "price_feed:moneyline:sharpapi:main_odds:pinnacle"), {
  id: "price_feed:moneyline:sharpapi:main_odds:pinnacle", market: "moneyline", modality: "price_quote",
  provider: "sharpapi", participant: "pinnacle", expectation: "required", availability: "unavailable",
  observationIds: [], reason: "expected_feed_manifest_missing",
}, "an expected feed must not disappear when its entire provider response is absent");
assert.deepEqual(shadow.case.expectedInputs.find((row) =>
  row.id === "price:moneyline:balldontlie:fanduel"), {
  id: "price:moneyline:balldontlie:fanduel", market: "moneyline", modality: "price_quote",
  provider: "balldontlie", participant: "fanduel", expectation: "opportunistic", availability: "unavailable",
  observationIds: [], reason: "expected_participant_not_returned",
}, "an approved participant omitted from a response must remain explicit");

const missingCurrentFeedShadow = buildNflMarketBrainShadow({
  ...baseShadowArgs,
  rawPriceResponseManifests: rawPriceResponseManifests.filter((manifest) =>
    !(manifest.provider === "balldontlie" && manifest.feed === "current_odds")),
});
const missingCurrentFeed = missingCurrentFeedShadow.case.expectedInputs.find((row) =>
  row.id === "price_feed:spread:balldontlie:current_odds:all");
assert.deepEqual(missingCurrentFeed && {
  availability: missingCurrentFeed.availability,
  reason: missingCurrentFeed.reason,
}, {
  availability: "unavailable", reason: "expected_feed_manifest_missing",
}, "removing a whole expected feed must produce explicit missingness rather than erase the expectation");

const failedPinnacleManifest: FootballRawPriceResponseManifest = {
  release: FOOTBALL_SHARP_RAW_PRICE_MANIFEST_RELEASE,
  provider: "sharpapi",
  feed: "main_odds",
  participant: "pinnacle",
  providerFetchedAt: capturedAt,
  rawResponseSha256: null,
  rawParserInput: null,
  returnedRows: 0,
  matchedRows: 0,
  unmatchedRows: 0,
  ambiguousRows: 0,
  rows: [],
  failed: true,
  failureReason: "fixture_provider_timeout",
  observationsByGame: {},
};
const failedPinnacleShadow = buildNflMarketBrainShadow({
  ...baseShadowArgs,
  rawPriceResponseManifests: [...rawPriceResponseManifests, failedPinnacleManifest],
});
const failedPinnacleFeed = failedPinnacleShadow.case.expectedInputs.find((row) =>
  row.id === "price_feed:total:sharpapi:main_odds:pinnacle");
assert.deepEqual(failedPinnacleFeed && {
  availability: failedPinnacleFeed.availability,
  reason: failedPinnacleFeed.reason,
}, {
  availability: "unavailable", reason: "fixture_provider_timeout",
}, "a provider failure must remain distinct from an omitted event market");
assert.ok(shadow.case.observations.every((row) => row.timing.availableAt.length > 0),
  "every observation must carry a replay-safe availability time");
assert.ok(shadow.case.observations.every((row) => !["leader", "follower", "resistor", "reversal"].includes(row.observedRole)),
  "a single snapshot cannot invent market sequence roles");
assert.deepEqual(nflMarketBrainCaptureFailure({ eventId: game.providerGameId, capturedAt, error: new Error("fixture") }), {
  release: shadow.release, contractRelease: MARKET_BRAIN_CONTRACT_RELEASE,
  status: "capture_failed", productionApplied: false,
  eventId: game.providerGameId, capturedAt, reason: "fixture",
}, "shadow capture failures must remain explicit without gaining production authority");

console.log("NFL Market Brain raw-provider tape: individual sides, response manifests, opposing splits, replay-safe time, explicit missingness, and no-authority gate passed");
