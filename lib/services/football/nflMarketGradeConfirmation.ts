import {assessNflUnchangedMoneylineConfirmation,type NflUnchangedMoneylineProof} from './nflUnchangedMoneylineConfirmation';
import type {NflEpisodeHistoryBook} from './nflMoneylineEpisodeTransport';
import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import type { NflRegularEvaluatedBetDecision } from "./nflRegularDecisionEvidence";
import type { NflMarketInnovationReceipt } from "./nflMarketInnovationRuntime";
import type { NflV1WeekOneOutcomeForecast } from "./nflV1WeekOneOutcome";
import { nflV1WeekOneLineProbabilities } from "./nflV1WeekOneOutcome";
import { nflMarketQualificationMatches, nflPairedReferenceBooksAt, nflMarketSourceAt, nflSportsbookFamily,
  type NflMarketQualificationReceipt } from "./nflMarketQualification";
import { NFL_V1_BEST_ANGLE_MINIMUM_MODELED_WIN_PROBABILITY,
  NFL_V1_GRADE_MINIMUM_AMERICAN_PRICE, NFL_V1_GRADE_MAXIMUM_AMERICAN_PRICE } from "./nflV1ProductionDecision";
import {
  NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_EXPECTED_VALUE,
  NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_AMERICAN_PRICE,
  NFL_V1_SPREAD_BEST_ANGLE_MINIMUM_EXPECTED_VALUE, NFL_V1_TOTAL_BEST_ANGLE_MINIMUM_EXPECTED_VALUE,
  NFL_V1_SPREAD_LEAN_MINIMUM_PROBABILITY, NFL_V1_SPREAD_LEAN_MINIMUM_EXPECTED_VALUE,
  NFL_V1_SPREAD_LEAN_MINIMUM_EDGE_PERCENTAGE_POINTS,
  NFL_V1_TOTAL_MOVEMENT_LEAN_MINIMUM_PROBABILITY, NFL_V1_TOTAL_LEAN_MINIMUM_EXPECTED_VALUE,
  NFL_V1_TOTAL_LEAN_MINIMUM_EDGE_PERCENTAGE_POINTS,
} from "./nflV1ActionableGradeCandidate";

type Market = "moneyline" | "spread" | "total";
export type NflMarketGradePromotionContext = {
  independentForecast: NflV1WeekOneOutcomeForecast;
  finalForecast: NflV1WeekOneOutcomeForecast;
  marketQualification: Partial<Record<Market, NflMarketQualificationReceipt>>;
  books: NflPreviewBookOdds[];
  referenceBooks?: NflPreviewBookOdds[];
  /** Original source pairs with native identity and actual capture availability. */
  sourceHistory?: NflEpisodeHistoryBook[];
  /** Successful current executable-quote batch availability, not last price-change time. */
  executionAvailableAt: string;
};
export type NflMarketGradeConfirmation = {
  unchangedMoneylineProof?: NflUnchangedMoneylineProof[];
  supportingSources: string[];
  convictionRiskSources: string[];
  heldResistanceSources: string[];
  priorProbability: number | null;
  finalProbability: number | null;
  executionQualified: boolean;
  sourceQualified: boolean;
  executionAvailableAt?: string;
  executionRequestedAt?: string;
  sourceObservedAt?: string;
  sourceEconomicMoveAt?: string;
  leanEligible: boolean;
  bestAngleEligible: boolean;
  reason: string;
};

/** Market conviction interprets an already applied consequence. It adds no
 * second probability update, independent evidence vote or source-count bonus. */
export function assessNflMarketGradeConfirmation(args: {
  decision: NflRegularEvaluatedBetDecision; innovation: NflMarketInnovationReceipt;
  homeTeam: string; context?: NflMarketGradePromotionContext;
}): NflMarketGradeConfirmation {
  const { decision: d, innovation: read, context: c } = args;
  const direction = d.market === "total" ? /^Over\s/i.test(d.side) ? 1 : /^Under\s/i.test(d.side) ? -1 : null
    : d.side === args.homeTeam ? 1 : -1;
  const result: NflMarketGradeConfirmation = { supportingSources: [], convictionRiskSources: [], heldResistanceSources: [],
    priorProbability: null, finalProbability: null, executionQualified: false, sourceQualified: false,
    leanEligible: false, bestAngleEligible: false, reason: "no_bound_promotion_context" };
  const at = Date.parse(d.evaluatedAt);
  if (direction === null) return { ...result, reason: "unknown_picked_direction" };
  const fresh = (stamp: string | null | undefined) => Number.isFinite(Date.parse(stamp ?? "")) &&
    Date.parse(stamp!) <= at && at - Date.parse(stamp!) <= 120 * 60_000;
  const paths = (read.paths ?? []).filter(path => path.market === d.market && fresh(path.currentAt));
  for (const path of paths) if (direction !== null && path.latestEconomicDirection === -direction) {
    result.convictionRiskSources.push(`${path.book}:current_opposing_economic_leg`);
  }
  // Interpret effort versus actual response at the source's own contract.
  // Opposing money met by a held price resists that pressure; it is not an
  // automatic veto of our pick or a newly invented directional score move.
  const latestPressure = new Map<string, { flow: NonNullable<NonNullable<NflMarketInnovationReceipt["reactionContext"]>[Market]>["flows"][number]; conflicted: boolean }>();
  for (const flow of read.reactionContext?.[d.market]?.flows ?? []) {
    if (flow.authority !== "source_contract_reaction_context_only" || !flow.book || !flow.sourceEventId ||
      flow.providerGameId !== d.providerGameId || !fresh(flow.observedAt)) continue;
    const key = nflSportsbookFamily(flow.book), previous = latestPressure.get(key);
    const clock = Date.parse(flow.observedAt), previousClock = Date.parse(previous?.flow.observedAt ?? "");
    if (!previous || clock > previousClock) latestPressure.set(key, { flow, conflicted: false });
    else if (clock === previousClock && JSON.stringify([flow.direction, flow.sourceLine, flow.moneyPct, flow.ticketPct, flow.sourceEventId]) !==
      JSON.stringify([previous.flow.direction, previous.flow.sourceLine, previous.flow.moneyPct, previous.flow.ticketPct, previous.flow.sourceEventId])) {
      previous.conflicted = true;
    }
  }
  for (const { flow, conflicted } of latestPressure.values()) {
    if (conflicted) { result.convictionRiskSources.push(`${flow.book}:conflicting_current_named_pressure`); continue; }
    const path = paths.find(path => nflSportsbookFamily(path.book) === nflSportsbookFamily(flow.book!));
    const baselineAt = Date.parse(flow.reactionBaselineObservedAt ?? flow.pairedQuoteObservedAt ?? "");
    const flowAt = Date.parse(flow.observedAt);
    if (!path || !Number.isFinite(baselineAt) || baselineAt > flowAt ||
        flowAt - baselineAt > 120 * 60_000 || Date.parse(path.currentAt!) <= flowAt) {
      if (flow.direction === -direction) result.convictionRiskSources.push(`${flow.book}:unmatched_named_pressure`);
      continue;
    }
    const baseline = path.coordinates.filter(point => Date.parse(point.observedAt) <= baselineAt).at(-1);
    if (!baseline) continue;
    const response = path.netMagnitude - baseline.displacement;
    if (Math.abs(response) <= 1e-9) {
      if (flow.direction === direction) {
        result.heldResistanceSources.push(flow.book!);
        result.convictionRiskSources.push(`${flow.book}:held_against_picked_side_pressure`);
      }
    } else if (Math.sign(response) === -direction) {
      result.convictionRiskSources.push(`${flow.book}:timed_price_reaction_against_pick`);
    }
  }
  result.convictionRiskSources = [...new Set(result.convictionRiskSources)].sort();
  result.heldResistanceSources = [...new Set(result.heldResistanceSources)].sort();
  if (!c || direction === null || c.finalForecast.providerGameId !== d.providerGameId ||
      c.independentForecast.providerGameId !== d.providerGameId || c.finalForecast.homeTeam !== args.homeTeam ||
      c.independentForecast.homeTeam !== args.homeTeam || d.market !== "total" &&
      d.side !== c.finalForecast.homeTeam && d.side !== c.finalForecast.awayTeam) return result;
  const unchanged = assessNflUnchangedMoneylineConfirmation({decision:d,innovation:read,context:c,
    direction,convictionRiskSources:result.convictionRiskSources});
  if (unchanged) return {...result,...unchanged};
  const qualification = c.marketQualification[d.market];
  if (qualification?.basis !== "source_bound_joint_innovation" || !nflMarketQualificationMatches({
    receipt: qualification, market: d.market, providerGameId: d.providerGameId, evaluatedAt: d.evaluatedAt,
    gameStartsAt: d.gameStartsAt, forecast: c.finalForecast,
  })) return { ...result, reason: "final_market_law_not_qualified" };
  const source = read.selectedSources[d.market];
  const path = paths.find(path => path.book === source);
  const episode = read.episodes.find(episode => episode.market === d.market && episode.book === source && episode.selected);
  if (!source || !path || !episode || episode.direction !== direction || path.netDirection !== direction ||
      path.latestEconomicDirection !== direction || path.sourcePosture !== "supports_net" || path.hasUnresolvedAdverseLeg ||
      path.reason !== "same_book_paired_economic_path" || episode.currentAt !== path.currentAt ||
      episode.openingAt !== path.openingAt || !(Date.parse(path.openingAt!) < Date.parse(path.currentAt!)) ||
      !(Math.abs(episode.magnitude) > 1e-12) || !read.constraints.some(constraint => constraint.market === d.market &&
        Math.abs(constraint.targetProbability - constraint.achievedProbability) < 1e-7) ||
      read.marketQualificationStatus?.[d.market]?.status !== "applied") {
    return { ...result, reason: "no_clean_applied_same_market_consequence" };
  }
  result.supportingSources = [source];
  result.sourceQualified = true;
  if (nflSportsbookFamily(source) === nflSportsbookFamily(d.evaluatedQuote.sportsbook)) {
    return { ...result, reason: "evaluated_book_cannot_confirm_itself" };
  }
  const execution = nflPairedReferenceBooksAt({ books: c.books, market: d.market, providerGameId: d.providerGameId,
    evaluatedAt: d.evaluatedAt, gameStartsAt: d.gameStartsAt, executionOnly: true }).find(book =>
      nflSportsbookFamily(book.sportsbook) === nflSportsbookFamily(d.evaluatedQuote.sportsbook) &&
      nflMarketSourceAt(book, d.market) === d.evaluatedQuote.observedAt &&
      (d.market === "moneyline" ? d.evaluatedQuote.line === null &&
        (direction === 1 ? book.moneyline!.homePrice : book.moneyline!.awayPrice) === d.evaluatedQuote.price
        : d.market === "spread" ? (direction === 1 ? book.spread!.homeLine : book.spread!.awayLine) === d.evaluatedQuote.line &&
          (direction === 1 ? book.spread!.homePrice : book.spread!.awayPrice) === d.evaluatedQuote.price
          : book.total!.line === d.evaluatedQuote.line &&
            (direction === 1 ? book.total!.overPrice : book.total!.underPrice) === d.evaluatedQuote.price));
  if (!execution) return { ...result, reason: "exact_executable_pair_unavailable" };
  const availableStamp = execution.availableAt ?? c.executionAvailableAt;
  const availableAt = Date.parse(availableStamp);
  const requestedStamp = execution.requestedAt ?? availableStamp;
  const requestedAt = Date.parse(requestedStamp);
  const moveAt = Date.parse(path.latestEconomicMoveAt ?? "");
  result.executionAvailableAt = availableStamp;
  result.executionRequestedAt = requestedStamp;
  result.sourceObservedAt = path.currentAt!;
  result.sourceEconomicMoveAt = path.latestEconomicMoveAt ?? undefined;
  if (!Number.isFinite(availableAt) || availableAt > at || !Number.isFinite(requestedAt) || requestedAt > availableAt ||
      !Number.isFinite(moveAt) || moveAt > Date.parse(path.currentAt!) || requestedAt < moveAt ||
      Date.parse(d.evaluatedQuote.observedAt) > availableAt) {
    return { ...result, reason: "execution_not_reobserved_after_source" };
  }
  const refs = nflPairedReferenceBooksAt({ books: [...c.books, ...(c.referenceBooks ?? [])], market: d.market,
    providerGameId: d.providerGameId, evaluatedAt: d.evaluatedAt, gameStartsAt: d.gameStartsAt }).filter(book =>
      nflSportsbookFamily(book.sportsbook) !== nflSportsbookFamily(execution.sportsbook) &&
      (d.market === "moneyline" || (d.market === "spread" ? book.spread!.homeLine === execution.spread!.homeLine
        : book.total!.line === execution.total!.line)));
  const familyCount = d.market === "moneyline" ? refs.length : d.market === "spread"
    ? c.finalForecast.targetExclusion?.marginFamilyCount ?? 0 : c.finalForecast.targetExclusion?.totalFamilyCount ?? 0;
  if (!refs.length || refs.length < 2 && !(d.market !== "moneyline" && familyCount >= 3 &&
      c.finalForecast.targetExclusion?.status === "target_excluded_market")) {
    return { ...result, reason: "exact_comparator_reliability_unavailable" };
  }
  const probability = (f: NflV1WeekOneOutcomeForecast) => {
    const p = nflV1WeekOneLineProbabilities({ forecast: f, homeSpread: d.market === "spread"
      ? direction === 1 ? d.evaluatedQuote.line! : -d.evaluatedQuote.line! : 0,
      totalLine: d.market === "total" ? d.evaluatedQuote.line! : 0 });
    return d.market === "moneyline" ? direction === 1 ? f.homeWinProbability : f.awayWinProbability
      : d.market === "spread" ? direction === 1 ? p.spread.homeCoverProbability : p.spread.awayCoverProbability
        : direction === 1 ? p.total.overProbability : p.total.underProbability;
  };
  result.priorProbability = probability(c.independentForecast);
  result.finalProbability = probability(c.finalForecast);
  const price = d.evaluatedQuote.price;
  const implied = (p: number) => p > 0 ? 100 / (100 + p) : -p / (100 - p);
  const fair = refs.reduce((sum, book) => {
    const pair = d.market === "moneyline" ? [book.moneyline!.homePrice, book.moneyline!.awayPrice]
      : d.market === "spread" ? [book.spread!.homePrice, book.spread!.awayPrice]
        : [book.total!.overPrice, book.total!.underPrice];
    return sum + implied(pair[direction === 1 ? 0 : 1]!) / (implied(pair[0]!) + implied(pair[1]!));
  }, 0) / refs.length;
  const ev = (1 - (d.pushProbability ?? 0)) * (d.modelProbability * (price > 0 ? price / 100 : 100 / -price) - (1 - d.modelProbability));
  if (Math.abs(result.finalProbability - d.modelProbability) > 1e-8 ||
      Math.abs(ev - d.expectedValue) > 1e-8 || Math.abs(fair - d.marketFairProbability) > 1e-8) {
    return { ...result, reason: "decision_does_not_match_final_law_or_price" };
  }
  result.executionQualified = true;
  if (!(result.finalProbability - result.priorProbability > 1e-9)) return { ...result, reason: "exact_contract_probability_not_improved" };
  if (result.convictionRiskSources.length) return { ...result, reason: "market_conviction_unresolved" };
  const cushion = d.market === "moneyline" ? 1 : d.market === "spread"
    ? direction * (c.finalForecast.expectedHomeScore - c.finalForecast.expectedAwayScore) + d.evaluatedQuote.line!
    : direction * (c.finalForecast.expectedHomeScore + c.finalForecast.expectedAwayScore - d.evaluatedQuote.line!);
  const edge = 100 * (d.modelProbability - d.marketFairProbability);
  const positive = d.modelProbability > .5 && d.expectedValue > 0 && edge > 0 && cushion > 0;
  const lean = d.market === "moneyline" ? positive && price >= NFL_V1_GRADE_MINIMUM_AMERICAN_PRICE && price <= NFL_V1_GRADE_MAXIMUM_AMERICAN_PRICE
    : positive && price >= -200 && price <= 200 && (d.market === "spread"
      ? d.modelProbability >= NFL_V1_SPREAD_LEAN_MINIMUM_PROBABILITY && d.expectedValue >= NFL_V1_SPREAD_LEAN_MINIMUM_EXPECTED_VALUE &&
        edge >= NFL_V1_SPREAD_LEAN_MINIMUM_EDGE_PERCENTAGE_POINTS
      : d.modelProbability >= NFL_V1_TOTAL_MOVEMENT_LEAN_MINIMUM_PROBABILITY && d.expectedValue >= NFL_V1_TOTAL_LEAN_MINIMUM_EXPECTED_VALUE &&
        edge >= NFL_V1_TOTAL_LEAN_MINIMUM_EDGE_PERCENTAGE_POINTS);
  const best = lean && d.modelProbability >= NFL_V1_BEST_ANGLE_MINIMUM_MODELED_WIN_PROBABILITY && price >= -200 &&
    price <= (d.market === "moneyline" ? NFL_V1_GRADE_MAXIMUM_AMERICAN_PRICE : 200) &&
    (d.market === "moneyline" ? price >= NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_AMERICAN_PRICE &&
      d.expectedValue >= NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_EXPECTED_VALUE
      : d.market === "spread" ? d.expectedValue >= NFL_V1_SPREAD_BEST_ANGLE_MINIMUM_EXPECTED_VALUE
        : d.expectedValue >= NFL_V1_TOTAL_BEST_ANGLE_MINIMUM_EXPECTED_VALUE);
  return { ...result, leanEligible: lean, bestAngleEligible: best,
    reason: lean ? "qualified_applied_market_confirmation" : "positive_price_confidence_or_cushion_not_qualified" };
}
