import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyCfbCompleteMarketReader,
  CFB_COMPLETE_MARKET_READER_ARTIFACT_RELEASE,
  CFB_COMPLETE_MARKET_READER_RELEASE,
} from "../lib/services/football/cfbCompleteMarketReader";
import type { CfbForwardMarketReaderObservation } from "../lib/services/football/cfbForwardEvidenceCapture";
import {
  summarizePmf,
  tiltCfbMarginWithinTotals,
  tiltCfbTotalWithinMargins,
} from "../lib/services/football/cfbMarketSharpAwareShadow";
import type { CfbV1Forecast } from "../lib/services/football/cfbV1Decision";
import { CFB_SHARP_API_SPLITS_RELEASE } from "../lib/services/football/cfbSharpApiSplits";

const pmf = [
  { home: 17, away: 14, probability: 0.08 },
  { home: 21, away: 17, probability: 0.12 },
  { home: 24, away: 20, probability: 0.18 },
  { home: 27, away: 20, probability: 0.18 },
  { home: 28, away: 24, probability: 0.16 },
  { home: 31, away: 24, probability: 0.12 },
  { home: 34, away: 27, probability: 0.08 },
  { home: 24, away: 27, probability: 0.04 },
  { home: 20, away: 24, probability: 0.04 },
];
const summary = summarizePmf(pmf);
const forecast: CfbV1Forecast = {
  providerGameId: "reader-test",
  awayTeam: "AWY",
  homeTeam: "HME",
  gameStartsAt: "2026-10-10T23:00:00.000Z",
  ...summary,
  pmf,
};
const landmark = (
  observedAt: string,
  line: number | null,
  firstPrice: number,
  secondPrice: number,
) => [observedAt, 30, "f", line, firstPrice, secondPrice] as const;
const observation = (
  allowed: string[],
  fallbackTotal = false,
  spreadOpening = 3,
  spreadCurrent = 6,
): CfbForwardMarketReaderObservation => ({
  capturedAt: "2026-10-10T22:00:00.000Z",
  markets: {
    moneyline: {
      families: [[
        "circa", "s", "c", null,
        landmark("2026-10-10T12:00:00.000Z", null, 145, -165),
        landmark("2026-10-10T22:00:00.000Z", null, 175, -205),
      ]],
      targetExcludedFamilies: allowed,
    },
    spread: {
      families: [[
        "circa", "s", "c", null,
        landmark("2026-10-10T12:00:00.000Z", spreadOpening, -110, -110),
        landmark("2026-10-10T22:00:00.000Z", spreadCurrent, -110, -110),
      ]],
      targetExcludedFamilies: allowed,
    },
    total: {
      families: [[
        "circa", "s", "c", null,
        landmark("2026-10-10T12:00:00.000Z", 48, -110, -110),
        landmark("2026-10-10T22:00:00.000Z", 55, -110, -110),
      ]],
      targetExcludedFamilies: allowed,
    },
  },
  playbookSplits: null,
  sharpApiSplits: fallbackTotal ? [{
    release: CFB_SHARP_API_SPLITS_RELEASE,
    providerGameId: "reader-test",
    providerEventId: "reader-test-event",
    sportsbook: "draftkings",
    sourceSemantics: "public_recreational",
    capturedAt: "2026-10-10T22:00:00.000Z",
    moneyline: null,
    spread: null,
    total: {
      line: 48,
      over: { moneyPct: 65, ticketsPct: 55 },
      under: { moneyPct: 35, ticketsPct: 45 },
    },
  }] : [],
});
const common = {
  forecast,
  independentForecast: forecast,
  histories: [],
  kickoffAt: forecast.gameStartsAt,
  awayFbs: true,
  homeFbs: true,
  awayConferenceId: 1,
  homeConferenceId: 2,
  evaluatedLines: { homeSpread: -3, total: 48 },
};

const excluded = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation([]),
});
assert.equal(excluded.marginEvidenceAvailable, false);
assert.equal(excluded.totalEvidenceAvailable, false);
assert.ok(Math.abs(excluded.marginShiftPoints) < 1e-9);
assert.ok(Math.abs(excluded.totalShiftPoints) < 1e-9);
const formerlyExcludedNowEvaluated = observation(["circa"]);
const historicalSelfQuote = applyCfbCompleteMarketReader({
  ...common,
  evaluatedSportsbooks: { moneyline: "circa", spread: "circa", total: "circa" },
  histories: [{
    capturedAt: formerlyExcludedNowEvaluated.capturedAt,
    payload: {
      contextualEvidenceCapture: { markets: formerlyExcludedNowEvaluated.markets },
      market: { playbookSplits: null, sharpApiSplits: [] },
    },
  } as never],
  currentObservation: observation([]),
});
assert.ok(Math.abs(historicalSelfQuote.marginShiftPoints) < 1e-9 &&
  Math.abs(historicalSelfQuote.totalShiftPoints) < 1e-9,
"a historical quote must be re-excluded when its sportsbook is today's evaluated target");
const baseAdjustedPmf = tiltCfbTotalWithinMargins(
  tiltCfbMarginWithinTotals(forecast.pmf, 2), -3,
);
const baseAdjustedForecast: CfbV1Forecast = {
  ...forecast, ...summarizePmf(baseAdjustedPmf), pmf: baseAdjustedPmf,
};
const absentMarketWithPriorAdjustments = applyCfbCompleteMarketReader({
  ...common,
  forecast: baseAdjustedForecast,
  independentForecast: forecast,
  currentObservation: observation([]),
});
assert.ok(Math.abs(absentMarketWithPriorAdjustments.forecast.expectedMarginHome -
  baseAdjustedForecast.expectedMarginHome) < 1e-8,
"missing market evidence must not erase the base model's already-applied margin adjustment");
assert.ok(Math.abs(absentMarketWithPriorAdjustments.forecast.expectedTotal -
  baseAdjustedForecast.expectedTotal) < 1e-8,
"missing market evidence must not erase the base model's already-applied Total adjustment");

const independent = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation(["circa"]),
});
assert.equal(independent.marginEvidenceAvailable, true);
assert.equal(independent.totalEvidenceAvailable, false);
assert.ok(Math.abs(independent.marginShiftPoints) > 1e-6, "target-excluded movement must be allowed to move the score axis");
assert.ok(Math.abs(independent.forecast.expectedMarginHome -
  (independent.forecast.expectedHomePoints - independent.forecast.expectedAwayPoints)) < 1e-9);
assert.ok(Math.abs(independent.forecast.expectedTotal -
  (independent.forecast.expectedHomePoints + independent.forecast.expectedAwayPoints)) < 1e-9);
assert.ok(Math.abs(independent.forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0) - 1) < 1e-9);
assert.ok(independent.forecast.expectedAwayPoints >= 0 && independent.forecast.expectedHomePoints >= 0);

const staticConsensus = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation(["circa"], false, 6, 6),
});
const namedOnly = observation(["circa", "pinnacle"]);
namedOnly.markets.moneyline.targetExcludedFamilies = [];
namedOnly.markets.total.targetExcludedFamilies = [];
namedOnly.markets.spread.families = ["circa", "pinnacle"].map((source) => [
  source, "s", "c", null,
  landmark("2026-10-10T12:00:00.000Z", -3, -110, -110),
  landmark("2026-10-10T22:00:00.000Z", -3, -110, -110),
] as CfbForwardMarketReaderObservation["markets"]["spread"]["families"][number]);
const retailMajority = structuredClone(namedOnly);
for (let index = 0; index < 5; index += 1) {
  const source = `retail${index}`;
  retailMajority.markets.spread.families.push([
    source, "s", "c", null,
    landmark("2026-10-10T12:00:00.000Z", -10, -110, -110),
    landmark("2026-10-10T22:00:00.000Z", -10, -110, -110),
  ]);
  retailMajority.markets.spread.targetExcludedFamilies.push(source);
}
const namedOnlyResult = applyCfbCompleteMarketReader({ ...common, currentObservation: namedOnly });
const retailMajorityResult = applyCfbCompleteMarketReader({ ...common, currentObservation: retailMajority });
assert.ok(Math.abs(namedOnlyResult.forecast.expectedMarginHome -
  retailMajorityResult.forecast.expectedMarginHome) < 1e-9,
"retail book count cannot overrule two named books at a different spread number");
assert.equal(staticConsensus.marginEvidenceAvailable, true);
assert.ok(
  Math.abs(staticConsensus.marginShiftPoints) > 1e-6,
  "a static target-excluded consensus must retain authority without movement or splits",
);

const keyThreeUpset = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation(["circa"], false, 3, 3),
});
assert.ok(
  Math.abs(keyThreeUpset.forecast.expectedMarginHome - forecast.expectedMarginHome) < 1e-9,
  "an independent upset must survive the empirically retained football key-three band",
);
assert.match(CFB_COMPLETE_MARKET_READER_RELEASE, /r7_exact_source_named_total_economics/);
assert.equal(CFB_COMPLETE_MARKET_READER_ARTIFACT_RELEASE, "cfb_market_reader_artifact_2026_10_11_r5_consensus_authority_split_specialization");
const artifact = JSON.parse(readFileSync(
  new URL("../lib/services/football/modelArtifacts/cfbCompleteMarketReaderArtifact.json", import.meta.url),
  "utf8",
)) as {
  margin: { baseConsensusAuthority: number; minimumResolvedSpreadEdgePoints: number };
  total: { splitProvenance: string; reflectionAuthority: number };
};
assert.equal(artifact.margin.baseConsensusAuthority, 0.5);
assert.equal(artifact.margin.minimumResolvedSpreadEdgePoints, 1);
assert.equal(artifact.total.splitProvenance, "fallback");
assert.equal(artifact.total.reflectionAuthority, 1);

const totalReflection = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation(["circa"], true),
});
assert.equal(totalReflection.totalEvidenceAvailable, true);
assert.equal(totalReflection.totalSideFlipped, true);
assert.ok(totalReflection.forecast.expectedTotal > 48, "fallback Total flow must be able to reflect an Under baseline to Over");
assert.ok(Math.abs(totalReflection.forecast.expectedTotal -
  (totalReflection.forecast.expectedHomePoints + totalReflection.forecast.expectedAwayPoints)) < 1e-9);
const reflectedOverProbability = totalReflection.forecast.pmf.reduce((sum, cell) => {
  const total = cell.home + cell.away;
  return sum + (total > 48 ? cell.probability : total === 48 ? 0.5 * cell.probability : 0);
}, 0);
assert.ok(
  reflectedOverProbability > 0.5,
  "the final PMF—not only its mean score—must agree with the fallback Total read",
);

for (const [caseName, mutate] of [
  ["wrong total line", (sample: CfbForwardMarketReaderObservation) => {
    sample.sharpApiSplits![0]!.total!.line = 47.5;
  }],
  ["stale capture", (sample: CfbForwardMarketReaderObservation) => {
    sample.sharpApiSplits![0]!.capturedAt = "2026-10-10T18:00:00.000Z";
  }],
  ["past the SharpAPI 120-minute freshness boundary", (sample: CfbForwardMarketReaderObservation) => {
    sample.sharpApiSplits![0]!.capturedAt = "2026-10-10T19:59:00.000Z";
  }],
  ["future capture", (sample: CfbForwardMarketReaderObservation) => {
    sample.sharpApiSplits![0]!.capturedAt = "2026-10-10T22:01:00.000Z";
  }],
] as const) {
  const sample = observation(["circa"], true);
  mutate(sample);
  const result = applyCfbCompleteMarketReader({ ...common, currentObservation: sample });
  assert.equal(result.totalEvidenceAvailable, false, `${caseName} cannot control the evaluated Total`);
  assert.ok(Math.abs(result.totalShiftPoints) < 1e-9, `${caseName} must not move the Total score`);
}
const evaluatedBookFlow = applyCfbCompleteMarketReader({
  ...common,
  evaluatedSportsbooks: { total: "DraftKings" },
  currentObservation: observation(["circa"], true),
});
assert.equal(evaluatedBookFlow.totalEvidenceAvailable, false,
  "the evaluated sportsbook's own split cannot independently validate its Total quote");
assert.ok(Math.abs(evaluatedBookFlow.totalShiftPoints) < 1e-9);

const namedPriceOnlyObservation = observation(["circa", "pinnacle"]);
namedPriceOnlyObservation.markets.total.families = ["circa", "pinnacle"].map((source) => [
  source, "s", "c", null,
  landmark("2026-10-10T12:00:00.000Z", 48, -110, -110),
  landmark("2026-10-10T22:00:00.000Z", 48, -125, 105),
] as CfbForwardMarketReaderObservation["markets"]["total"]["families"][number]);
const replaceTotalCurrent = (
  sample: CfbForwardMarketReaderObservation,
  replacement: (source: string) => ReturnType<typeof landmark>,
): CfbForwardMarketReaderObservation => {
  const changed = structuredClone(sample);
  changed.markets.total.families = changed.markets.total.families.map((family) => [
    family[0], family[1], family[2], family[3], family[4], replacement(family[0]),
  ] as CfbForwardMarketReaderObservation["markets"]["total"]["families"][number]);
  return changed;
};
const namedPriceOnly = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: namedPriceOnlyObservation,
});
assert.equal(namedPriceOnly.totalEvidenceAvailable, true);
assert.equal(namedPriceOnly.totalEvidenceRoute, "named_economic_path");
assert.equal(namedPriceOnly.namedTotalStatus, "applied");
assert.ok(namedPriceOnly.totalShiftPoints > 0,
  "two independent named books moving Over price at a fixed Total must update the coherent score distribution");
assert.ok(Math.abs(namedPriceOnly.forecast.expectedTotal -
  (namedPriceOnly.forecast.expectedHomePoints + namedPriceOnly.forecast.expectedAwayPoints)) < 1e-9);
const namedPriceOnlyUnderObservation = replaceTotalCurrent(namedPriceOnlyObservation,
  () => landmark("2026-10-10T22:00:00.000Z", 48, 105, -125));
const namedPriceOnlyUnder = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: namedPriceOnlyUnderObservation,
});
assert.ok(namedPriceOnlyUnder.totalShiftPoints < 0,
  "a fixed-line named Under price move must affect the score in the opposite direction");
const splitResistsNamed = structuredClone(namedPriceOnlyUnderObservation);
splitResistsNamed.sharpApiSplits = observation(["circa"], true).sharpApiSplits;
const splitResistanceResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: splitResistsNamed,
});
assert.equal(splitResistanceResult.totalEvidenceRoute, "named_economic_path");
assert.ok(splitResistanceResult.totalShiftPoints < 0,
  "fallback Over money-ticket divergence cannot force an Over score against aligned named Under prices");
const firstPriceLeg = replaceTotalCurrent(namedPriceOnlyObservation,
  () => landmark("2026-10-10T21:00:00.000Z", 48, -125, 105));
firstPriceLeg.capturedAt = "2026-10-10T21:00:00.000Z";
const reversedNamedPrice = applyCfbCompleteMarketReader({
  ...common,
  histories: [{
    capturedAt: firstPriceLeg.capturedAt,
    payload: {
      contextualEvidenceCapture: { markets: firstPriceLeg.markets },
      market: { playbookSplits: null, sharpApiSplits: [] },
    },
  } as never],
  currentObservation: namedPriceOnlyUnderObservation,
});
assert.equal(reversedNamedPrice.namedTotalStatus, "reversal",
  "an observed Over-then-Under buyback is not a persistent named-book direction");
assert.ok(Math.abs(reversedNamedPrice.totalShiftPoints) < 1e-9);

const opposedNamedPrice = replaceTotalCurrent(namedPriceOnlyObservation, (source) =>
  source === "pinnacle"
    ? landmark("2026-10-10T22:00:00.000Z", 48, 105, -125)
    : landmark("2026-10-10T22:00:00.000Z", 48, -125, 105));
const opposedNamedResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: opposedNamedPrice,
});
assert.equal(opposedNamedResult.totalEvidenceAvailable, false,
  "opposing named-book price paths are disagreement, not a commanded Total flip");
assert.equal(opposedNamedResult.namedTotalStatus, "source_conflict");
assert.ok(Math.abs(opposedNamedResult.totalShiftPoints) < 1e-9);
const conflictedNamedWithFallback = structuredClone(opposedNamedPrice);
conflictedNamedWithFallback.sharpApiSplits = observation(["circa"], true).sharpApiSplits;
const conflictedWithFallbackResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: conflictedNamedWithFallback,
});
assert.equal(conflictedWithFallbackResult.namedTotalStatus, "source_conflict");
assert.equal(conflictedWithFallbackResult.totalEvidenceRoute, "independent");
assert.ok(Math.abs(conflictedWithFallbackResult.totalShiftPoints) < 1e-9,
  "a fallback split cannot silently resolve opposing named-book Total paths into a score move");
const flatNamedWithFlow = replaceTotalCurrent(namedPriceOnlyObservation,
  () => landmark("2026-10-10T22:00:00.000Z", 48, -110, -110));
flatNamedWithFlow.sharpApiSplits = observation(["circa"], true).sharpApiSplits;
const heldPriceFlowResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: flatNamedWithFlow,
});
assert.equal(heldPriceFlowResult.namedTotalStatus, "flat");
assert.equal(heldPriceFlowResult.totalEvidenceRoute, "independent");
assert.ok(Math.abs(heldPriceFlowResult.totalShiftPoints) < 1e-9,
  "public Over money against a held named Total price is resistance, not a commanded Over score");
const oneNamedLead = replaceTotalCurrent(namedPriceOnlyObservation, (source) =>
  source === "circa"
    ? landmark("2026-10-10T22:00:00.000Z", 48, -125, 105)
    : landmark("2026-10-10T22:00:00.000Z", 48, -110, -110));
const oneNamedLeadResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: oneNamedLead,
});
assert.equal(oneNamedLeadResult.namedTotalStatus, "partial_named_move",
  "a single named-book lead must be recorded distinctly from a genuinely flat market");
assert.ok(Math.abs(oneNamedLeadResult.totalShiftPoints) < 1e-9);
const partialLeadWithFlow = structuredClone(oneNamedLead);
partialLeadWithFlow.sharpApiSplits = observation(["circa"], true).sharpApiSplits;
const partialLeadFlowResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: partialLeadWithFlow,
});
assert.equal(partialLeadFlowResult.totalEvidenceRoute, "independent");
assert.ok(Math.abs(partialLeadFlowResult.totalShiftPoints) < 1e-9,
  "one named-book lead plus public flow is not equivalent to aligned named-book price discovery");
const selfEvaluatedNamedPrice = applyCfbCompleteMarketReader({
  ...common,
  evaluatedSportsbooks: { total: "circa" },
  currentObservation: namedPriceOnlyObservation,
});
assert.equal(selfEvaluatedNamedPrice.totalEvidenceAvailable, false,
  "one remaining named book cannot manufacture a two-source price-only Total read");
assert.equal(selfEvaluatedNamedPrice.namedTotalStatus, "insufficient");

const namedNumberMove = replaceTotalCurrent(namedPriceOnlyObservation,
  () => landmark("2026-10-10T22:00:00.000Z", 52, -110, -110));
const namedNumberResult = applyCfbCompleteMarketReader({
  ...common,
  evaluatedLines: { ...common.evaluatedLines, total: 52 },
  currentObservation: namedNumberMove,
});
assert.equal(namedNumberResult.totalEvidenceAvailable, true);
assert.ok(namedNumberResult.totalShiftPoints > 0,
  "an aligned named number move at unchanged juice must be normalized across the two quoted Total contracts");
const compensatedNumberMove = replaceTotalCurrent(namedNumberMove,
  () => landmark("2026-10-10T22:00:00.000Z", 52, 130, -150));
const compensatedResult = applyCfbCompleteMarketReader({
  ...common,
  evaluatedLines: { ...common.evaluatedLines, total: 52 },
  currentObservation: compensatedNumberMove,
});
assert.ok(compensatedResult.totalShiftPoints > 0 &&
  compensatedResult.totalShiftPoints < namedNumberResult.totalShiftPoints,
"a higher Total with cheaper Over price must be read as one partially compensated move, not two independent Over votes");
const opposedNumberMove = replaceTotalCurrent(namedNumberMove, (source) =>
  landmark("2026-10-10T22:00:00.000Z", source === "pinnacle" ? 48 : 52, -110, -110));
const opposedNumberResult = applyCfbCompleteMarketReader({
  ...common,
  evaluatedLines: { ...common.evaluatedLines, total: 52 },
  currentObservation: opposedNumberMove,
});
assert.equal(opposedNumberResult.totalEvidenceAvailable, false,
  "one named number move and one flat quote cannot form a false consensus");
assert.equal(opposedNumberResult.namedTotalStatus, "partial_named_move");
const differingAlignedNumbers = replaceTotalCurrent(namedNumberMove, (source) =>
  landmark("2026-10-10T22:00:00.000Z", source === "pinnacle" ? 51 : 52, -110, -110));
const differingAlignedResult = applyCfbCompleteMarketReader({
  ...common,
  evaluatedLines: { ...common.evaluatedLines, total: 52 },
  currentObservation: differingAlignedNumbers,
});
assert.equal(differingAlignedResult.namedTotalStatus, "applied");
assert.ok(differingAlignedResult.totalShiftPoints > 0,
  "two aligned named number moves at different quoted lines must be normalized before adjusting the evaluated score");

const namedSidePrice = observation(["circa", "pinnacle"], false, 3, 3);
namedSidePrice.markets.moneyline.families = ["circa", "pinnacle"].map((source) => [
  source, "s", "c", null,
  landmark("2026-10-10T12:00:00.000Z", null, 145, -165),
  landmark("2026-10-10T22:00:00.000Z", null, 175, -205),
] as CfbForwardMarketReaderObservation["markets"]["moneyline"]["families"][number]);
namedSidePrice.markets.spread.families = ["circa", "pinnacle"].map((source) => [
  source, "s", "c", null,
  landmark("2026-10-10T12:00:00.000Z", -3, -110, -110),
  landmark("2026-10-10T22:00:00.000Z", -3, -100, -120),
] as CfbForwardMarketReaderObservation["markets"]["spread"]["families"][number]);
const namedSidePriceResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: namedSidePrice,
});
assert.equal(namedSidePriceResult.namedMarginStatus, "applied");
const flatSidePrice = structuredClone(namedSidePrice);
flatSidePrice.markets.moneyline.families = flatSidePrice.markets.moneyline.families.map((family) => [
  family[0], family[1], family[2], family[3], family[4],
  landmark("2026-10-10T22:00:00.000Z", null, 145, -165),
] as CfbForwardMarketReaderObservation["markets"]["moneyline"]["families"][number]);
flatSidePrice.markets.spread.families = flatSidePrice.markets.spread.families.map((family) => [
  family[0], family[1], family[2], family[3], family[4],
  landmark("2026-10-10T22:00:00.000Z", -3, -110, -110),
] as CfbForwardMarketReaderObservation["markets"]["spread"]["families"][number]);
const flatSidePriceResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: flatSidePrice,
});
assert.equal(flatSidePriceResult.namedMarginStatus, "flat");
assert.ok(namedSidePriceResult.forecast.expectedMarginHome > flatSidePriceResult.forecast.expectedMarginHome,
  "aligned fixed-line named Spread and ML repricing must affect the coherent margin PMF");
const moneylineOnlyPrice = structuredClone(namedSidePrice);
moneylineOnlyPrice.markets.spread.targetExcludedFamilies = [];
const moneylineOnlyResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: moneylineOnlyPrice,
});
assert.equal(moneylineOnlyResult.namedMarginStatus, "applied");
assert.equal(moneylineOnlyResult.marginEvidenceAvailable, true,
  "a valid named ML price path must not be mislabeled as unavailable merely because Spread consensus is absent");
const opposedSidePrice = structuredClone(namedSidePrice);
opposedSidePrice.markets.moneyline.families = opposedSidePrice.markets.moneyline.families.map((family) => [
  family[0], family[1], family[2], family[3], family[4],
  landmark("2026-10-10T22:00:00.000Z", null, 115, -135),
] as CfbForwardMarketReaderObservation["markets"]["moneyline"]["families"][number]);
const opposedSideResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: opposedSidePrice,
});
assert.equal(opposedSideResult.namedMarginStatus, "source_conflict",
  "opposing ML and Spread price-only paths cannot be counted as one side signal");
assert.ok(Math.abs(opposedSideResult.forecast.expectedMarginHome -
  forecast.expectedMarginHome) < 1e-9,
"opposing named paths must be adjudicated before the consensus changes the score");
const splitNamedSpread = structuredClone(namedSidePrice);
splitNamedSpread.markets.spread.families = splitNamedSpread.markets.spread.families.map((family) => [
  family[0], family[1], family[2], family[3], family[4],
  landmark("2026-10-10T22:00:00.000Z", -3,
    family[0] === "circa" ? -100 : -120,
    family[0] === "circa" ? -120 : -100),
] as CfbForwardMarketReaderObservation["markets"]["spread"]["families"][number]);
const splitNamedSpreadResult = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: splitNamedSpread,
});
assert.equal(splitNamedSpreadResult.namedMarginStatus, "source_conflict",
  "named Spread books disagreeing internally must block an otherwise aligned ML price update");
assert.ok(Math.abs(splitNamedSpreadResult.forecast.expectedMarginHome -
  forecast.expectedMarginHome) < 1e-9,
"a conflicted named side story must not silently move the final score");
const namedSpreadNumber = structuredClone(namedSidePrice);
const numberPmf: CfbV1Forecast["pmf"] = [
  { home: 30, away: 20, probability: 0.2 },
  { home: 27, away: 23, probability: 0.2 },
  { home: 26, away: 24, probability: 0.2 },
  { home: 24, away: 26, probability: 0.2 },
  { home: 20, away: 30, probability: 0.2 },
];
const numberForecast: CfbV1Forecast = {
  ...forecast, ...summarizePmf(numberPmf), pmf: numberPmf,
};
namedSpreadNumber.markets.moneyline.targetExcludedFamilies = [];
namedSpreadNumber.markets.spread.families = namedSpreadNumber.markets.spread.families.map((family) => [
  family[0], family[1], family[2], family[3], family[4],
  landmark("2026-10-10T22:00:00.000Z", -4, -110, -110),
] as CfbForwardMarketReaderObservation["markets"]["spread"]["families"][number]);
const namedSpreadNumberResult = applyCfbCompleteMarketReader({
  ...common,
  forecast: numberForecast,
  independentForecast: numberForecast,
  evaluatedLines: { ...common.evaluatedLines, homeSpread: -4 },
  currentObservation: namedSpreadNumber,
});
assert.equal(namedSpreadNumberResult.namedMarginStatus, "applied",
  "aligned named Spread number moves at the evaluated contract must have score authority");
const flatSpreadNumber = structuredClone(namedSpreadNumber);
flatSpreadNumber.markets.spread.families = flatSpreadNumber.markets.spread.families.map((family) => [
  family[0], family[1], family[2], family[3],
  landmark("2026-10-10T12:00:00.000Z", -4, -110, -110), family[5],
] as CfbForwardMarketReaderObservation["markets"]["spread"]["families"][number]);
const flatSpreadNumberResult = applyCfbCompleteMarketReader({
  ...common,
  forecast: numberForecast,
  independentForecast: numberForecast,
  evaluatedLines: { ...common.evaluatedLines, homeSpread: -4 },
  currentObservation: flatSpreadNumber,
});
assert.equal(flatSpreadNumberResult.namedMarginStatus, "flat");
assert.ok(Math.abs(namedSpreadNumberResult.forecast.expectedMarginHome -
  flatSpreadNumberResult.forecast.expectedMarginHome) > 1e-6,
"a moved named Spread contract must change the unified score, not merely receive a movement label");
const differingNamedSpreadNumbers = structuredClone(namedSpreadNumber);
differingNamedSpreadNumbers.markets.spread.families = differingNamedSpreadNumbers.markets.spread.families.map((family) => [
  family[0], family[1], family[2], family[3], family[4],
  landmark("2026-10-10T22:00:00.000Z", family[0] === "circa" ? -4 : -5, -110, -110),
] as CfbForwardMarketReaderObservation["markets"]["spread"]["families"][number]);
const differingNamedSpreadResult = applyCfbCompleteMarketReader({
  ...common,
  forecast: numberForecast,
  independentForecast: numberForecast,
  evaluatedLines: { ...common.evaluatedLines, homeSpread: -4 },
  currentObservation: differingNamedSpreadNumbers,
});
assert.equal(differingNamedSpreadResult.namedMarginStatus, "applied",
  "aligned named Spread moves at different current lines must normalize to one coherent margin read");
assert.ok(differingNamedSpreadResult.forecast.expectedMarginHome > numberForecast.expectedMarginHome);
const compensatedSpreadNumber = structuredClone(namedSpreadNumber);
compensatedSpreadNumber.markets.spread.families = compensatedSpreadNumber.markets.spread.families.map((family) => [
  family[0], family[1], family[2], family[3], family[4],
  landmark("2026-10-10T22:00:00.000Z", -4, -120, 100),
] as CfbForwardMarketReaderObservation["markets"]["spread"]["families"][number]);
const compensatedSpreadResult = applyCfbCompleteMarketReader({
  ...common,
  forecast: numberForecast,
  independentForecast: numberForecast,
  evaluatedLines: { ...common.evaluatedLines, homeSpread: -4 },
  currentObservation: compensatedSpreadNumber,
});
assert.ok(compensatedSpreadResult.forecast.expectedMarginHome >
  numberForecast.expectedMarginHome &&
  compensatedSpreadResult.forecast.expectedMarginHome <
    namedSpreadNumberResult.forecast.expectedMarginHome,
"cheaper Home juice must partially compensate the Home-favoring number move, not count as a second vote");

console.log("CFB consensus, target-exclusion, exact-line/fresh-split authority, and score-coherence tests passed.");
