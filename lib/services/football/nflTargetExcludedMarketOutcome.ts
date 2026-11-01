import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import type {
  NflForwardOperationalOpening,
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
  inferNflTargetExcludedSpreadMean,
  NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";
import type { NflPaidProjectionShadow } from "./balldontlieNflWeeklyProjectionShadow";
import type { NflNamedMarketSequenceAuthority } from "./nflNamedMarketSequence";
import type { NflProfessionalMarketAuthority } from "./nflProfessionalMarketAuthority";
import type { NflForwardContextMarket } from "./nflForwardEvidenceCapture";
import {
  applyNflThreeStateMarketReader,
  type NflThreeStateMarketAuthority,
} from "./nflThreeStateMarketReader";
import { applyNflUnifiedTotalMarketInterpreter } from "./nflUnifiedTotalMarketInterpreter";

export const NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE =
  "nfl_target_excluded_market_outcome_2026_11_01_r25_market_axis_evidence" as const;

export type NflTargetExcludedMarketAnchor = {
  release: typeof NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE;
  homeMargin: number;
  spreadHomeFairProbability: number;
  total: number;
  totalOverFairProbability: number;
  marginFamilyCount: number;
  totalFamilyCount: number;
  marginExcludedSportsbooks: string[];
  totalExcludedSportsbooks: string[];
};

type NflEvaluatedTargetFamilies = {
  byMarket: Record<"moneyline" | "spread" | "total", string>;
  margin: string[];
  total: string[];
  contractLines?: { homeSpread: number | null; total: number | null };
};

export type NflNamedSequenceExcludedFamilies = Record<"moneyline" | "spread" | "total", string[]>;
export type EvaluatedContract = { spread: { homeLine: number } | null; total: { line: number } | null };

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
  operationalOpening?: NflForwardOperationalOpening | null;
  shadowMoneyline: NflR6ShadowMoneylineDecision;
  playbookLine: NflForwardPlaybookLine | null;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
  pricedNeutralTotalCandidate?: boolean;
  totalDirectionCandidate?: boolean;
  weeklyRawSignal?: {
    release: typeof NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE;
    independentHomeMargin: number;
    directionHomeCoverProbability: number;
    directionHomeMarginCorrection: number;
  };
  paidTeamScore?: Pick<NflPaidProjectionShadow,
    "release" | "providerCollectedAt" | "projectedHomeMargin" | "projectedTotal">;
  namedSequenceAuthority?: NflNamedMarketSequenceAuthority;
  namedSequenceAuthorityFactory?: (
    excludedFamiliesByMarket: NflNamedSequenceExcludedFamilies,
    evaluatedContract?: EvaluatedContract,
  ) => NflNamedMarketSequenceAuthority;
  professionalMarketAuthority?: NflProfessionalMarketAuthority;
  professionalMarketAuthorityFactory?: (
    excludedFamiliesByMarket: NflNamedSequenceExcludedFamilies,
    evaluatedContract?: EvaluatedContract,
  ) => NflProfessionalMarketAuthority;
  threeStateMarketAuthorityFactory?: (
    excludedFamiliesByMarket: NflNamedSequenceExcludedFamilies,
    evaluatedContract?: EvaluatedContract,
  ) => NflThreeStateMarketAuthority;
  marketStateSnapshots?: Array<{
    capturedAt: string;
    markets: Record<"moneyline" | "spread" | "total", Pick<NflForwardContextMarket, "families">>;
  }>;
  marketOutcomeBuilder?: typeof buildNflMarketEvidenceOutcomeForecast;
  fallbackOutcome?: NflV1WeekOneOutcomeForecast;
  /** Internal/read-only switch that resolves the pre-overlay unified baseline. */
  suppressNuancedMarginOverlay?: boolean;
}): {
  outcome: NflV1WeekOneOutcomeForecast;
  production: NflV1ActionableGradeBundle;
  targetExclusion: NonNullable<NflV1WeekOneOutcomeForecast["targetExclusion"]>;
  diagnosticProfessionalAuthority: NflProfessionalMarketAuthority | null;
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
  let diagnosticProfessionalAuthority: NflProfessionalMarketAuthority | null = null;
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
    const outcome = { ...(args.fallbackOutcome ?? args.incumbentOutcome), targetExclusion };
    return { outcome, production: buildProduction(outcome), targetExclusion, diagnosticProfessionalAuthority };
  };
  if (!args.shadowMoneyline.footballProjection || !args.current.spread || !args.current.total) {
    return fallback();
  }

  /*
   * The established target-excluded resolver owns the unified Moneyline,
   * Spread, and Total forecast. Resolve it first, then let the categorical
   * market reader operate only on the shared margin axis. This keeps an NFL
   * side correction from silently changing an unrelated Total decision.
   *
   * The recursive call is the pre-release baseline path: it retains the
   * previously shipped authority routes and exact-target convergence rules.
   */
  if (!args.suppressNuancedMarginOverlay && args.threeStateMarketAuthorityFactory) {
    const authorityFactory = args.threeStateMarketAuthorityFactory;
    const baseline = resolveNflTargetExcludedProduction({
      ...args,
      suppressNuancedMarginOverlay: true,
      threeStateMarketAuthorityFactory: (excludedFamiliesByMarket, evaluatedContract) => {
        const authority = authorityFactory(excludedFamiliesByMarket, evaluatedContract);
        return authority.reason === "qualified_named_price_flow_and_cross_market_consensus" ||
          authority.reason === "qualified_opposing_flow_and_cross_market_consensus"
          ? unavailableCandidateAuthority(authority)
          : authority;
      },
    });
    const initialTargets = evaluatedTargetFamilies(baseline.production.evaluatedBets, args.homeTeam);
    if (!initialTargets) return baseline;
    let marginExcluded = [...initialTargets.margin].sort();
    let contractLines = initialTargets.contractLines;
    const overlaySeen = new Set<string>();
    let safeResistance: typeof baseline | null = null;
    const familyBound = Math.min(
      9,
      new Set(args.comparableCurrentBooks.map((book) => normalizeBook(book.sportsbook)).filter(Boolean)).size + 1,
    );
    for (let iteration = 0; iteration < familyBound; iteration++) {
      const overlaySignature = JSON.stringify([marginExcluded, contractLines]);
      if (overlaySeen.has(overlaySignature)) return safeResistance ?? baseline;
      overlaySeen.add(overlaySignature);
      const authority = authorityFactory({
        moneyline: marginExcluded,
        spread: marginExcluded,
        total: initialTargets.total,
      }, splitContractCurrentFor(contractLines));
      const marginAnchor = resolveNflTargetExcludedMarketAnchor({
        books: args.comparableCurrentBooks,
        marginExcludedSportsbooks: marginExcluded,
        totalExcludedSportsbooks: initialTargets.total,
        evaluatedAt: args.evaluatedAt,
      });
      const classified = applyNflThreeStateMarketReader({
        forecast: baseline.outcome,
        authority,
        marketImpliedHomeMargin: marginAnchor ? inferNflTargetExcludedSpreadMean({
          independentForecast: args.baseOutcome,
          homeMarginBoundary: marginAnchor.homeMargin,
          homeCoverFairProbability: marginAnchor.spreadHomeFairProbability,
        }) : null,
      });
      const reader = classified.threeStateMarketReader;
      if (reader?.status !== "available") return safeResistance ?? baseline;

      if (reader.state === "value_resistance") {
        const gradeOnlyOutcome = {
          ...baseline.outcome,
          threeStateMarketReader: {
            ...reader,
            finalHomeMargin: reader.initialHomeMargin,
            spreadBoundaryCorrectionApplied: false,
          },
        };
        safeResistance = {
          ...baseline,
          outcome: gradeOnlyOutcome,
          production: applyNflThreeStateGradePolicy({
            baseline: baseline.production,
            candidate: baseline.production,
            outcome: gradeOnlyOutcome,
            demoteOpposedSpreadActionable: true,
          }),
        };
      }

      const candidate = applyNflThreeStateGradePolicy({
        baseline: baseline.production,
        candidate: buildProduction(classified),
        outcome: classified,
        demoteOpposedSpreadActionable: true,
      });
      const targets = evaluatedTargetFamilies(candidate.evaluatedBets, args.homeTeam);
      if (!targets) return safeResistance ?? baseline;
      if (targets.margin.every((family) => marginExcluded.includes(family)) &&
          JSON.stringify(targets.contractLines) === JSON.stringify(contractLines)) {
        return { ...baseline, outcome: classified, production: candidate };
      }
      marginExcluded = [...new Set([...marginExcluded, ...targets.margin])].sort();
      contractLines = targets.contractLines;
    }
    return safeResistance ?? baseline;
  }

  let production = buildProduction(args.incumbentOutcome);
  let excluded = evaluatedTargetFamilies(production.evaluatedBets, args.homeTeam);
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
      requireSameLineTotalPrices: args.pricedNeutralTotalCandidate === true,
    });
    if (!anchor) return fallback();
    const splitContractCurrent = splitContractCurrentFor(excluded.contractLines);
    const contractPlaybookSplits = targetContractPlaybookSplits(args.playbookSplits, args.playbookLine, excluded.contractLines);
    const contractSharpSplits = targetFreeSharpSplits(args.sharpSplits, excluded);
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
    const namedSequenceAuthority = args.namedSequenceAuthorityFactory
      ? args.namedSequenceAuthorityFactory({
          moneyline: excluded.margin,
          spread: excluded.margin,
          total: excluded.total,
        }, splitContractCurrent)
      : args.namedSequenceAuthority;
    const professionalMarketAuthority = args.professionalMarketAuthorityFactory
      ? args.professionalMarketAuthorityFactory({
          moneyline: excluded.margin,
          spread: excluded.margin,
          total: excluded.total,
        }, splitContractCurrent)
      : args.professionalMarketAuthority;
    diagnosticProfessionalAuthority = professionalMarketAuthority ?? null;
    const preThreeStateOutcome = (args.marketOutcomeBuilder ?? buildNflMarketEvidenceOutcomeForecast)({
      baseForecast: args.baseOutcome,
      footballHomeMargin: args.shadowMoneyline.footballProjection.projectedHomeMargin,
      current: targetFreeCurrent,
      operationalOpening: args.operationalOpening ?? null,
      playbookLine: args.playbookLine,
      playbookSplits: contractPlaybookSplits,
      sharpSplits: contractSharpSplits,
      splitContractCurrent,
      marketHomeCoverProbability: anchor.spreadHomeFairProbability,
      marketOverProbability: args.pricedNeutralTotalCandidate ? anchor.totalOverFairProbability : undefined,
      spreadDirectionCandidate: args.operationalOpening !== undefined && args.operationalOpening !== null,
      totalDirectionCandidate: args.totalDirectionCandidate === true &&
        args.operationalOpening !== undefined && args.operationalOpening !== null,
      movementCurrent: targetFreeMovementCurrent(args.current, excluded),
      weeklyRawSignal: args.weeklyRawSignal,
      paidTeamScore: args.paidTeamScore,
      namedSequenceAuthority,
      professionalMarketAuthority,
      evaluatedAt: args.evaluatedAt,
    });
    const unifiedOutcome = args.marketStateSnapshots
      ? applyNflUnifiedTotalMarketInterpreter({
          forecast: preThreeStateOutcome,
          independentForecast: args.baseOutcome,
          evaluatedAt: args.evaluatedAt,
          gameStartsAt: args.gameStartsAt,
          snapshots: args.marketStateSnapshots,
          current: args.current,
          splitContractCurrent,
          playbookLine: args.playbookLine,
          playbookSplits: contractPlaybookSplits,
          sharpSplits: contractSharpSplits,
          excludedFamilies: excluded.total,
          targetExcludedAnchor: anchor,
        })
      : preThreeStateOutcome;
    const threeStateAuthority = args.threeStateMarketAuthorityFactory?.({
      moneyline: excluded.margin,
      spread: excluded.margin,
      total: excluded.total,
    }, splitContractCurrent);
    const outcomeCandidate = threeStateAuthority
      ? applyNflThreeStateMarketReader({
          forecast: unifiedOutcome,
          authority: threeStateAuthority,
          marketImpliedHomeMargin: inferNflTargetExcludedSpreadMean({
            independentForecast: args.baseOutcome,
            homeMarginBoundary: anchor.homeMargin,
            homeCoverFairProbability: anchor.spreadHomeFairProbability,
          }),
        })
      : unifiedOutcome;
    const productionCandidate = applyNflThreeStateGradePolicy({
      baseline: buildProduction(unifiedOutcome),
      candidate: buildProduction(outcomeCandidate),
      outcome: outcomeCandidate,
    });
    const nextExcluded = evaluatedTargetFamilies(productionCandidate.evaluatedBets, args.homeTeam);
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
      const baselineOutcome = { ...unifiedOutcome, targetExclusion };
      const outcome = { ...outcomeCandidate, targetExclusion };
      const finalProduction = applyNflThreeStateGradePolicy({
        baseline: buildProduction(baselineOutcome),
        candidate: buildProduction(outcome),
        outcome,
      });
      const finalTargets = evaluatedTargetFamilies(finalProduction.evaluatedBets, args.homeTeam);
      if (!finalTargets) return fallback();
      if (targetFamilySignature(finalTargets) !== signature) {
        excluded = finalTargets;
        continue;
      }
      return { outcome, production: finalProduction, targetExclusion, diagnosticProfessionalAuthority };
    }
    production = productionCandidate;
    excluded = nextExcluded;
  }
  return fallback();
}

export function applyNflThreeStateGradePolicy(args: {
  baseline: NflV1ActionableGradeBundle;
  candidate: NflV1ActionableGradeBundle;
  outcome: NflV1WeekOneOutcomeForecast;
  demoteOpposedSpreadActionable?: boolean;
}): NflV1ActionableGradeBundle {
  const reader = args.outcome.threeStateMarketReader;
  if (!reader || reader.status !== "available") return args.candidate;
  const baselineByMarket = new Map(args.baseline.evaluatedBets.map((decision) => [decision.market, decision]));
  const evaluatedBets = args.candidate.evaluatedBets.map((decision) => {
    const baseline = baselineByMarket.get(decision.market);
    if (!baseline) return decision;
    if (decision.market === "total") return baseline;
    if (decision.market === "moneyline") {
      if (reader.state === "value_resistance" && actionable(decision.grade)) {
        return { ...decision, grade: "Watchlist" };
      }
      if (gradeRank(decision.grade) > gradeRank(baseline.grade) && actionable(decision.grade) &&
          !actionable(baseline.grade)) {
        return { ...decision, grade: "Watchlist" };
      }
      return decision;
    }
    const side = decision.side === args.outcome.homeTeam ? 1 : -1;
    if (args.demoteOpposedSpreadActionable === true && reader.state === "value_resistance" &&
        side !== reader.side && actionable(decision.grade)) {
      return { ...decision, grade: "Watchlist" };
    }
    const eligiblePromotion = reader.state === "value_resistance" &&
      reader.spreadBoundaryCorrectionApplied && baseline.grade === "Watchlist" &&
      side === reader.side && decision.expectedValue >= 0 &&
      decision.modelProbability >= decision.marketFairProbability;
    if (gradeRank(decision.grade) > gradeRank(baseline.grade)) {
      if (eligiblePromotion) return { ...decision, grade: "Lean" };
      if (actionable(decision.grade) && !actionable(baseline.grade)) {
        return { ...decision, grade: "Watchlist" };
      }
      return actionable(baseline.grade) ? { ...decision, grade: baseline.grade } : decision;
    }
    return eligiblePromotion && decision.grade === "Watchlist"
      ? { ...decision, grade: "Lean" }
      : decision;
  });
  return { ...args.candidate, evaluatedBets };
}

function actionable(grade: string): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function gradeRank(grade: string): number {
  return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0;
}

function unavailableCandidateAuthority(
  authority: NflThreeStateMarketAuthority,
): NflThreeStateMarketAuthority {
  return {
    ...authority,
    status: "unavailable",
    reason: "no_independent_flow_confirmation",
    side: null,
    outcomeBoundarySide: null,
    spreadBoundary: null,
    namedSources: [],
    confirmingSplitSources: [],
  };
}

/**
 * Target exclusion is market-family scoped. A sportsbook evaluated for Total
 * cannot contribute its Total movement, but that must not erase a separately
 * target-free moneyline/Spread trail from the same named book.
 */
function targetFreeMovementCurrent(
  current: NflPreviewBookOdds,
  excluded: NflEvaluatedTargetFamilies,
): NflPreviewBookOdds | null {
  const family = normalizeBook(current.sportsbook);
  const marginExcluded = excluded.margin.includes(family);
  const totalExcluded = excluded.total.includes(family);
  const result: NflPreviewBookOdds = {
    ...current,
    moneyline: marginExcluded ? null : current.moneyline,
    spread: marginExcluded ? null : current.spread,
    total: totalExcluded ? null : current.total,
  };
  return result.moneyline || result.spread || result.total ? result : null;
}

/**
 * Resolves target-free margin and total axes. Moneyline and Spread share the
 * margin distribution, so both evaluated operator families are removed from
 * that axis; Total removes only its own evaluated family.
 */
type NflTargetExcludedMarketAnchorArgs = {
  books: NflPreviewBookOdds[];
  marginExcludedSportsbooks: Iterable<string>;
  totalExcludedSportsbooks: Iterable<string>;
  evaluatedAt: string;
  freshnessMinutes?: number;
  minimumFamilies?: number;
  requireSameLineTotalPrices?: boolean;
};

export type NflTargetExcludedMarketAxes = {
  margin: Pick<NflTargetExcludedMarketAnchor, "release" | "homeMargin" |
    "spreadHomeFairProbability" | "marginFamilyCount" | "marginExcludedSportsbooks"> | null;
  total: Pick<NflTargetExcludedMarketAnchor, "release" | "total" |
    "totalOverFairProbability" | "totalFamilyCount" | "totalExcludedSportsbooks"> | null;
};

/** Compatibility for older whole-game consumers; new readers may consume either valid axis. */
export function resolveNflTargetExcludedMarketAnchor(args: NflTargetExcludedMarketAnchorArgs): NflTargetExcludedMarketAnchor | null {
  const axes = resolveNflTargetExcludedMarketAxes(args);
  return axes.margin && axes.total ? { ...axes.margin, ...axes.total } : null;
}

/** Missing or invalid evidence on one market cannot erase a separate valid market cohort. */
export function resolveNflTargetExcludedMarketAxes(args: NflTargetExcludedMarketAnchorArgs): NflTargetExcludedMarketAxes {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL target-excluded anchor evaluatedAt is invalid.");
  const freshnessMs = (args.freshnessMinutes ?? 120) * 60_000;
  const minimumFamilies = args.minimumFamilies ?? 3;
  const marginExcluded = normalizedSet(args.marginExcludedSportsbooks);
  const totalExcluded = normalizedSet(args.totalExcludedSportsbooks);
  const books = distinctLatestBooks(args.books);
  const marginBooks = books.filter((book) =>
    !marginExcluded.has(normalizeBook(book.sportsbook)) &&
    book.spread !== null && Number.isFinite(book.spread.homeLine) &&
    book.spread.awayLine === -book.spread.homeLine &&
    validPair(book.spread.homePrice, book.spread.awayPrice) &&
    isFresh(book.observedAt, evaluatedAt, freshnessMs)
  );
  const totalBooks = books.filter((book) =>
    !totalExcluded.has(normalizeBook(book.sportsbook)) &&
    book.total !== null && Number.isFinite(book.total.line) && book.total.line > 0 &&
    validPair(book.total.overPrice, book.total.underPrice) &&
    isFresh(book.observedAt, evaluatedAt, freshnessMs)
  );
  const marginPriceBooks = exactLineCohort(marginBooks, (book) => book.spread!.homeLine, minimumFamilies);
  const totalPriceBooks = exactLineCohort(totalBooks, (book) => book.total!.line, minimumFamilies);
  return {
    margin: marginPriceBooks ? {
      release: NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
      homeMargin: -marginPriceBooks[0]!.spread!.homeLine,
      spreadHomeFairProbability: median(marginPriceBooks.map((book) => twoSidedFair(
        book.spread!.homePrice,
        book.spread!.awayPrice,
      ))),
      marginFamilyCount: marginPriceBooks.length,
      marginExcludedSportsbooks: [...marginExcluded].sort(),
    } : null,
    total: totalPriceBooks ? {
      release: NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
      total: totalPriceBooks[0]!.total!.line,
      totalOverFairProbability: median(totalPriceBooks.map((book) => twoSidedFair(
        book.total!.overPrice,
        book.total!.underPrice,
      ))),
      totalFamilyCount: totalPriceBooks.length,
      totalExcludedSportsbooks: [...totalExcluded].sort(),
    } : null,
  };
}

/** A fair probability is meaningful only at the line quoted by those same books. */
function exactLineCohort(
  books: NflPreviewBookOdds[],
  line: (book: NflPreviewBookOdds) => number,
  minimumFamilies: number,
): NflPreviewBookOdds[] | null {
  if (books.length < minimumFamilies) return null;
  const center = median(books.map(line));
  const groups = new Map<number, NflPreviewBookOdds[]>();
  for (const book of books) {
    const value = line(book);
    groups.set(value, [...(groups.get(value) ?? []), book]);
  }
  return [...groups.values()].filter((rows) => rows.length >= minimumFamilies).sort((first, second) =>
    second.length - first.length ||
    Math.abs(line(first[0]!) - center) - Math.abs(line(second[0]!) - center) ||
    line(first[0]!) - line(second[0]!))[0] ?? null;
}

function validPair(first: number, second: number): boolean {
  if (!Number.isFinite(first) || !Number.isFinite(second) || first === 0 || second === 0) return false;
  const hold = americanImplied(first) + americanImplied(second);
  return hold >= 0.8 && hold <= 1.2;
}

export function resolveNflTargetExcludedMoneylineHomeProbability(args: {
  books: NflPreviewBookOdds[];
  excludedSportsbooks: Iterable<string>;
  evaluatedAt: string;
  freshnessMinutes?: number;
  minimumFamilies?: number;
}): number | null {
  return resolveNflTargetExcludedMoneylineAnchor(args)?.homeFairProbability ?? null;
}

export function resolveNflTargetExcludedMoneylineAnchor(args: {
  books: NflPreviewBookOdds[];
  excludedSportsbooks: Iterable<string>;
  evaluatedAt: string;
  freshnessMinutes?: number;
  minimumFamilies?: number;
}): { homeFairProbability: number; familyCount: number } | null {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL target-excluded Moneyline evaluatedAt is invalid.");
  const freshnessMs = (args.freshnessMinutes ?? 120) * 60_000;
  const minimumFamilies = args.minimumFamilies ?? 3;
  const excluded = normalizedSet(args.excludedSportsbooks);
  const books = distinctLatestBooks(args.books).filter((book) =>
    !excluded.has(normalizeBook(book.sportsbook)) && book.moneyline !== null &&
    validPair(book.moneyline.homePrice, book.moneyline.awayPrice) &&
    isFresh(book.observedAt, evaluatedAt, freshnessMs));
  if (books.length < minimumFamilies) return null;
  return { familyCount: books.length, homeFairProbability: median(books.map((book) => twoSidedFair(
    book.moneyline!.homePrice,
    book.moneyline!.awayPrice,
  ))) };
}

function evaluatedTargetFamilies(
  decisions: NflV1ActionableGradeBundle["evaluatedBets"],
  homeTeam: string,
): NflEvaluatedTargetFamilies | null {
  const byMarket = Object.fromEntries(decisions.map((decision) => [
    decision.market,
    normalizeBook(decision.evaluatedQuote.sportsbook),
  ])) as Partial<NflEvaluatedTargetFamilies["byMarket"]>;
  if (!byMarket.moneyline || !byMarket.spread || !byMarket.total) return null;
  const complete = byMarket as NflEvaluatedTargetFamilies["byMarket"];
  const spread = decisions.find((decision) => decision.market === "spread");
  const total = decisions.find((decision) => decision.market === "total");
  return {
    byMarket: complete,
    margin: [...new Set([complete.moneyline, complete.spread])],
    total: [complete.total],
    contractLines: {
      homeSpread: spread?.evaluatedQuote.line == null ? null
        : spread.side === homeTeam ? spread.evaluatedQuote.line : -spread.evaluatedQuote.line,
      total: total?.evaluatedQuote.line ?? null,
    },
  };
}

function targetFamilySignature(value: NflEvaluatedTargetFamilies): string {
  return [value.byMarket.moneyline, value.byMarket.spread, value.contractLines?.homeSpread,
    value.byMarket.total, value.contractLines?.total].join("|");
}

export function targetFreeSharpSplits(
  value: NflRegularSharpSplitSet | null,
  excluded: NflEvaluatedTargetFamilies,
): NflRegularSharpSplitSet | null {
  if (!value) return null;
  const mask = (row: NflRegularSharpSplitSet["moneyline"]): NflRegularSharpSplitSet["moneyline"] => ({
    ...row,
    homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null,
    overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
  });
  return {
    moneyline: excluded.margin.includes(normalizeBook(value.moneyline.sourceSportsbook))
      ? mask(value.moneyline)
      : value.moneyline,
    spread: excluded.margin.includes(normalizeBook(value.spread.sourceSportsbook)) ||
      (excluded.contractLines !== undefined && !exactContractLine(value.spread.sourceLine, excluded.contractLines.homeSpread))
      ? mask(value.spread)
      : value.spread,
    total: excluded.total.includes(normalizeBook(value.total.sourceSportsbook)) ||
      (excluded.contractLines !== undefined && !exactContractLine(value.total.sourceLine, excluded.contractLines.total))
      ? mask(value.total)
      : value.total,
  };
}

function exactContractLine(source: number | null | undefined, target: number | null | undefined): boolean {
  return typeof source === "number" && Number.isFinite(source) && typeof target === "number" &&
    Number.isFinite(target) && Math.abs(source - target) < 1e-9;
}

function splitContractCurrentFor(lines: NflEvaluatedTargetFamilies["contractLines"]): EvaluatedContract {
  return {
    spread: lines?.homeSpread == null ? null : { homeLine: lines.homeSpread },
    total: lines?.total == null ? null : { line: lines.total },
  };
}

export function targetContractPlaybookSplits(
  value: NflForwardPlaybookSplitSet | null,
  line: NflForwardPlaybookLine | null,
  contract: NflEvaluatedTargetFamilies["contractLines"],
): NflForwardPlaybookSplitSet | null {
  if (!value || !contract) return value;
  const mask = (row: NflForwardPlaybookSplitSet["moneyline"]) => row && ({ ...row,
    homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null,
    overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
  });
  return { ...value,
    spread: exactContractLine(line?.homeSpread, contract.homeSpread) ? value.spread : mask(value.spread),
    total: exactContractLine(line?.total, contract.total) ? value.total : mask(value.total),
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

function twoSidedFair(selectedPrice: number, opposingPrice: number): number {
  const selected = americanImplied(selectedPrice);
  const opposing = americanImplied(opposingPrice);
  return selected / (selected + opposing);
}

function americanImplied(price: number): number {
  if (!Number.isFinite(price) || price === 0) throw new Error("NFL target-excluded price must be non-zero American odds.");
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}
