/** OFFLINE ONLY. No writer imports, activation flag, stored shadow or fitted
 * production artifact. Learned parameters must be qualified separately. */
import { computeNbaMarketProbabilities, type NbaDistributionInput } from "../../../lib/automodel/nba/nbaDistribution";
import type { NbaReaderTrail } from "../../../lib/services/nba/nbaProfessionalMarketReader";

export const OFFLINE_NBA_ATTESTED_DISTRIBUTION_RELEASE = "offline_nba_attested_distribution_2026_10_31_r1" as const;
type Axis = "margin" | "total";
type Book = "circa" | "pinnacle" | "bookmaker";
export type ResidualSeed = {
  marginSigma: number; totalSigma: number;
  marginMixture?: NbaDistributionInput["margin_residual_mixture"];
};
export type OfflineAttestedDistributionRecipe = {
  release: typeof OFFLINE_NBA_ATTESTED_DISTRIBUTION_RELEASE;
  /** Never consume an unqualified research recipe as a production artifact. */
  productionQualified: false;
  sourceSha256: string;
  independentFingerprint: string;
  books: Partial<Record<Book, {
    marginLogit: number; totalLogit: number;
    moneylineFusionLogit: number;
    marginMovementResponse: number; totalMovementResponse: number;
    logMarginScale: number; logTotalScale: number;
    agePenaltyPerHour: number;
  }>>;
};
type Component = { source: "independent" | Book; center: number; scale: number; logit: number; weight: number };

function residualCdf(axis: Axis, value: number, seed: ResidualSeed): number {
  const p = computeNbaMarketProbabilities({ projected_home_margin: 0, projected_total: 0,
    market_spread_home: -value, market_total: value,
    margin_sd_base: seed.marginSigma, total_sd_base: seed.totalSigma,
    margin_residual_mixture: seed.marginMixture });
  return 1 - (axis === "margin" ? p.spread_home_cover_prob! : p.total_over_prob!);
}
function quantile(cdf: (x: number) => number, p: number, center: number, scale: number): number {
  if (!(p > 0 && p < 1)) throw new Error("Quantile requires a strict probability");
  let width = scale, low = center - width, high = center + width;
  for (let i = 0; cdf(low) > p || cdf(high) < p; i++) {
    if (i >= 64) throw new Error("CDF could not bracket quantile");
    width *= 2; low = center - width; high = center + width;
  }
  for (let i = 0; i < 80; i++) {
    const middle = (low + high) / 2;
    if (cdf(middle) < p) low = middle; else high = middle;
  }
  return (low + high) / 2;
}
function impliedLocation(axis: Axis, market: "moneyline" | "spread" | "total", number: number | null, fair: number, seed: ResidualSeed): number {
  if (!(fair > 0 && fair < 1) || (market !== "moneyline" && !Number.isFinite(number))) throw new Error("Invalid exact source contract");
  const spread = axis === "margin" ? seed.marginSigma : seed.totalSigma;
  return (market === "moneyline" ? 0 : number!) + quantile(x => residualCdf(axis, x, seed), fair, 0, spread);
}
function normalize(components: Component[]) {
  const largest = Math.max(...components.map(c => c.logit));
  const sum = components.reduce((a, c) => a + Math.exp(c.logit - largest), 0);
  for (const component of components) component.weight = Math.exp(component.logit - largest) / sum;
}

/** One coherent conditional distribution, not independent pick classifiers.
 * The product copula is explicit; no unlearned margin/Total correlation is
 * claimed. ML and Spread share one margin CDF. Missing dimensions retain the
 * exact independent marginal, not a quota/hold or a zero-filled market vote.
 *
 * Source locations are an equivalent-location representation under the frozen
 * residual law, NOT assertions about bettor identity or true book means. */
export function buildOfflineNbaAttestedDistribution(args: {
  recipe: OfflineAttestedDistributionRecipe; seed: ResidualSeed;
  evaluatedAt: string; independentMargin: number; independentTotal: number;
  spreadHome: number; totalLine: number;
  trails: Record<"moneyline" | "spread" | "total", readonly NbaReaderTrail[]>;
}) {
  const { recipe, seed } = args;
  if (recipe.release !== OFFLINE_NBA_ATTESTED_DISTRIBUTION_RELEASE || recipe.productionQualified !== false ||
      !recipe.sourceSha256 || !recipe.independentFingerprint) throw new Error("Unsealed offline recipe");
  if (![args.independentMargin, args.independentTotal, args.spreadHome, args.totalLine, seed.marginSigma, seed.totalSigma].every(Number.isFinite) ||
      seed.marginSigma <= 0 || seed.totalSigma <= 0) throw new Error("Invalid independent/line/scale input");
  const evaluated = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluated)) throw new Error("Invalid decision clock");
  const components: Record<Axis, Component[]> = {
    margin: [{ source: "independent", center: args.independentMargin, scale: 1, logit: 0, weight: 0 }],
    total: [{ source: "independent", center: args.independentTotal, scale: 1, logit: 0, weight: 0 }],
  };
  const unavailable: string[] = [];
  for (const book of ["circa", "pinnacle", "bookmaker"] as const) {
    const parameter = recipe.books[book];
    if (!parameter) continue; // An unseen source never receives fitted authority.
    if (!Object.values(parameter).every(Number.isFinite) || parameter.agePenaltyPerHour < 0) throw new Error("Invalid fitted source parameter");
    const observations = new Map<"moneyline" | "spread" | "total", { current: number; opening: number; ageHours: number }>();
    for (const market of ["moneyline", "spread", "total"] as const) {
      const lanes = args.trails[market].filter(t => t.sportsbook === book);
      // Provider lanes are NOT independent books. A fitter must explicitly
      // model provider reconciliation before two lanes may receive authority.
      if (lanes.length !== 1) { if (lanes.length) unavailable.push(`${book}:${market}:unreconciled_provider_lanes`); continue; }
      const trail = lanes[0]!;
      const open = Date.parse(trail.openingAt), current = Date.parse(trail.currentAt);
      const openCapture = Date.parse(trail.openingCaptureAt ?? ""), currentCapture = Date.parse(trail.currentCaptureAt ?? "");
      if (trail.sourceClass !== "named" || !["owls", "canonical_lines"].includes(trail.provider ?? "") ||
          !trail.openingIngestionRunId || !trail.currentIngestionRunId ||
          ![open, current, openCapture, currentCapture].every(Number.isFinite) || open >= current ||
          open > openCapture || current > currentCapture || openCapture >= currentCapture || currentCapture > evaluated ||
          trail.openingFairFirstProbability === undefined || trail.currentFairFirstProbability === undefined) {
        unavailable.push(`${book}:${market}:invalid_source_lineage`); continue;
      }
      const axis = market === "total" ? "total" : "margin";
      observations.set(market, {
        current: impliedLocation(axis, market, trail.currentNumber, trail.currentFairFirstProbability, seed),
        opening: impliedLocation(axis, market, trail.openingNumber, trail.openingFairFirstProbability, seed),
        // Capture is the causal clock shared with the explicitly unattributed
        // legacy cohort; provider timestamps are not assumed exchange ticks.
        ageHours: (evaluated - currentCapture) / 3_600_000,
      });
    }
    const ml = observations.get("moneyline"), spread = observations.get("spread"), total = observations.get("total");
    if (ml || spread) {
      // Learned conditional fusion, not a fixed 50/50 or current favorite rule.
      const fusion = ml && spread ? 1 / (1 + Math.exp(-parameter.moneylineFusionLogit)) : ml ? 1 : 0;
      const center = fusion * (ml?.current ?? 0) + (1 - fusion) * (spread?.current ?? 0);
      const opening = fusion * (ml?.opening ?? 0) + (1 - fusion) * (spread?.opening ?? 0);
      const age = fusion * (ml?.ageHours ?? 0) + (1 - fusion) * (spread?.ageHours ?? 0);
      components.margin.push({ source: book, center: center + parameter.marginMovementResponse * (center - opening),
        scale: Math.exp(parameter.logMarginScale), logit: parameter.marginLogit - parameter.agePenaltyPerHour * age, weight: 0 });
    }
    if (total) components.total.push({ source: book,
      center: total.current + parameter.totalMovementResponse * (total.current - total.opening),
      scale: Math.exp(parameter.logTotalScale), logit: parameter.totalLogit - parameter.agePenaltyPerHour * total.ageHours, weight: 0 });
  }
  for (const axis of ["margin", "total"] as const) {
    if (components[axis].some(c => !Number.isFinite(c.center) || !Number.isFinite(c.scale) || c.scale <= 0 || !Number.isFinite(c.logit))) throw new Error("Unstable fitted conditional component");
    normalize(components[axis]);
  }
  const cdf = (axis: Axis, x: number) => components[axis].reduce((sum, c) => sum + c.weight * residualCdf(axis, (x - c.center) / c.scale, seed), 0);
  const expectedMargin = components.margin.reduce((sum, c) => sum + c.weight * c.center, 0);
  const expectedTotal = components.total.reduce((sum, c) => sum + c.weight * c.center, 0);
  // A skewed mixture's mean can disagree with its most probable side. Use
  // marginal medians for one representative score, with means audit-only.
  // Never fake consistency by pushing a score0.25 points across a betting line.
  const margin = quantile(x => cdf("margin", x), 0.5, expectedMargin, seed.marginSigma);
  const total = quantile(x => cdf("total", x), 0.5, expectedTotal, seed.totalSigma);
  const probabilities = { homeWin: 1 - cdf("margin", 0), homeCover: 1 - cdf("margin", -args.spreadHome),
    over: 1 - cdf("total", args.totalLine) };
  return { release: recipe.release, productionQualified: false as const,
    jointFamily: "product_of_conditional_residual_mixtures" as const, components, unavailable,
    representative: { margin, total, homeScore: (total + margin) / 2, awayScore: (total - margin) / 2 },
    expected: { margin: expectedMargin, total: expectedTotal }, probabilities,
    picks: { moneyline: probabilities.homeWin >= 0.5 ? "home" as const : "away" as const,
      spread: probabilities.homeCover >= 0.5 ? "home" as const : "away" as const,
      total: probabilities.over >= 0.5 ? "over" as const : "under" as const },
    cdf };
}
