import { marketBrainSha256 } from "./marketBrainCanonical";
import {
  assertNflMarketBrainDecisionConsequence,
  type NflMarketBrainDecisionConsequence,
  type NflMarketBrainFrozenQuote,
} from "./nflMarketBrainConsequence";

export const NFL_MARKET_BRAIN_CONSEQUENCE_EVALUATOR_RELEASE =
  "nfl_market_brain_consequence_evaluator_2026_10_27_r1_pairwise_exact_quote" as const;

export type NflMarketBrainSettledResult = "win" | "loss" | "push" | "pass";
export type NflMarketBrainPairwiseClassification =
  | "corrected_loss"
  | "new_harm"
  | "changed_both_win"
  | "changed_both_loss"
  | "changed_win_to_push"
  | "changed_loss_to_push"
  | "changed_push_to_win"
  | "changed_push_to_loss"
  | "retained_win"
  | "retained_loss"
  | "retained_push"
  | "promotion_win"
  | "promotion_loss"
  | "promotion_push"
  | "demotion_avoided_loss"
  | "demotion_missed_win"
  | "demotion_push"
  | "retained_pass";

export type NflMarketBrainConsequenceEvaluation = {
  schema: "nfl_market_brain_consequence_evaluation_v1";
  release: typeof NFL_MARKET_BRAIN_CONSEQUENCE_EVALUATOR_RELEASE;
  eventId: string;
  market: NflMarketBrainDecisionConsequence["market"];
  consequenceChecksum: string;
  action: NflMarketBrainDecisionConsequence["action"];
  actual: { awayScore: number; homeScore: number; margin: number; total: number };
  incumbent: {
    quoteIdentity: string | null;
    result: NflMarketBrainSettledResult;
    units: number;
  };
  candidate: {
    quoteIdentity: string | null;
    result: NflMarketBrainSettledResult;
    units: number;
  };
  classification: NflMarketBrainPairwiseClassification;
  unitDelta: number;
  actionCountDelta: -1 | 0 | 1;
  invariants: {
    exactFrozenQuotesSettled: true;
    lockedRecordMutationAllowed: false;
    productionInfluenceAllowed: false;
  };
  checksum: string;
};

export function evaluateNflMarketBrainDecisionConsequence(args: {
  consequence: NflMarketBrainDecisionConsequence;
  awayScore: number;
  homeScore: number;
}): NflMarketBrainConsequenceEvaluation {
  assertNflMarketBrainDecisionConsequence(args.consequence);
  if (![args.awayScore, args.homeScore].every((score) => Number.isInteger(score) && score >= 0)) {
    throw new Error("NFL Market Brain consequence evaluation requires non-negative integer final scores.");
  }
  const incumbent = settleQuote(args.consequence.incumbentQuote, args.awayScore, args.homeScore);
  const candidate = settleQuote(args.consequence.selectedQuote, args.awayScore, args.homeScore);
  const classification = classifyPair(incumbent.result, candidate.result,
    args.consequence.incumbentQuote?.identity === args.consequence.selectedQuote?.identity);
  const incumbentActionCount = Number(args.consequence.incumbentQuote !== null);
  const candidateActionCount = Number(args.consequence.selectedQuote !== null);
  const withoutChecksum = {
    schema: "nfl_market_brain_consequence_evaluation_v1" as const,
    release: NFL_MARKET_BRAIN_CONSEQUENCE_EVALUATOR_RELEASE,
    eventId: args.consequence.eventId,
    market: args.consequence.market,
    consequenceChecksum: args.consequence.checksum,
    action: args.consequence.action,
    actual: {
      awayScore: args.awayScore,
      homeScore: args.homeScore,
      margin: args.homeScore - args.awayScore,
      total: args.homeScore + args.awayScore,
    },
    incumbent: {
      quoteIdentity: args.consequence.incumbentQuote?.identity ?? null,
      result: incumbent.result,
      units: incumbent.units,
    },
    candidate: {
      quoteIdentity: args.consequence.selectedQuote?.identity ?? null,
      result: candidate.result,
      units: candidate.units,
    },
    classification,
    unitDelta: candidate.units - incumbent.units,
    actionCountDelta: (candidateActionCount - incumbentActionCount) as -1 | 0 | 1,
    invariants: {
      exactFrozenQuotesSettled: true as const,
      lockedRecordMutationAllowed: false as const,
      productionInfluenceAllowed: false as const,
    },
  };
  return Object.freeze({ ...withoutChecksum, checksum: marketBrainSha256(withoutChecksum) });
}

export function summarizeNflMarketBrainConsequenceEvaluations(
  evaluations: NflMarketBrainConsequenceEvaluation[],
) {
  const byClassification = Object.fromEntries(
    [...new Set(evaluations.map((evaluation) => evaluation.classification))]
      .sort(compareAscii)
      .map((classification) => [classification,
        evaluations.filter((evaluation) => evaluation.classification === classification).length]),
  ) as Partial<Record<NflMarketBrainPairwiseClassification, number>>;
  const incumbentActions = evaluations.filter((evaluation) => evaluation.incumbent.result !== "pass").length;
  const candidateActions = evaluations.filter((evaluation) => evaluation.candidate.result !== "pass").length;
  const incumbentUnits = sum(evaluations.map((evaluation) => evaluation.incumbent.units));
  const candidateUnits = sum(evaluations.map((evaluation) => evaluation.candidate.units));
  return {
    release: NFL_MARKET_BRAIN_CONSEQUENCE_EVALUATOR_RELEASE,
    cases: evaluations.length,
    incumbentActions,
    candidateActions,
    netActionCount: candidateActions - incumbentActions,
    incumbentUnits,
    candidateUnits,
    unitDelta: candidateUnits - incumbentUnits,
    correctedLosses: byClassification.corrected_loss ?? 0,
    newHarms: byClassification.new_harm ?? 0,
    promotions: evaluations.filter((evaluation) => evaluation.actionCountDelta === 1).length,
    demotions: evaluations.filter((evaluation) => evaluation.actionCountDelta === -1).length,
    abstentions: evaluations.filter((evaluation) => evaluation.candidate.result === "pass").length,
    byClassification,
  };
}

function settleQuote(
  quote: NflMarketBrainFrozenQuote | null,
  awayScore: number,
  homeScore: number,
): { result: NflMarketBrainSettledResult; units: number } {
  if (!quote) return { result: "pass", units: 0 };
  const margin = homeScore - awayScore;
  const total = homeScore + awayScore;
  let edge: number;
  if (quote.market === "moneyline") {
    edge = quote.selection === "home" ? margin : -margin;
  } else if (quote.market === "spread") {
    edge = (quote.selection === "home" ? margin : -margin) + quote.line!;
  } else {
    edge = quote.selection === "over" ? total - quote.line! : quote.line! - total;
  }
  const result = edge > 0 ? "win" : edge < 0 ? "loss" : "push";
  const units = result === "push" ? 0 : result === "loss" ? -1 :
    quote.price > 0 ? quote.price / 100 : 100 / Math.abs(quote.price);
  return { result, units };
}

function classifyPair(
  incumbent: NflMarketBrainSettledResult,
  candidate: NflMarketBrainSettledResult,
  sameQuote: boolean,
): NflMarketBrainPairwiseClassification {
  if (incumbent === "pass") {
    if (candidate === "pass") return "retained_pass";
    return candidate === "win" ? "promotion_win" : candidate === "loss" ? "promotion_loss" : "promotion_push";
  }
  if (candidate === "pass") {
    return incumbent === "loss" ? "demotion_avoided_loss" :
      incumbent === "win" ? "demotion_missed_win" : "demotion_push";
  }
  if (sameQuote) {
    return candidate === "win" ? "retained_win" : candidate === "loss" ? "retained_loss" : "retained_push";
  }
  if (incumbent === "loss" && candidate === "win") return "corrected_loss";
  if (incumbent === "win" && candidate === "loss") return "new_harm";
  if (incumbent === "win" && candidate === "win") return "changed_both_win";
  if (incumbent === "loss" && candidate === "loss") return "changed_both_loss";
  if (incumbent === "win" && candidate === "push") return "changed_win_to_push";
  if (incumbent === "loss" && candidate === "push") return "changed_loss_to_push";
  if (incumbent === "push" && candidate === "win") return "changed_push_to_win";
  return "changed_push_to_loss";
}

function sum(values: number[]) {
  return values.reduce((result, value) => result + value, 0);
}

function compareAscii(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
