import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import type {
  NflForwardPlaybookLine,
  NflForwardPlaybookSplitSet,
} from "./nflForwardEvidence";
import type { NflR6ShadowMoneylineDecision } from "./nflR6MoneylineShadow";
import type { NflRegularSharpSplitSet } from "./sharpApiNflSplits";
import {
  buildNflV1ActionableGradeBundle,
  type NflV1ActionableGradeBundle,
} from "./nflV1ActionableGradeCandidate";
import {
  buildNflMarketEvidenceOutcomeForecast,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE =
  "nfl_target_excluded_market_outcome_2026_09_03_r1" as const;

export type NflTargetExcludedMarketAnchor = {
  release: typeof NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE;
  homeMargin: number;
  total: number;
  marginFamilyCount: number;
  totalFamilyCount: number;
  marginExcludedSportsbooks: string[];
  totalExcludedSportsbooks: string[];
};

type NflEvaluatedTargetFamilies = {
  byMarket: Record<"moneyline" | "spread" | "total", string>;
  margin: string[];
  total: string[];
};

export function resolveNflTargetExcludedProduction(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  evaluatedAt: string;
  baseOutcome: NflV1WeekOneOutcomeForecast;
  incumbentOutcome: NflV1WeekOneOutcomeForecast;
  current: NflPreviewBookOdds;
  comparableCurrentBooks: NflPreviewBookOdds[];
  shadowMoneyline: NflR6ShadowMoneylineDecision;
  playbookLine: NflForwardPlaybookLine | null;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
}): {
  outcome: NflV1WeekOneOutcomeForecast;
  production: NflV1ActionableGradeBundle;
  targetExclusion: NonNullable<NflV1WeekOneOutcomeForecast["targetExclusion"]>;
} {
  const buildProduction = (outcomeForecast: NflV1WeekOneOutcomeForecast) =>
    buildNflV1ActionableGradeBundle({
      providerGameId: args.providerGameId,
      awayTeam: args.awayTeam,
      homeTeam: args.homeTeam,
      gameStartsAt: args.gameStartsAt,
      current: args.current,
      comparableCurrentBooks: args.comparableCurrentBooks,
      shadowMoneyline: args.shadowMoneyline,
      outcomeForecast,
    });
  const fallback = () => {
    const targetExclusion = {
      release: NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
      status: "incumbent_fallback" as const,
      reason: "insufficient_or_unstable_target_free_evidence" as const,
      marginFamilyCount: null,
      totalFamilyCount: null,
      marginExcludedSportsbooks: [] as string[],
      totalExcludedSportsbooks: [] as string[],
    };
    const outcome = { ...args.incumbentOutcome, targetExclusion };
    return { outcome, production: buildProduction(outcome), targetExclusion };
  };
  if (!args.shadowMoneyline.footballProjection || !args.current.spread || !args.current.total) {
    return fallback();
  }

  let production = buildProduction(args.incumbentOutcome);
  let excluded = evaluatedTargetFamilies(production.evaluatedBets);
  if (!excluded) return fallback();
  const seen = new Set<string>();
  const familyBound = Math.min(
    9,
    new Set(args.comparableCurrentBooks.map((book) => normalizeBook(book.sportsbook)).filter(Boolean)).size + 1,
  );
  for (let iteration = 0; iteration < familyBound; iteration++) {
    const signature = targetFamilySignature(excluded);
    if (seen.has(signature)) return fallback();
    seen.add(signature);
    const anchor = resolveNflTargetExcludedMarketAnchor({
      books: args.comparableCurrentBooks,
      marginExcludedSportsbooks: excluded.margin,
      totalExcludedSportsbooks: excluded.total,
      evaluatedAt: args.evaluatedAt,
    });
    if (!anchor) return fallback();
    const targetFreeCurrent: NflPreviewBookOdds = {
      ...args.current,
      sportsbook: "target-excluded-consensus",
      observedAt: args.evaluatedAt,
      spread: {
        ...args.current.spread,
        awayLine: anchor.homeMargin,
        homeLine: -anchor.homeMargin,
      },
      total: { ...args.current.total, line: anchor.total },
    };
    const outcomeCandidate = buildNflMarketEvidenceOutcomeForecast({
      baseForecast: args.baseOutcome,
      footballHomeMargin: args.shadowMoneyline.footballProjection.projectedHomeMargin,
      current: targetFreeCurrent,
      operationalOpening: null,
      playbookLine: args.playbookLine,
      playbookSplits: args.playbookSplits,
      sharpSplits: targetFreeSharpSplits(args.sharpSplits, excluded),
      evaluatedAt: args.evaluatedAt,
    });
    const productionCandidate = buildProduction(outcomeCandidate);
    const nextExcluded = evaluatedTargetFamilies(productionCandidate.evaluatedBets);
    if (!nextExcluded) return fallback();
    if (targetFamilySignature(nextExcluded) === signature) {
      const targetExclusion = {
        release: NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
        status: "target_excluded_market" as const,
        reason: "stable_complete_tuple" as const,
        marginFamilyCount: anchor.marginFamilyCount,
        totalFamilyCount: anchor.totalFamilyCount,
        marginExcludedSportsbooks: anchor.marginExcludedSportsbooks,
        totalExcludedSportsbooks: anchor.totalExcludedSportsbooks,
      };
      const outcome = { ...outcomeCandidate, targetExclusion };
      return { outcome, production: buildProduction(outcome), targetExclusion };
    }
    production = productionCandidate;
    excluded = nextExcluded;
  }
  return fallback();
}

/**
 * Resolves target-free margin and total axes. Moneyline and Spread share the
 * margin distribution, so both evaluated operator families are removed from
 * that axis; Total removes only its own evaluated family.
 */
export function resolveNflTargetExcludedMarketAnchor(args: {
  books: NflPreviewBookOdds[];
  marginExcludedSportsbooks: Iterable<string>;
  totalExcludedSportsbooks: Iterable<string>;
  evaluatedAt: string;
  freshnessMinutes?: number;
  minimumFamilies?: number;
}): NflTargetExcludedMarketAnchor | null {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL target-excluded anchor evaluatedAt is invalid.");
  const freshnessMs = (args.freshnessMinutes ?? 120) * 60_000;
  const minimumFamilies = args.minimumFamilies ?? 3;
  const marginExcluded = normalizedSet(args.marginExcludedSportsbooks);
  const totalExcluded = normalizedSet(args.totalExcludedSportsbooks);
  const books = distinctLatestBooks(args.books);
  const marginBooks = books.filter((book) =>
    !marginExcluded.has(normalizeBook(book.sportsbook)) &&
    book.spread !== null && isFresh(book.observedAt, evaluatedAt, freshnessMs)
  );
  const totalBooks = books.filter((book) =>
    !totalExcluded.has(normalizeBook(book.sportsbook)) &&
    book.total !== null && isFresh(book.observedAt, evaluatedAt, freshnessMs)
  );
  if (marginBooks.length < minimumFamilies || totalBooks.length < minimumFamilies) return null;
  return {
    release: NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
    homeMargin: -median(marginBooks.map((book) => book.spread!.homeLine)),
    total: median(totalBooks.map((book) => book.total!.line)),
    marginFamilyCount: marginBooks.length,
    totalFamilyCount: totalBooks.length,
    marginExcludedSportsbooks: [...marginExcluded].sort(),
    totalExcludedSportsbooks: [...totalExcluded].sort(),
  };
}

function evaluatedTargetFamilies(
  decisions: NflV1ActionableGradeBundle["evaluatedBets"],
): NflEvaluatedTargetFamilies | null {
  const byMarket = Object.fromEntries(decisions.map((decision) => [
    decision.market,
    normalizeBook(decision.evaluatedQuote.sportsbook),
  ])) as Partial<NflEvaluatedTargetFamilies["byMarket"]>;
  if (!byMarket.moneyline || !byMarket.spread || !byMarket.total) return null;
  const complete = byMarket as NflEvaluatedTargetFamilies["byMarket"];
  return {
    byMarket: complete,
    margin: [...new Set([complete.moneyline, complete.spread])],
    total: [complete.total],
  };
}

function targetFamilySignature(value: NflEvaluatedTargetFamilies): string {
  return [value.byMarket.moneyline, value.byMarket.spread, value.byMarket.total].join("|");
}

function targetFreeSharpSplits(
  value: NflRegularSharpSplitSet | null,
  excluded: NflEvaluatedTargetFamilies,
): NflRegularSharpSplitSet | null {
  if (!value) return null;
  return {
    moneyline: excluded.margin.includes(normalizeBook(value.moneyline.sourceSportsbook))
      ? { ...value.moneyline, sourceSportsbook: null }
      : value.moneyline,
    spread: excluded.margin.includes(normalizeBook(value.spread.sourceSportsbook))
      ? { ...value.spread, sourceSportsbook: null }
      : value.spread,
    total: excluded.total.includes(normalizeBook(value.total.sourceSportsbook))
      ? { ...value.total, sourceSportsbook: null }
      : value.total,
  };
}

function distinctLatestBooks(books: NflPreviewBookOdds[]): NflPreviewBookOdds[] {
  const result = new Map<string, NflPreviewBookOdds>();
  for (const book of books) {
    const family = normalizeBook(book.sportsbook);
    if (!family) continue;
    const prior = result.get(family);
    if (!prior || Date.parse(book.observedAt) > Date.parse(prior.observedAt)) result.set(family, book);
  }
  return [...result.values()];
}

function normalizedSet(values: Iterable<string>): Set<string> {
  return new Set([...values].map(normalizeBook).filter(Boolean));
}

function normalizeBook(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
}

function isFresh(value: string, evaluatedAt: number, freshnessMs: number): boolean {
  const observedAt = Date.parse(value);
  return Number.isFinite(observedAt) && observedAt <= evaluatedAt && evaluatedAt - observedAt <= freshnessMs;
}

function median(values: number[]): number {
  const rows = [...values].sort((first, second) => first - second);
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 === 0 ? (rows[middle - 1]! + rows[middle]!) / 2 : rows[middle]!;
}
