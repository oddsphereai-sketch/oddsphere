import { computeNbaMarketProbabilities, type NbaDistributionInput } from "../../automodel/nba/nbaDistribution";
import type { NbaReaderSide, NbaReaderTrail } from "./nbaProfessionalMarketReader";

export const NBA_PRICED_MARKET_MOVEMENT_RELEASE = "nba_priced_market_movement_2026_10_31_r1_exact_contract_direction" as const;
export type NbaPriceCoordinateLaw = {
  marginSigma: number;
  totalSigma: number;
  marginMixture?: NbaDistributionInput["margin_residual_mixture"];
};
export type NbaPricedMovement = {
  sportsbook: string;
  provider: string | null;
  market: "spread" | "total";
  rawNumberDelta: number | null;
  equivalentLocationDelta: number | null;
  economicSide: NbaReaderSide | null;
  status: "number_price_align" | "price_offsets_number" | "no_net_movement" | "endpoint_unavailable";
};

export function nbaResidualCdf(market: "spread" | "total", residual: number, law: NbaPriceCoordinateLaw): number {
  if (residual === 0) return .5; // Exact symmetry at the residual median.
  const p = computeNbaMarketProbabilities({ projected_home_margin: 0, projected_total: 0,
    market_spread_home: -residual, market_total: residual,
    margin_sd_base: law.marginSigma, total_sd_base: law.totalSigma, margin_residual_mixture: law.marginMixture });
  return 1 - (market === "spread" ? p.spread_home_cover_prob! : p.total_over_prob!);
}

export function nbaResidualQuantile(market: "spread" | "total", probability: number, law: NbaPriceCoordinateLaw): number {
  if (!(probability > 0 && probability < 1)) throw new Error("NBA price coordinate requires an interior probability");
  if (probability === .5) return 0;
  let width = market === "spread" ? law.marginSigma : law.totalSigma;
  const cdf = (value: number) => nbaResidualCdf(market, value, law);
  for (let iteration = 0; cdf(-width) > probability || cdf(width) < probability; iteration++) {
    if (iteration >= 64) throw new Error("NBA price coordinate cannot bracket residual quantile");
    width *= 2;
  }
  let low = -width, high = width;
  for (let iteration = 0; iteration < 80; iteration++) {
    const middle = (low + high) / 2;
    if (cdf(middle) < probability) low = middle; else high = middle;
  }
  return (low + high) / 2;
}

/** Compare differently priced numbers in one coordinate under the ALREADY
 * released residual law. This is not an estimate of book intent/true scores,
 * a market/model blend, or new permission to change a forecast. It prevents
 * an old raw-number override when its own exact paired price says otherwise.
 * Partial price compensation is not automatically a conflicting direction.
 */
export function readNbaPricedMarketMovement(args: {
  market: "spread" | "total"; trail: NbaReaderTrail; law: NbaPriceCoordinateLaw;
}): NbaPricedMovement {
  const { market, trail, law } = args;
  const result: NbaPricedMovement = { sportsbook: trail.sportsbook, provider: trail.provider ?? null, market,
    rawNumberDelta: trail.numberDelta, equivalentLocationDelta: null, economicSide: null, status: "endpoint_unavailable" };
  const opening = trail.openingNumber, current = trail.currentNumber;
  const first = trail.openingFairFirstProbability, last = trail.currentFairFirstProbability;
  if (opening === null || current === null || first === undefined || last === undefined ||
      ![opening, current, first, last, law.marginSigma, law.totalSigma].every(Number.isFinite) ||
      first <= 0 || first >= 1 || last <= 0 || last >= 1 || law.marginSigma <= 0 || law.totalSigma <= 0) return result;
  const delta = current - opening + nbaResidualQuantile(market, last, law) - nbaResidualQuantile(market, first, law);
  result.equivalentLocationDelta = delta;
  // Numerical equality, not a minimum market-signal size or activation quota.
  if (Math.abs(delta) <= 1e-9) { result.status = "no_net_movement"; return result; }
  result.economicSide = market === "spread" ? delta > 0 ? "home" : "away" : delta > 0 ? "over" : "under";
  result.status = trail.numberDirection !== null && result.economicSide !== trail.numberDirection
    ? "price_offsets_number" : "number_price_align";
  return result;
}
