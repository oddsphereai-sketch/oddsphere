import { marketBrainSha256 } from "./marketBrainCanonical";

import type { MarketBrainDiscreteDistribution } from "./marketBrainContract";
import type { MarketBrainDecisionEnvelope } from "./marketBrainContract";
import {
  assertNflMarketBrainResolverShadowOutput,
  type NflMarketBrainJointPosterior,
  type NflMarketBrainResolverShadowOutput,
} from "./nflMarketBrainResolverContract";
import type { NflMarketBrainSequence } from "./nflMarketBrainSequenceMaterializer";
import type { MarketBrainAction } from "./nflMarketBrainBehaviorScenarios";
import {
  assertNflMarketBrainAttestedResearchInput,
  type NflMarketBrainAttestedResearchInput,
} from "./nflMarketBrainResearchInput";

export const NFL_MARKET_BRAIN_CONSEQUENCE_RELEASE =
  "nfl_market_brain_consequence_2026_10_27_r2_attested_decision_envelope" as const;

export type NflMarketBrainDecisionMarket = "moneyline" | "spread" | "total";
export type NflMarketBrainDecisionSelection = "away" | "home" | "over" | "under";

export type NflMarketBrainFrozenQuote = {
  identity: string;
  family: string;
  market: NflMarketBrainDecisionMarket;
  selection: NflMarketBrainDecisionSelection;
  line: number | null;
  price: number;
  observedAt: string;
  settlementTerms: "standard_full_game_including_overtime";
};

export type NflMarketBrainIncumbentDecision =
  | { decision: "action"; grade: string; quoteIdentity: string; decisionRelease: string | null }
  | { decision: "pass"; grade: string; quoteIdentity: null; decisionRelease: string | null };

export type NflMarketBrainDecisionConsequence = {
  schema: "nfl_market_brain_decision_consequence_v1";
  release: typeof NFL_MARKET_BRAIN_CONSEQUENCE_RELEASE;
  eventId: string;
  market: NflMarketBrainDecisionMarket;
  resolverOutputChecksum: string;
  decisionEnvelopeChecksum: string;
  action: MarketBrainAction;
  consequence:
    | "retained_action"
    | "flipped_action"
    | "promoted_from_pass"
    | "demoted_to_pass"
    | "retained_pass";
  incumbentDecision: NflMarketBrainIncumbentDecision;
  incumbentQuote: NflMarketBrainFrozenQuote | null;
  selectedQuote: NflMarketBrainFrozenQuote | null;
  quoteChanged: boolean;
  quoteMenu: NflMarketBrainFrozenQuote[];
  economics: {
    incumbentPriorExpectedUnits: number | null;
    incumbentPosteriorExpectedUnits: number | null;
    selectedPriorExpectedUnits: number | null;
    selectedPosteriorExpectedUnits: number | null;
    selectedWinProbability: number | null;
    selectedPushProbability: number | null;
  };
  interpretation: {
    marketDirection: NflMarketBrainSequence["crossMarket"]["marketDirection"][NflMarketBrainDecisionMarket];
    directionSupportsSelectedQuote: boolean | null;
    sourceAvailabilityRegime: NflMarketBrainSequence["sourceAvailability"]["regime"];
    reasons: string[];
  };
  finalPrediction: {
    awayWinProbability: number;
    homeWinProbability: number;
    tieProbability: number;
    marginMean: number;
    totalMean: number;
    awayScoreMean: number;
    homeScoreMean: number;
  };
  mode: "shadow_only";
  invariants: {
    posteriorUnaffectedByQuoteMenu: true;
    exactExecutableQuoteRequired: true;
    signalCountRulesAllowed: false;
    fixedSportsbookWeightsAllowed: false;
    lockedRecordMutationAllowed: false;
    productionInfluenceAllowed: false;
  };
  checksum: string;
};

type DecisionDistribution = Pick<NflMarketBrainJointPosterior,
  "awayWinProbability" | "homeWinProbability" | "tieProbability" |
  "marginDistribution" | "totalDistribution">;

const ECONOMIC_EPSILON = 1e-12;
const attestedConsequences = new WeakSet<object>();

/**
 * Converts the one coherent score posterior into an exact, auditable shadow
 * decision. It does not count signals, assign book weights, or alter the
 * posterior. Quote prices affect only the downstream consequence economics.
 */
export function buildNflMarketBrainDecisionConsequence(args: {
  researchInput: NflMarketBrainAttestedResearchInput;
  resolverOutput: NflMarketBrainResolverShadowOutput;
  market: NflMarketBrainDecisionMarket;
}): NflMarketBrainDecisionConsequence {
  assertNflMarketBrainResolverShadowOutput(args.resolverOutput);
  assertNflMarketBrainAttestedResearchInput(args.researchInput);
  const sequence = args.researchInput.sequence;
  if (sequence.eventId !== args.resolverOutput.eventId ||
    sequence.checksum !== args.resolverOutput.sequenceChecksum ||
    args.researchInput.checksum !== args.resolverOutput.researchInputChecksum ||
    args.researchInput.persistenceAttestation.recordId !== args.resolverOutput.researchInputRecordId) {
    throw new Error("NFL Market Brain consequence requires the resolver's exact source sequence.");
  }
  const envelope = args.researchInput.decisionEnvelopes[args.market];
  if (!envelope) throw new Error(`NFL Market Brain ${args.market} decision envelope is unavailable.`);
  return deriveNflMarketBrainDecisionConsequence({
    eventId: sequence.eventId,
    resolverOutputChecksum: args.resolverOutput.checksum,
    market: args.market,
    quoteMenu: nflQuoteMenu(envelope),
    incumbentDecision: envelope.incumbentDecision,
    prior: priorDistribution(sequence),
    posterior: args.resolverOutput.posterior,
    marketDirection: sequence.crossMarket.marketDirection[args.market],
    sourceAvailabilityRegime: sequence.sourceAvailability.regime,
  });
}

/** Pure decision kernel used by deterministic consequence fixtures. */
export function deriveNflMarketBrainDecisionConsequence(args: {
  eventId: string;
  resolverOutputChecksum: string;
  market: NflMarketBrainDecisionMarket;
  quoteMenu: NflMarketBrainFrozenQuote[];
  incumbentDecision: NflMarketBrainIncumbentDecision;
  prior: DecisionDistribution;
  posterior: NflMarketBrainJointPosterior;
  marketDirection: NflMarketBrainSequence["crossMarket"]["marketDirection"][NflMarketBrainDecisionMarket];
  sourceAvailabilityRegime: NflMarketBrainSequence["sourceAvailability"]["regime"];
}): NflMarketBrainDecisionConsequence {
  if (!args.eventId.trim() || !/^[a-f0-9]{64}$/.test(args.resolverOutputChecksum)) {
    throw new Error("NFL Market Brain consequence identity is invalid.");
  }
  validateDistribution(args.prior.marginDistribution, "prior margin");
  validateDistribution(args.prior.totalDistribution, "prior total");
  validateDistribution(args.posterior.marginDistribution, "posterior margin");
  validateDistribution(args.posterior.totalDistribution, "posterior total");
  const quoteMenu = canonicalQuoteMenu(args.market, args.quoteMenu);
  const decisionEnvelopeChecksum = marketBrainSha256({
    schema: "market_brain_decision_envelope_v1",
    market: args.market,
    incumbentDecision: args.incumbentDecision,
    quoteMenu,
  });
  const incumbentQuote = args.incumbentDecision.decision === "action"
    ? quoteMenu.find((quote) => quote.identity === args.incumbentDecision.quoteIdentity) ?? null
    : null;
  if (args.incumbentDecision.decision === "action" && incumbentQuote === null) {
    throw new Error("NFL Market Brain incumbent action is absent from the frozen quote menu.");
  }

  const posteriorEconomics = quoteMenu.map((quote) => ({
    quote,
    ...quoteEconomics(args.posterior, quote),
  }));
  const bestBySelection = bestQuoteBySelection(posteriorEconomics);
  const rankedSelections = [...bestBySelection.values()].sort((left, right) =>
    right.expectedUnits - left.expectedUnits || compareAscii(left.quote.selection, right.quote.selection));
  const best = rankedSelections[0] ?? null;
  const runnerUp = rankedSelections[1] ?? null;
  const economicallyIndifferent = best !== null && runnerUp !== null &&
    Math.abs(best.expectedUnits - runnerUp.expectedUnits) <= ECONOMIC_EPSILON;
  const sourceUnavailable = args.sourceAvailabilityRegime === "unavailable";
  const selected = !sourceUnavailable && !economicallyIndifferent && best !== null &&
    best.expectedUnits > ECONOMIC_EPSILON ? best : null;

  const selectedPrior = selected ? quoteEconomics(args.prior, selected.quote) : null;
  const incumbentPrior = incumbentQuote ? quoteEconomics(args.prior, incumbentQuote) : null;
  const incumbentPosterior = incumbentQuote ? quoteEconomics(args.posterior, incumbentQuote) : null;
  const directionSupportsSelectedQuote = selected === null ? null :
    directionSupportsSelection(args.marketDirection, selected.quote.selection);
  const reasons: string[] = [];
  let action: MarketBrainAction;
  let consequence: NflMarketBrainDecisionConsequence["consequence"];

  if (sourceUnavailable) {
    action = "stand_down";
    reasons.push("market_state_unavailable");
  } else if (economicallyIndifferent) {
    action = "stand_down";
    reasons.push("posterior_quote_utility_indifferent");
  } else if (selected === null) {
    action = "stand_down";
    reasons.push("no_frozen_quote_has_positive_posterior_utility");
    if (incumbentQuote && !hasOpposingQuote(quoteMenu, incumbentQuote.selection)) {
      reasons.push("opposing_quote_unavailable_no_flip_permitted");
    }
  } else if (incumbentQuote && selected.quote.selection !== incumbentQuote.selection) {
    action = "flip";
    reasons.push("opposing_frozen_quote_has_highest_positive_posterior_utility");
  } else if (args.incumbentDecision.decision === "pass") {
    action = "recenter";
    reasons.push("posterior_promotes_an_exact_quote_from_incumbent_pass");
  } else if (directionSupportsSelectedQuote === false) {
    action = "fade_market";
    reasons.push("posterior_retains_value_against_observed_market_direction");
  } else if (selectedPrior && selectedPrior.expectedUnits <= ECONOMIC_EPSILON) {
    action = "recenter";
    reasons.push("market_interpretation_crosses_exact_quote_break_even_without_flipping_side");
  } else if (selectedPrior && selected.expectedUnits > selectedPrior.expectedUnits + ECONOMIC_EPSILON &&
    directionSupportsSelectedQuote === true) {
    action = "confirm";
    reasons.push("independent_prior_and_interpreted_market_cohere_on_exact_quote");
  } else {
    action = "retain";
    reasons.push("incumbent_side_remains_best_without_confirming_or_reversing_market_evidence");
  }

  if (args.incumbentDecision.decision === "pass") {
    consequence = selected ? "promoted_from_pass" : "retained_pass";
  } else if (!selected) {
    consequence = "demoted_to_pass";
  } else if (selected.quote.selection !== incumbentQuote!.selection) {
    consequence = "flipped_action";
  } else {
    consequence = "retained_action";
  }

  const withoutChecksum = {
    schema: "nfl_market_brain_decision_consequence_v1" as const,
    release: NFL_MARKET_BRAIN_CONSEQUENCE_RELEASE,
    eventId: args.eventId,
    market: args.market,
    resolverOutputChecksum: args.resolverOutputChecksum,
    decisionEnvelopeChecksum,
    action,
    consequence,
    incumbentDecision: structuredClone(args.incumbentDecision),
    incumbentQuote,
    selectedQuote: selected?.quote ?? null,
    quoteChanged: incumbentQuote !== null && selected !== null && incumbentQuote.identity !== selected.quote.identity,
    quoteMenu,
    economics: {
      incumbentPriorExpectedUnits: incumbentPrior?.expectedUnits ?? null,
      incumbentPosteriorExpectedUnits: incumbentPosterior?.expectedUnits ?? null,
      selectedPriorExpectedUnits: selectedPrior?.expectedUnits ?? null,
      selectedPosteriorExpectedUnits: selected?.expectedUnits ?? null,
      selectedWinProbability: selected?.winProbability ?? null,
      selectedPushProbability: selected?.pushProbability ?? null,
    },
    interpretation: {
      marketDirection: args.marketDirection,
      directionSupportsSelectedQuote,
      sourceAvailabilityRegime: args.sourceAvailabilityRegime,
      reasons,
    },
    finalPrediction: {
      awayWinProbability: args.posterior.awayWinProbability,
      homeWinProbability: args.posterior.homeWinProbability,
      tieProbability: args.posterior.tieProbability,
      marginMean: args.posterior.marginMean,
      totalMean: args.posterior.totalMean,
      awayScoreMean: args.posterior.awayScoreMean,
      homeScoreMean: args.posterior.homeScoreMean,
    },
    mode: "shadow_only" as const,
    invariants: {
      posteriorUnaffectedByQuoteMenu: true as const,
      exactExecutableQuoteRequired: true as const,
      signalCountRulesAllowed: false as const,
      fixedSportsbookWeightsAllowed: false as const,
      lockedRecordMutationAllowed: false as const,
      productionInfluenceAllowed: false as const,
    },
  };
  const output = deepFreeze({ ...withoutChecksum, checksum: marketBrainSha256(withoutChecksum) });
  attestedConsequences.add(output);
  return output;
}

function nflQuoteMenu(envelope: MarketBrainDecisionEnvelope): NflMarketBrainFrozenQuote[] {
  return envelope.quoteMenu.map((quote) => {
    if (quote.selection !== "away" && quote.selection !== "home" &&
      quote.selection !== "over" && quote.selection !== "under") {
      throw new Error(`NFL Market Brain ${envelope.market} quote menu contains a non-NFL selection.`);
    }
    if (quote.settlementTerms !== "standard_full_game_including_overtime") {
      throw new Error(`NFL Market Brain ${envelope.market} quote menu has incompatible settlement terms.`);
    }
    const selection: NflMarketBrainDecisionSelection = quote.selection;
    return { ...structuredClone(quote), selection,
      settlementTerms: "standard_full_game_including_overtime" as const,
      market: envelope.market as NflMarketBrainDecisionMarket };
  });
}

export function assertNflMarketBrainDecisionConsequence(
  consequence: NflMarketBrainDecisionConsequence,
): void {
  const { checksum, ...payload } = consequence;
  if (!attestedConsequences.has(consequence) ||
    consequence.schema !== "nfl_market_brain_decision_consequence_v1" ||
    consequence.release !== NFL_MARKET_BRAIN_CONSEQUENCE_RELEASE ||
    consequence.mode !== "shadow_only" || consequence.invariants.productionInfluenceAllowed !== false ||
    checksum !== marketBrainSha256(payload)) {
    throw new Error("NFL Market Brain evaluation requires this process's verified decision consequence.");
  }
}

function priorDistribution(sequence: NflMarketBrainSequence): DecisionDistribution {
  if (sequence.prior.kind !== "margin_total_distribution") {
    throw new Error("NFL Market Brain consequence requires the exact independent prior distribution.");
  }
  const marginDistribution = sequence.prior.artifact.marginDistribution;
  const awayWinProbability = probabilityWhere(marginDistribution, (margin) => margin < 0);
  const homeWinProbability = probabilityWhere(marginDistribution, (margin) => margin > 0);
  const tieProbability = probabilityWhere(marginDistribution, (margin) => margin === 0);
  return {
    awayWinProbability,
    homeWinProbability,
    tieProbability,
    marginDistribution,
    totalDistribution: sequence.prior.artifact.totalDistribution,
  };
}

function canonicalQuoteMenu(
  market: NflMarketBrainDecisionMarket,
  quotes: NflMarketBrainFrozenQuote[],
): NflMarketBrainFrozenQuote[] {
  const identities = new Set<string>();
  const selections = allowedSelections(market);
  const result = quotes.map((quote) => {
    if (!quote.identity.trim() || !quote.family.trim() || quote.market !== market ||
      !selections.includes(quote.selection) || !validAmericanPrice(quote.price) ||
      !Number.isFinite(Date.parse(quote.observedAt)) ||
      quote.settlementTerms !== "standard_full_game_including_overtime" ||
      (market === "moneyline" ? quote.line !== null : !Number.isFinite(quote.line))) {
      throw new Error("NFL Market Brain frozen quote is invalid.");
    }
    if (identities.has(quote.identity)) throw new Error("NFL Market Brain frozen quote identity is duplicated.");
    identities.add(quote.identity);
    return structuredClone(quote);
  });
  return result.sort((left, right) => compareAscii(left.identity, right.identity));
}

function bestQuoteBySelection(
  rows: Array<ReturnType<typeof quoteEconomics> & { quote: NflMarketBrainFrozenQuote }>,
) {
  const result = new Map<NflMarketBrainDecisionSelection, typeof rows[number]>();
  for (const row of rows) {
    const current = result.get(row.quote.selection);
    if (!current || row.expectedUnits > current.expectedUnits + ECONOMIC_EPSILON ||
      Math.abs(row.expectedUnits - current.expectedUnits) <= ECONOMIC_EPSILON &&
        compareAscii(row.quote.identity, current.quote.identity) < 0) {
      result.set(row.quote.selection, row);
    }
  }
  return result;
}

function quoteEconomics(distribution: DecisionDistribution, quote: NflMarketBrainFrozenQuote) {
  let winProbability = 0;
  let pushProbability = 0;
  if (quote.market === "moneyline") {
    winProbability = quote.selection === "home"
      ? distribution.homeWinProbability : distribution.awayWinProbability;
    pushProbability = distribution.tieProbability;
  } else if (quote.market === "spread") {
    const sign = quote.selection === "home" ? 1 : -1;
    distribution.marginDistribution.values.forEach((margin, index) => {
      const edge = sign * margin + quote.line!;
      if (edge > 0) winProbability += distribution.marginDistribution.probabilities[index]!;
      else if (edge === 0) pushProbability += distribution.marginDistribution.probabilities[index]!;
    });
  } else {
    distribution.totalDistribution.values.forEach((total, index) => {
      const edge = quote.selection === "over" ? total - quote.line! : quote.line! - total;
      if (edge > 0) winProbability += distribution.totalDistribution.probabilities[index]!;
      else if (edge === 0) pushProbability += distribution.totalDistribution.probabilities[index]!;
    });
  }
  const lossProbability = Math.max(0, 1 - winProbability - pushProbability);
  const winUnits = quote.price > 0 ? quote.price / 100 : 100 / Math.abs(quote.price);
  return { winProbability, pushProbability, expectedUnits: winProbability * winUnits - lossProbability };
}

function directionSupportsSelection(
  direction: NflMarketBrainSequence["crossMarket"]["marketDirection"][NflMarketBrainDecisionMarket],
  selection: NflMarketBrainDecisionSelection,
): boolean | null {
  if (direction === "static" || direction === "conflicted" || direction === "unavailable") return null;
  const firstSelection = selection === "away" || selection === "over";
  return direction === (firstSelection ? "first_side" : "second_side");
}

function hasOpposingQuote(menu: NflMarketBrainFrozenQuote[], selection: NflMarketBrainDecisionSelection) {
  return menu.some((quote) => quote.selection !== selection);
}

function allowedSelections(market: NflMarketBrainDecisionMarket): NflMarketBrainDecisionSelection[] {
  return market === "total" ? ["over", "under"] : ["away", "home"];
}

function validAmericanPrice(price: number) {
  return Number.isFinite(price) && price !== 0 && (price <= -100 || price >= 100);
}

function validateDistribution(distribution: MarketBrainDiscreteDistribution, label: string) {
  if (distribution.values.length === 0 || distribution.values.length !== distribution.probabilities.length ||
    distribution.values.some((value) => !Number.isFinite(value)) ||
    distribution.probabilities.some((probability) => !Number.isFinite(probability) || probability < 0) ||
    Math.abs(distribution.probabilities.reduce((sum, probability) => sum + probability, 0) - 1) > 1e-9) {
    throw new Error(`NFL Market Brain ${label} distribution is invalid.`);
  }
}

function probabilityWhere(distribution: MarketBrainDiscreteDistribution, predicate: (value: number) => boolean) {
  return distribution.values.reduce((sum, value, index) =>
    sum + (predicate(value) ? distribution.probabilities[index]! : 0), 0);
}

function compareAscii(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
