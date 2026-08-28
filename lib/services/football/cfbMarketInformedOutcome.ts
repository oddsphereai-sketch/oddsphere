import marketResidualArtifactJson from "./modelArtifacts/cfbMarketResidualArtifact.json";
import type { NcaafBookOdds } from "./balldontlieNcaafSlate";
import type { CfbV1ContextLines, CfbV1Forecast } from "./cfbV1Decision";

export const CFB_MARKET_INFORMED_OUTCOME_ARTIFACT_RELEASE =
  "cfb_market_anchored_joint_score_artifact_2026_08_27_r4" as const;
export const CFB_MARKET_INFORMED_OUTCOME_MODEL_RELEASE =
  "cfb_market_informed_joint_score_model_2026_08_27_r2" as const;
export const CFB_MARKET_INFORMED_OUTCOME_DISTRIBUTION_RELEASE =
  "cfb_market_residual_joint_distribution_2026_08_27_r2" as const;
export const CFB_MARKET_INFORMED_OUTCOME_PROBABILITY_RELEASE =
  "cfb_market_informed_joint_probability_2026_08_27_r2" as const;
export const CFB_MARKET_INFORMED_OUTCOME_REPRESENTATIVE_SCORE_RELEASE =
  "cfb_market_informed_reachable_score_2026_08_27_r2" as const;
export const CFB_MARKET_INFORMED_OUTCOME_CONTRACT_RELEASE =
  "cfb_market_informed_outcome_contract_2026_08_28_r18" as const;

export type CfbCanonicalMarketAnchor = {
  homeSpread: number;
  totalLine: number;
  namedBookCount: number;
  source: "named_book_median" | "exact_target_book" | "playbook_context";
};

export type CfbMarketInformedOutcomeForecast = CfbV1Forecast & {
  forecastBasis: "market_informed_canonical_anchor";
  canonicalMarketAnchor: CfbCanonicalMarketAnchor;
  artifactRelease: typeof CFB_MARKET_INFORMED_OUTCOME_ARTIFACT_RELEASE;
  modelRelease: typeof CFB_MARKET_INFORMED_OUTCOME_MODEL_RELEASE;
  distributionRelease: typeof CFB_MARKET_INFORMED_OUTCOME_DISTRIBUTION_RELEASE;
  probabilityRelease: typeof CFB_MARKET_INFORMED_OUTCOME_PROBABILITY_RELEASE;
  representativeScoreRelease: typeof CFB_MARKET_INFORMED_OUTCOME_REPRESENTATIVE_SCORE_RELEASE;
  contractRelease: typeof CFB_MARKET_INFORMED_OUTCOME_CONTRACT_RELEASE;
};

type MarketResidualArtifact = {
  artifactRelease: string;
  modelRelease: string;
  distributionRelease: string;
  probabilityRelease: string;
  representativeScoreRelease: string;
  fitRows: number;
  residualSample: Array<[number, number]>;
};

const artifact = marketResidualArtifactJson as unknown as MarketResidualArtifact;
assertArtifact();

export function resolveCfbCanonicalMarketAnchor(args: {
  books: NcaafBookOdds[];
  contextLines?: CfbV1ContextLines;
}): CfbCanonicalMarketAnchor | null {
  const complete = args.books.filter((book) =>
    book.targetEligible !== false &&
    isConventionalBook(book.sportsbook) &&
    book.spread !== null &&
    book.total !== null
  );
  if (complete.length >= 3) {
    return {
      homeSpread: median(complete.map((book) => book.spread!.homeLine)),
      totalLine: median(complete.map((book) => book.total!.line)),
      namedBookCount: complete.length,
      source: "named_book_median",
    };
  }
  const supportedTarget = complete
    .map((target) => {
      const exactSpreadBooks = distinctNonTargetBooks(args.books, (book) =>
        book.spread !== null && Math.abs(book.spread.homeLine - target.spread!.homeLine) < 0.001
      );
      const exactTotalBooks = distinctNonTargetBooks(args.books, (book) =>
        book.total !== null && Math.abs(book.total.line - target.total!.line) < 0.001
      );
      return { target, exactSpreadBooks, exactTotalBooks };
    })
    .filter((candidate) => candidate.exactSpreadBooks.size >= 2 && candidate.exactTotalBooks.size >= 2)
    .sort((first, second) =>
      Date.parse(second.target.observedAt) - Date.parse(first.target.observedAt) ||
      first.target.sportsbook.localeCompare(second.target.sportsbook)
    )[0];
  if (supportedTarget) {
    return {
      homeSpread: supportedTarget.target.spread!.homeLine,
      totalLine: supportedTarget.target.total!.line,
      namedBookCount: new Set([
        normalizeBook(supportedTarget.target.sportsbook),
        ...supportedTarget.exactSpreadBooks,
        ...supportedTarget.exactTotalBooks,
      ]).size,
      source: "exact_target_book",
    };
  }
  const homeSpread = args.contextLines?.homeSpread;
  const totalLine = args.contextLines?.totalLine;
  return homeSpread === null || homeSpread === undefined || totalLine === null || totalLine === undefined
    ? null
    : {
        homeSpread,
        totalLine,
        namedBookCount: complete.length,
        source: "playbook_context",
      };
}

export function buildCfbMarketInformedOutcomeForecast(args: {
  independentForecast: CfbV1Forecast;
  anchor: CfbCanonicalMarketAnchor;
}): CfbMarketInformedOutcomeForecast {
  const desiredMargin = -args.anchor.homeSpread;
  const counts = new Map<string, { home: number; away: number; count: number }>();
  const homes: number[] = [];
  const aways: number[] = [];
  for (const [marginResidual, totalResidual] of artifact.residualSample) {
    const margin = desiredMargin + marginResidual;
    const total = Math.max(Math.abs(margin) + 1, args.anchor.totalLine + totalResidual);
    const home = nearestFootballScore((total + margin) / 2);
    const away = nearestFootballScore((total - margin) / 2);
    homes.push(home);
    aways.push(away);
    const key = `${home}:${away}`;
    const current = counts.get(key);
    counts.set(key, current ? { ...current, count: current.count + 1 } : { home, away, count: 1 });
  }
  if (homes.length === 0) throw new Error("CFB market-informed residual distribution is empty.");
  const margins = homes.map((home, index) => home - aways[index]!);
  const totals = homes.map((home, index) => home + aways[index]!);
  const expectedHome = mean(homes);
  const expectedAway = mean(aways);
  const expectedMargin = mean(margins);
  const expectedTotal = mean(totals);
  const homeWinProbability = (
    margins.filter((value) => value > 0).length +
    0.5 * margins.filter((value) => value === 0).length
  ) / margins.length;
  const pmf = [...counts.values()]
    .sort((first, second) => first.home - second.home || first.away - second.away)
    .map((cell) => ({ home: cell.home, away: cell.away, probability: cell.count / homes.length }));
  const representativePool = [...counts.values()].filter((cell) =>
    homeWinProbability > 0.5 ? cell.home > cell.away :
      homeWinProbability < 0.5 ? cell.home < cell.away : true
  );
  const representative = representativePool.sort((first, second) =>
    representativeDistance(first, expectedHome, expectedAway, expectedMargin, expectedTotal) -
      representativeDistance(second, expectedHome, expectedAway, expectedMargin, expectedTotal) ||
    second.count - first.count
  )[0]!;
  return {
    ...args.independentForecast,
    expectedAwayPoints: expectedAway,
    expectedHomePoints: expectedHome,
    expectedMarginHome: expectedMargin,
    expectedTotal,
    homeWinProbability,
    representativeScore: { away: representative.away, home: representative.home },
    interval80: {
      away: [quantile(aways, 0.1), quantile(aways, 0.9)],
      home: [quantile(homes, 0.1), quantile(homes, 0.9)],
      marginHome: [quantile(margins, 0.1), quantile(margins, 0.9)],
      total: [quantile(totals, 0.1), quantile(totals, 0.9)],
    },
    pmf,
    forecastBasis: "market_informed_canonical_anchor",
    canonicalMarketAnchor: args.anchor,
    artifactRelease: CFB_MARKET_INFORMED_OUTCOME_ARTIFACT_RELEASE,
    modelRelease: CFB_MARKET_INFORMED_OUTCOME_MODEL_RELEASE,
    distributionRelease: CFB_MARKET_INFORMED_OUTCOME_DISTRIBUTION_RELEASE,
    probabilityRelease: CFB_MARKET_INFORMED_OUTCOME_PROBABILITY_RELEASE,
    representativeScoreRelease: CFB_MARKET_INFORMED_OUTCOME_REPRESENTATIVE_SCORE_RELEASE,
    contractRelease: CFB_MARKET_INFORMED_OUTCOME_CONTRACT_RELEASE,
  };
}

const FOOTBALL_SCORE_SUPPORT = [
  0, 2, 3, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
  58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76,
  77, 78, 79, 80,
] as const;

function nearestFootballScore(value: number): number {
  const bounded = Math.max(0, Math.min(80, value));
  return FOOTBALL_SCORE_SUPPORT.reduce((best, candidate) =>
    Math.abs(candidate - bounded) < Math.abs(best - bounded) ? candidate : best
  );
}

function representativeDistance(
  cell: { home: number; away: number },
  expectedHome: number,
  expectedAway: number,
  expectedMargin: number,
  expectedTotal: number,
): number {
  return (cell.home - expectedHome) ** 2 + (cell.away - expectedAway) ** 2 +
    ((cell.home - cell.away) - expectedMargin) ** 2 +
    ((cell.home + cell.away) - expectedTotal) ** 2;
}

function quantile(values: number[], probability: number): number {
  const sorted = [...values].sort((first, second) => first - second);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper
    ? sorted[lower]!
    : sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isConventionalBook(value: string): boolean {
  return !["kalshi", "polymarket"].includes(normalizeBook(value));
}

function distinctNonTargetBooks(
  books: NcaafBookOdds[],
  predicate: (book: NcaafBookOdds) => boolean,
): Set<string> {
  return new Set(books
    .filter((book) =>
      book.targetEligible === false &&
      isConventionalBook(book.sportsbook) &&
      predicate(book)
    )
    .map((book) => normalizeBook(book.sportsbook))
    .filter(Boolean));
}

function assertArtifact(): void {
  if (
    artifact.artifactRelease !== CFB_MARKET_INFORMED_OUTCOME_ARTIFACT_RELEASE ||
    artifact.modelRelease !== CFB_MARKET_INFORMED_OUTCOME_MODEL_RELEASE ||
    artifact.distributionRelease !== CFB_MARKET_INFORMED_OUTCOME_DISTRIBUTION_RELEASE ||
    artifact.probabilityRelease !== CFB_MARKET_INFORMED_OUTCOME_PROBABILITY_RELEASE ||
    artifact.representativeScoreRelease !== CFB_MARKET_INFORMED_OUTCOME_REPRESENTATIVE_SCORE_RELEASE ||
    artifact.fitRows !== 1111 ||
    artifact.residualSample.length !== 2222
  ) {
    throw new Error("CFB market-informed outcome artifact release mismatch.");
  }
}
