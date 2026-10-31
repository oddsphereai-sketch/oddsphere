import assert from "node:assert/strict";
import { buildOfflineNbaAttestedDistribution, OFFLINE_NBA_ATTESTED_DISTRIBUTION_RELEASE,
  type OfflineAttestedDistributionRecipe } from "./operator/nba/nbaAttestedForecastDistribution";
import { computeNbaMarketProbabilities } from "../lib/automodel/nba/nbaDistribution";
import type { NbaReaderTrail } from "../lib/services/nba/nbaProfessionalMarketReader";

// Hand-authored mathematical fixtures ONLY: not fitted parameters, not an
// experimental accuracy result, and never a production calibration artifact.
const recipe: OfflineAttestedDistributionRecipe = {
  release: OFFLINE_NBA_ATTESTED_DISTRIBUTION_RELEASE, productionQualified: false,
  sourceSha256: "synthetic_fixture", independentFingerprint: "synthetic_fixture",
  books: { circa: { marginLogit: 2, totalLogit: 2, moneylineFusionLogit: 0.4,
    marginMovementResponse: 0.2, totalMovementResponse: 0.2, logMarginScale: 0, logTotalScale: 0,
    agePenaltyPerHour: 0.1 } },
};
const at = "2026-10-30T22:30:00Z", seed = { marginSigma: 11.5, totalSigma: 16 };
function trail(market: "moneyline" | "spread" | "total", currentFair: number, number: number | null): NbaReaderTrail {
  return { sportsbook: "circa", sourceClass: "named", provider: "owls", openingIngestionRunId: "open", currentIngestionRunId: "current",
    openingAt: "2026-10-30T20:30:00Z", currentAt: "2026-10-30T22:00:00Z", observations: 2,
    openingCaptureAt: "2026-10-30T20:30:01Z", currentCaptureAt: "2026-10-30T22:00:01Z",
    openingNumber: number, currentNumber: number, numberDelta: 0, fairProbabilityDeltaPp: (currentFair - 0.5) * 100,
    openingFairFirstProbability: 0.5, currentFairFirstProbability: currentFair,
    direction: market === "total" ? "over" : "home", numberDirection: null, priceDirection: null,
    persistenceTimeShare: 0.01, reversalMagnitude: 1, buybackToOpening: false };
}
function evaluate(trails: Parameters<typeof buildOfflineNbaAttestedDistribution>[0]["trails"],
  margin = 3, parameters = recipe) {
  return buildOfflineNbaAttestedDistribution({ recipe: parameters, seed, evaluatedAt: at,
    independentMargin: margin, independentTotal: 220, spreadHome: -5.5, totalLine: 224, trails });
}
const empty = { moneyline: [], spread: [], total: [] };
const neutral = evaluate(empty);
const independent = computeNbaMarketProbabilities({ projected_home_margin: 3, projected_total: 220,
  market_spread_home: -5.5, market_total: 224, margin_sd_base: seed.marginSigma, total_sd_base: seed.totalSigma });
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
close(neutral.representative.margin, 3); close(neutral.representative.total, 220);
close(neutral.probabilities.homeWin, independent.ml_home_win_prob);
close(neutral.probabilities.homeCover, independent.spread_home_cover_prob!);
close(neutral.probabilities.over, independent.total_over_prob!);

const support = evaluate({ ...empty, moneyline: [trail("moneyline", 0.8, null)] });
const opposition = evaluate({ ...empty, moneyline: [trail("moneyline", 0.2, null)] });
assert.ok(support.probabilities.homeWin > neutral.probabilities.homeWin);
assert.ok(opposition.probabilities.homeWin < neutral.probabilities.homeWin);
assert.equal(opposition.picks.moneyline, "away", "direct ML input may change winner through the same margin CDF");
assert.equal(support.picks.spread, "home", "a single source can move continuously without two-book vote gating");
close(support.probabilities.over, neutral.probabilities.over);
close(opposition.probabilities.over, neutral.probabilities.over);

const belowOldThreshold = evaluate({ ...empty, spread: [trail("spread", 0.5001, 5.5001)] });
const flatSource = evaluate({ ...empty, spread: [trail("spread", 0.5, 5.5)] });
assert.notEqual(belowOldThreshold.probabilities.homeWin, flatSource.probabilities.homeWin,
  "small source differences are not discarded by a two-point rule or a persistence quorum");
assert.equal(belowOldThreshold.productionQualified, false);

const totalOnly = evaluate({ ...empty, total: [trail("total", 0.8, 224)] });
assert.equal(totalOnly.picks.total, "over");
close(totalOnly.probabilities.homeWin, neutral.probabilities.homeWin);
close(totalOnly.probabilities.homeCover, neutral.probabilities.homeCover);

for (const result of [neutral, support, opposition, belowOldThreshold, flatSource, totalOnly]) {
  let last = 0;
  for (let x = -100; x <= 100; x += 0.5) {
    const p = result.cdf("margin", x);
    assert.ok(p >= last - 1e-12 && p >= 0 && p <= 1 + 1e-12);
    last = p;
  }
  close(result.cdf("margin", result.representative.margin), 0.5);
  close(result.cdf("total", result.representative.total), 0.5);
  close(result.representative.homeScore - result.representative.awayScore, result.representative.margin);
  close(result.representative.homeScore + result.representative.awayScore, result.representative.total);
  if (Math.abs(result.representative.margin) > 1e-7) assert.equal(result.picks.moneyline === "home", result.representative.margin > 0);
  if (Math.abs(result.representative.margin - 5.5) > 1e-7) assert.equal(result.picks.spread === "home", result.representative.margin > 5.5);
  if (Math.abs(result.representative.total - 224) > 1e-7) assert.equal(result.picks.total === "over", result.representative.total > 224);
}

const originalTrail = trail("moneyline", 0.8, null);
const reflected = buildOfflineNbaAttestedDistribution({ recipe, seed, evaluatedAt: at,
  independentMargin: -3, independentTotal: 220, spreadHome: 5.5, totalLine: 224,
  trails: { ...empty, moneyline: [{ ...originalTrail, openingFairFirstProbability: 0.5, currentFairFirstProbability: 0.2 }] } });
close(reflected.probabilities.homeWin, 1 - support.probabilities.homeWin);
close(reflected.probabilities.homeCover, 1 - support.probabilities.homeCover);
close(reflected.representative.margin, -support.representative.margin);

for (const invalid of [
  { ...originalTrail, provider: undefined },
  { ...originalTrail, currentIngestionRunId: undefined },
  { ...originalTrail, currentCaptureAt: "2026-10-30T22:31:00Z" },
  { ...originalTrail, currentAt: "2026-10-30T22:00:02Z" },
  { ...originalTrail, openingCaptureAt: "2026-10-30T22:00:02Z" },
]) {
  const result = evaluate({ ...empty, moneyline: [invalid] });
  close(result.probabilities.homeWin, neutral.probabilities.homeWin);
  assert.ok(result.unavailable.length);
}
const duplicated = evaluate({ ...empty, moneyline: [originalTrail, { ...originalTrail, provider: "canonical_lines" }] });
close(duplicated.probabilities.homeWin, neutral.probabilities.homeWin);
assert.match(duplicated.unavailable[0]!, /unreconciled_provider_lanes/);

// Explicit skew counterexample: a positive mean does NOT imply home is more
// likely to win. The representative median follows the one coherent CDF.
const skewRecipe = structuredClone(recipe);
skewRecipe.books.circa!.marginMovementResponse = 0;
skewRecipe.books.circa!.logMarginScale = -3;
const nearMinusOne = computeNbaMarketProbabilities({ projected_home_margin: -1, projected_total: 220,
  market_spread_home: 0, market_total: 224, margin_sd_base: 11.5, total_sd_base: 16 }).ml_home_win_prob;
const skew = evaluate({ ...empty, moneyline: [trail("moneyline", nearMinusOne, null)] }, 15, skewRecipe);
assert.ok(skew.expected.margin > 0 && skew.representative.margin < 0);
assert.equal(skew.picks.moneyline, "away");
console.log("Offline NBA attested distribution: CDF coherence, direct ML, continuous small signals, missing dimensions, source negatives, side reflection and skew/median tests passed. Synthetic coefficients; no accuracy qualification or activation.");
