import {
  selectNflNamedMoneylineEpisodeAfterKnowledge,
  selectNflNamedPricedLineEpisodeAfterKnowledge,
  transportNflMoneylineEpisode,
  transportNflPricedLineEpisode,
  type NflNamedMoneylineEpisode,
  type NflPricedLineEpisode,
} from "./nflMoneylineEpisodeTransport";
import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import {
  buildNflReconciledEvidenceDistributionForecast,
  buildNflUnifiedMarketAdjustedForecast,
  nflV1WeekOneLineProbabilities,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_JOINT_MARKET_EPISODE_READ_CANDIDATE_RELEASE =
  "nfl_joint_market_episode_read_candidate_2026_11_01_r3_independent_market_innovations" as const;

type Constraint = { boundary: number; target: number; market: "moneyline" | "spread" | "total" };

export type NflJointMarketEpisodeRead = {
  release: typeof NFL_JOINT_MARKET_EPISODE_READ_CANDIDATE_RELEASE;
  status: "applied" | "neutral" | "unidentified";
  reason: string;
  outcome: NflV1WeekOneOutcomeForecast;
  selectedSources: Partial<Record<"moneyline" | "spread" | "total", string>>;
  informationOverlap?: "not_attested";
  axisReasons?: { margin?: string; total?: string };
  constraints: Array<{ market: Constraint["market"]; targetProbability: number; achievedProbability: number }>;
};

/** Produce a fully provenance-bound read for each book; do not invent cross-book episodes. */
export function readNflJointMarketEpisodesByBook(args: {
  statisticalForecast: NflV1WeekOneOutcomeForecast;
  statisticalKnowledgeAt: string | null;
  informationOverlap?: "not_attested";
  evaluatedAt: string;
  gameStartsAt?: string;
  history: NflPreviewBookOdds[];
  /** The evaluated sportsbook for each market cannot grade itself. */
  excludedFamiliesByMarket?: Record<"moneyline" | "spread" | "total", string[]>;
}): Record<"circa" | "pinnacle", NflJointMarketEpisodeRead> {
  const read = (sportsbook: "circa" | "pinnacle") => {
    const shared = {
      history: args.history,
      sportsbook,
      providerGameId: args.statisticalForecast.providerGameId,
      statisticalKnowledgeAt: args.statisticalKnowledgeAt,
      evaluatedAt: args.evaluatedAt,
      informationOverlap: args.informationOverlap,
      gameStartsAt: args.gameStartsAt,
    };
    const admitted = (market: "moneyline" | "spread" | "total") =>
      !(args.excludedFamiliesByMarket?.[market] ?? [])
        .some((family) => family.toLowerCase().replace(/[^a-z0-9]+/g, "") === sportsbook);
    return readNflJointMarketEpisode({
      statisticalForecast: args.statisticalForecast,
      statisticalKnowledgeAt: args.statisticalKnowledgeAt,
      informationOverlap: args.informationOverlap,
      moneyline: admitted("moneyline") ? selectNflNamedMoneylineEpisodeAfterKnowledge(shared) : null,
      spread: admitted("spread")
        ? selectNflNamedPricedLineEpisodeAfterKnowledge({ ...shared, market: "spread" }) : null,
      total: admitted("total")
        ? selectNflNamedPricedLineEpisodeAfterKnowledge({ ...shared, market: "total" }) : null,
    });
  };
  return { circa: read("circa"), pinnacle: read("pinnacle") };
}

export type NflNamedBookReconciliation = {
  status: "applied" | "neutral" | "conflicted";
  outcome: NflV1WeekOneOutcomeForecast;
  marginSource: "circa" | "pinnacle" | null;
  totalSource: "circa" | "pinnacle" | null;
  marginReason: "one_moving_book" | "same_direction_smaller_move" | "opposed_book_moves" | "no_move";
  totalReason: "one_moving_book" | "same_direction_smaller_move" | "opposed_book_moves" | "no_move";
};

export const NFL_JOINT_MARKET_GAP_FILL_CANDIDATE_RELEASE =
  "nfl_joint_market_gap_fill_candidate_2026_10_31_r1_no_double_application" as const;

/**
 * Preserve an already-published axis of the current market reader. Only an
 * untouched axis may receive a new named-book episode consequence. This is
 * a bounded repair candidate, not a claim that all existing market reads
 * are correct or that contradictory books have been adjudicated.
 */
export function mergeNflJointEpisodeIntoUntouchedAxes(args: {
  independentForecast: NflV1WeekOneOutcomeForecast;
  incumbentForecast: NflV1WeekOneOutcomeForecast;
  reconciliation: NflNamedBookReconciliation;
}): {
  release: typeof NFL_JOINT_MARKET_GAP_FILL_CANDIDATE_RELEASE;
  outcome: NflV1WeekOneOutcomeForecast;
  margin: "episode_applied" | "already_market_adjusted" | "no_resolved_episode";
  total: "episode_applied" | "already_market_adjusted" | "no_resolved_episode";
} {
  const { independentForecast: independent, incumbentForecast: incumbent, reconciliation } = args;
  if (independent.providerGameId !== incumbent.providerGameId ||
      independent.homeTeam !== incumbent.homeTeam || independent.awayTeam !== incumbent.awayTeam) {
    throw new Error("NFL joint episode cannot cross game identities.");
  }
  const same = (first: NflV1WeekOneOutcomeForecast["marginDistribution"],
    second: NflV1WeekOneOutcomeForecast["marginDistribution"]) =>
    first.values.length === second.values.length &&
    first.values.every((value, index) => value === second.values[index] &&
      Math.abs((first.probabilities[index] ?? 0) - (second.probabilities[index] ?? 0)) < 1e-9);
  const untouchedMargin = same(independent.marginDistribution, incumbent.marginDistribution);
  const untouchedTotal = same(independent.totalDistribution, incumbent.totalDistribution);
  const margin = !reconciliation.marginSource ? "no_resolved_episode" as const
    : untouchedMargin ? "episode_applied" as const : "already_market_adjusted" as const;
  const total = !reconciliation.totalSource ? "no_resolved_episode" as const
    : untouchedTotal ? "episode_applied" as const : "already_market_adjusted" as const;
  const outcome = margin === "episode_applied" || total === "episode_applied"
    ? buildNflReconciledEvidenceDistributionForecast({
        baseForecast: incumbent,
        marginProbabilities: margin === "episode_applied"
          ? reconciliation.outcome.marginDistribution.probabilities
          : incumbent.marginDistribution.probabilities,
        totalProbabilities: total === "episode_applied"
          ? reconciliation.outcome.totalDistribution.probabilities
          : incumbent.totalDistribution.probabilities,
      })
    : incumbent;
  return { release: NFL_JOINT_MARKET_GAP_FILL_CANDIDATE_RELEASE, outcome, margin, total };
}

/**
 * Do not add two book updates as though they were independent bettors.
 * A lone move is usable, and concordant moves admit the smaller observed
 * displacement as the corroborated floor. Opposed moves remain explicit
 * conflict for the later full evidence read (flow, resistance and recency),
 * rather than silently granting either book authority.
 */
export function reconcileNflNamedBookEpisodeReads(args: {
  statisticalForecast: NflV1WeekOneOutcomeForecast;
  reads: Record<"circa" | "pinnacle", NflJointMarketEpisodeRead>;
}): NflNamedBookReconciliation {
  const base = args.statisticalForecast;
  const priorMargin = base.expectedHomeScore - base.expectedAwayScore;
  const priorTotal = base.expectedHomeScore + base.expectedAwayScore;
  const choose = (axis: "margin" | "total") => {
    const effect = (book: "circa" | "pinnacle") => {
      const read = args.reads[book];
      if (read.status !== "applied") return 0;
      const outcome = read.outcome;
      const mean = axis === "margin"
        ? outcome.expectedHomeScore - outcome.expectedAwayScore
        : outcome.expectedHomeScore + outcome.expectedAwayScore;
      const prior = axis === "margin" ? priorMargin : priorTotal;
      const meanDelta = mean - prior;
      return Math.abs(meanDelta) > 1e-9 ? meanDelta : axis === "margin"
        ? outcome.homeWinProbability - base.homeWinProbability : 0;
    };
    const circa = effect("circa");
    const pinnacle = effect("pinnacle");
    if (Math.abs(circa) < 1e-9 && Math.abs(pinnacle) < 1e-9) {
      return { source: null, reason: "no_move" as const };
    }
    if (Math.abs(circa) < 1e-9 || Math.abs(pinnacle) < 1e-9) {
      return { source: Math.abs(circa) >= 1e-9 ? "circa" as const : "pinnacle" as const,
        reason: "one_moving_book" as const };
    }
    if (Math.sign(circa) !== Math.sign(pinnacle)) {
      return { source: null, reason: "opposed_book_moves" as const };
    }
    return { source: Math.abs(circa) <= Math.abs(pinnacle) ? "circa" as const : "pinnacle" as const,
      reason: "same_direction_smaller_move" as const };
  };
  const margin = choose("margin");
  const total = choose("total");
  const marginProbabilities = margin.source
    ? args.reads[margin.source].outcome.marginDistribution.probabilities
    : base.marginDistribution.probabilities;
  const totalProbabilities = total.source
    ? args.reads[total.source].outcome.totalDistribution.probabilities
    : base.totalDistribution.probabilities;
  let outcome = base;
  if (margin.source || total.source) {
    try {
      outcome = buildNflReconciledEvidenceDistributionForecast({
        baseForecast: base, marginProbabilities, totalProbabilities,
      });
    } catch {
      return {
        status: "conflicted", outcome: base, marginSource: null, totalSource: null,
        marginReason: "opposed_book_moves", totalReason: "opposed_book_moves",
      };
    }
  }
  return {
    status: margin.source || total.source ? "applied"
      : margin.reason === "opposed_book_moves" || total.reason === "opposed_book_moves" ? "conflicted" : "neutral",
    outcome, marginSource: margin.source, totalSource: total.source,
    marginReason: margin.reason, totalReason: total.reason,
  };
}

/**
 * Reconcile one selected physical source per margin episode into a single
 * discrete margin law. Moneyline and Spread are constraints on that SAME law,
 * never additive point shifts or independent votes. Total is a constraint on
 * the scoring law. The prior score distribution remains one input; valid
 * economic episode displacements can change its probabilities and means.
 * Source selection, injury/news overlap, and grades are separate decisions.
 */
export function readNflJointMarketEpisode(args: {
  statisticalForecast: NflV1WeekOneOutcomeForecast;
  statisticalKnowledgeAt: string | null;
  informationOverlap?: "not_attested";
  moneyline: NflNamedMoneylineEpisode | null;
  spread: NflPricedLineEpisode | null;
  total: NflPricedLineEpisode | null;
}): NflJointMarketEpisodeRead {
  const base = args.statisticalForecast;
  const sources: NflJointMarketEpisodeRead["selectedSources"] = {};
  const axisReasons: NonNullable<NflJointMarketEpisodeRead["axisReasons"]> = {};
  const overlap = args.statisticalKnowledgeAt === null && args.informationOverlap === "not_attested"
    ? { informationOverlap: "not_attested" as const } : {};
  const neutral = (status: NflJointMarketEpisodeRead["status"], reason: string): NflJointMarketEpisodeRead => ({
    release: NFL_JOINT_MARKET_EPISODE_READ_CANDIDATE_RELEASE,
    status, reason, outcome: base, selectedSources: {}, constraints: [], axisReasons, ...overlap,
  });
  let marginConstraints: Constraint[] = [];
  let totalConstraints: Constraint[] = [];
  let marginChanged = false;
  let totalChanged = false;
  const shared = { statisticalForecast: base, statisticalKnowledgeAt: args.statisticalKnowledgeAt,
    informationOverlap: args.informationOverlap };
  if (args.spread && args.spread.market !== "spread") {
    axisReasons.margin = "market_contract_mismatch";
  } else if (args.moneyline && args.spread && args.moneyline.source !== args.spread.source) {
    axisReasons.margin = "cross_book_margin_synthesis_rejected";
  } else {
    if (args.moneyline) {
      const transported = transportNflMoneylineEpisode({ ...shared, episode: args.moneyline });
      if (transported.status === "unidentified") axisReasons.margin = `moneyline:${transported.reason}`;
      else {
        sources.moneyline = args.moneyline.source;
        marginChanged ||= transported.status === "transported";
        marginConstraints.push({ boundary: 0, target: transported.finalHomeWinProbability, market: "moneyline" });
      }
    }
    if (args.spread && !axisReasons.margin) {
      const transported = transportNflPricedLineEpisode({ ...shared, episode: args.spread });
      if (transported.status === "unidentified") axisReasons.margin = `spread:${transported.reason}`;
      else {
        sources.spread = args.spread.source;
        marginChanged ||= transported.status === "transported";
        // A genuinely unchanged axis must retain its existing law, including fractional support.
        const moved = transported.status === "unchanged" ? base : buildNflUnifiedMarketAdjustedForecast({
          baseForecast: base, expectedHomeMargin: transported.finalMean,
          expectedTotal: base.expectedHomeScore + base.expectedAwayScore,
          marketInputPolicy: "target_excluded_continuous_residual", preserveUnchangedAxes: true,
        });
        const target = nflV1WeekOneLineProbabilities({ forecast: moved, homeSpread: -args.spread.currentNumber,
          totalLine: base.expectedHomeScore + base.expectedAwayScore }).spread.homeCoverProbability;
        marginConstraints.push({ boundary: args.spread.currentNumber, target, market: "spread" });
      }
    }
  }
  if (axisReasons.margin) { marginConstraints = []; delete sources.moneyline; delete sources.spread; }
  else if (!marginChanged) { marginConstraints = []; axisReasons.margin = "no_economic_axis_change"; }
  if (args.total) {
    if (args.total.market !== "total") axisReasons.total = "market_contract_mismatch";
    else {
      const transported = transportNflPricedLineEpisode({ ...shared, episode: args.total });
      if (transported.status === "unidentified") axisReasons.total = `total:${transported.reason}`;
      else {
        sources.total = args.total.source;
        totalChanged = transported.status === "transported";
        if (totalChanged) {
          const moved = buildNflUnifiedMarketAdjustedForecast({
            baseForecast: base, expectedHomeMargin: base.expectedHomeScore - base.expectedAwayScore,
            expectedTotal: transported.finalMean, marketInputPolicy: "target_excluded_continuous_residual",
            preserveUnchangedAxes: true,
          });
          const target = nflV1WeekOneLineProbabilities({ forecast: moved, homeSpread: 0,
            totalLine: args.total.currentNumber }).total.overProbability;
          totalConstraints.push({ boundary: args.total.currentNumber, target, market: "total" });
        } else axisReasons.total = "no_economic_axis_change";
      }
    }
  }
  let marginProbabilities = tiltToConstraints(base.marginDistribution.values,
    base.marginDistribution.probabilities, marginConstraints);
  let totalProbabilities = tiltToConstraints(base.totalDistribution.values,
    base.totalDistribution.probabilities, totalConstraints);
  if (!marginProbabilities) {
    axisReasons.margin = "joint_score_constraints_unidentifiable";
    marginConstraints = []; delete sources.moneyline; delete sources.spread;
    marginProbabilities = base.marginDistribution.probabilities;
  }
  if (!totalProbabilities) {
    axisReasons.total = "joint_score_constraints_unidentifiable";
    totalConstraints = []; delete sources.total;
    totalProbabilities = base.totalDistribution.probabilities;
  }
  if (!marginConstraints.length && !totalConstraints.length) {
    const error = [axisReasons.margin, axisReasons.total].find((reason) => reason && reason !== "no_economic_axis_change");
    return neutral(error ? "unidentified" : "neutral", error ??
      (args.moneyline || args.spread || args.total ? "episodes_have_no_net_game_law_change" : "no_selected_episode"));
  }
  let outcome: NflV1WeekOneOutcomeForecast;
  try {
    outcome = buildNflReconciledEvidenceDistributionForecast({ baseForecast: base, marginProbabilities, totalProbabilities });
  } catch {
    return neutral("unidentified", "joint_score_law_outside_physical_domain");
  }
  const constraints = [...marginConstraints.map((constraint) => ({
    market: constraint.market, targetProbability: constraint.target,
    achievedProbability: conditionalProbability(outcome.marginDistribution.values,
      outcome.marginDistribution.probabilities, constraint.boundary),
  })), ...totalConstraints.map((constraint) => ({
    market: constraint.market, targetProbability: constraint.target,
    achievedProbability: conditionalProbability(outcome.totalDistribution.values,
      outcome.totalDistribution.probabilities, constraint.boundary),
  }))];
  const changed = outcome.marginDistribution.probabilities.some((value, index) =>
    value !== base.marginDistribution.probabilities[index]) ||
    outcome.totalDistribution.probabilities.some((value, index) => value !== base.totalDistribution.probabilities[index]);
  return {
    release: NFL_JOINT_MARKET_EPISODE_READ_CANDIDATE_RELEASE,
    status: changed ? "applied" : "neutral",
    reason: changed ? "one_reconciled_discrete_game_law" : "episodes_have_no_net_game_law_change",
    outcome, selectedSources: sources, constraints, axisReasons, ...overlap,
  };
}

function tiltToConstraints(values: number[], prior: number[], constraints: Constraint[]): number[] | null {
  let probabilities = [...prior];
  if (constraints.length === 0) return probabilities;
  const logit = (value: number) => Math.log(value / (1 - value));
  for (let pass = 0; pass < 1000; pass++) {
    for (const constraint of constraints) {
      const current = conditionalProbability(values, probabilities, constraint.boundary);
      if (!(current > 0 && current < 1 && constraint.target > 0 && constraint.target < 1)) return null;
      const delta = (logit(constraint.target) - logit(current)) / 2;
      const updated = probabilities.map((value, index) => {
        const sign = Math.sign(values[index]! - constraint.boundary);
        return value * Math.exp(delta * sign);
      });
      const total = updated.reduce((sum, value) => sum + value, 0);
      if (!(total > 0) || !Number.isFinite(total)) return null;
      probabilities = updated.map((value) => value / total);
    }
    const maximumError = Math.max(...constraints.map((constraint) => Math.abs(
      conditionalProbability(values, probabilities, constraint.boundary) - constraint.target,
    )));
    if (maximumError < 1e-8) return probabilities;
  }
  return null;
}

function conditionalProbability(values: number[], probabilities: number[], boundary: number): number {
  let positive = 0;
  let negative = 0;
  values.forEach((value, index) => {
    if (value > boundary) positive += probabilities[index] ?? 0;
    else if (value < boundary) negative += probabilities[index] ?? 0;
  });
  return positive / Math.max(positive + negative, 1e-15);
}
