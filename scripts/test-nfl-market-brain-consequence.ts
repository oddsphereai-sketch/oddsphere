import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deriveNflMarketBrainDecisionConsequence,
  type NflMarketBrainFrozenQuote,
} from "../lib/services/marketBrain/nflMarketBrainConsequence";
import {
  evaluateNflMarketBrainDecisionConsequence,
  summarizeNflMarketBrainConsequenceEvaluations,
} from "../lib/services/marketBrain/nflMarketBrainConsequenceEvaluator";
import type { NflMarketBrainJointPosterior } from
  "../lib/services/marketBrain/nflMarketBrainResolverContract";

const eventId = "nfl-consequence-fixture";
const resolverOutputChecksum = "a".repeat(64);
const observedAt = "2026-10-20T16:00:00.000Z";

function moneylineQuote(
  identity: string,
  selection: "away" | "home",
  price = -110,
): NflMarketBrainFrozenQuote {
  return {
    identity,
    family: "fixture-book",
    market: "moneyline",
    selection,
    line: null,
    price,
    observedAt,
    settlementTerms: "standard_full_game_including_overtime",
  };
}

function distribution(homeProbability: number) {
  const awayProbability = 1 - homeProbability;
  return {
    awayWinProbability: awayProbability,
    homeWinProbability: homeProbability,
    tieProbability: 0,
    marginDistribution: { values: [-1, 1], probabilities: [awayProbability, homeProbability] },
    totalDistribution: { values: [44], probabilities: [1] },
  };
}

function posterior(homeProbability: number): NflMarketBrainJointPosterior {
  const base = distribution(homeProbability);
  return {
    schema: "nfl_market_brain_joint_score_posterior_v1",
    states: [
      { margin: -1, total: 44, probability: 1 - homeProbability },
      { margin: 1, total: 44, probability: homeProbability },
    ],
    ...base,
    marginMean: 2 * homeProbability - 1,
    totalMean: 44,
    awayScoreMean: 22 - (2 * homeProbability - 1) / 2,
    homeScoreMean: 22 + (2 * homeProbability - 1) / 2,
    sha256: "b".repeat(64),
  };
}

function decide(args: {
  priorHome: number;
  posteriorHome: number;
  direction: "first_side" | "second_side" | "static" | "conflicted" | "unavailable";
  menu?: NflMarketBrainFrozenQuote[];
  incumbent?: { decision: "action"; grade: string; quoteIdentity: string; decisionRelease: string | null } |
    { decision: "pass"; grade: string; quoteIdentity: null; decisionRelease: string | null };
  availability?: "complete" | "degraded" | "unavailable";
}) {
  return deriveNflMarketBrainDecisionConsequence({
    eventId,
    resolverOutputChecksum,
    market: "moneyline",
    quoteMenu: args.menu ?? [moneylineQuote("away", "away"), moneylineQuote("home", "home")],
    incumbentDecision: args.incumbent ?? {
      decision: "action", grade: "Lean", quoteIdentity: "home", decisionRelease: "fixture-decision-r1",
    },
    prior: distribution(args.priorHome),
    posterior: posterior(args.posteriorHome),
    marketDirection: args.direction,
    sourceAvailabilityRegime: args.availability ?? "complete",
  });
}

const confirm = decide({ priorHome: 0.56, posteriorHome: 0.60, direction: "second_side" });
assert.equal(confirm.action, "confirm");
assert.equal(confirm.consequence, "retained_action");
assert.equal(confirm.selectedQuote?.selection, "home");

const recenter = decide({ priorHome: 0.50, posteriorHome: 0.60, direction: "second_side" });
assert.equal(recenter.action, "recenter");
assert.ok(recenter.economics.selectedPriorExpectedUnits! < 0);
assert.ok(recenter.economics.selectedPosteriorExpectedUnits! > 0);

const flip = decide({ priorHome: 0.60, posteriorHome: 0.40, direction: "first_side" });
assert.equal(flip.action, "flip");
assert.equal(flip.consequence, "flipped_action");
assert.equal(flip.selectedQuote?.selection, "away");

const fade = decide({ priorHome: 0.60, posteriorHome: 0.60, direction: "first_side" });
assert.equal(fade.action, "fade_market");
assert.equal(fade.selectedQuote?.selection, "home");

const retain = decide({ priorHome: 0.60, posteriorHome: 0.58, direction: "static" });
assert.equal(retain.action, "retain");
assert.equal(retain.consequence, "retained_action");

const standDown = decide({ priorHome: 0.50, posteriorHome: 0.50, direction: "static" });
assert.equal(standDown.action, "stand_down");
assert.equal(standDown.consequence, "demoted_to_pass");
assert.equal(standDown.selectedQuote, null);

const promoted = decide({
  priorHome: 0.50,
  posteriorHome: 0.60,
  direction: "second_side",
  incumbent: { decision: "pass", grade: "Watchlist", quoteIdentity: null, decisionRelease: "fixture-decision-r1" },
});
assert.equal(promoted.action, "recenter");
assert.equal(promoted.consequence, "promoted_from_pass");

const noInventedFlip = decide({
  priorHome: 0.60,
  posteriorHome: 0.40,
  direction: "first_side",
  menu: [moneylineQuote("home", "home")],
});
assert.equal(noInventedFlip.action, "stand_down");
assert.equal(noInventedFlip.selectedQuote, null);
assert.ok(noInventedFlip.interpretation.reasons.includes("opposing_quote_unavailable_no_flip_permitted"));

const cheapAway = decide({
  priorHome: 0.60,
  posteriorHome: 0.48,
  direction: "first_side",
  menu: [moneylineQuote("home", "home"), moneylineQuote("away", "away", -110)],
});
const plusMoneyAway = decide({
  priorHome: 0.60,
  posteriorHome: 0.48,
  direction: "first_side",
  menu: [moneylineQuote("home", "home"), moneylineQuote("away", "away", 110)],
});
assert.equal(cheapAway.action, "stand_down");
assert.equal(plusMoneyAway.action, "flip");
assert.deepEqual(cheapAway.finalPrediction, plusMoneyAway.finalPrediction,
  "quote economics may change the consequence but must never change the score posterior");

const permuted = decide({
  priorHome: 0.56,
  posteriorHome: 0.60,
  direction: "second_side",
  menu: [moneylineQuote("home", "home"), moneylineQuote("away", "away")],
});
assert.equal(permuted.checksum, confirm.checksum,
  "quote-menu order must not change the exact consequence");
assert.throws(() => (confirm.quoteMenu as NflMarketBrainFrozenQuote[]).reverse(), /read only|extensible|frozen/i,
  "the frozen decision record must not permit its exact quote menu to mutate after inference");

const unavailable = decide({
  priorHome: 0.56,
  posteriorHome: 0.60,
  direction: "second_side",
  availability: "unavailable",
});
assert.equal(unavailable.action, "stand_down");
assert.equal(unavailable.selectedQuote, null);

const spread = deriveNflMarketBrainDecisionConsequence({
  eventId,
  resolverOutputChecksum,
  market: "spread",
  quoteMenu: [
    { ...moneylineQuote("away-plus-3", "away"), market: "spread", line: 3 },
    { ...moneylineQuote("home-minus-3", "home"), market: "spread", line: -3 },
  ],
  incumbentDecision: { decision: "action", grade: "Lean", quoteIdentity: "home-minus-3",
    decisionRelease: "fixture-decision-r1" },
  prior: {
    ...distribution(0.60),
    marginDistribution: { values: [-4, 0, 4], probabilities: [0.25, 0.10, 0.65] },
  },
  posterior: {
    ...posterior(0.70),
    marginDistribution: { values: [-4, 0, 4], probabilities: [0.20, 0.10, 0.70] },
  },
  marketDirection: "second_side",
  sourceAvailabilityRegime: "complete",
});
assert.equal(spread.selectedQuote?.identity, "home-minus-3");
assert.ok(spread.economics.selectedWinProbability! > 0.5);

const total = deriveNflMarketBrainDecisionConsequence({
  eventId,
  resolverOutputChecksum,
  market: "total",
  quoteMenu: [
    { ...moneylineQuote("over-44.5", "away"), market: "total", selection: "over", line: 44.5 },
    { ...moneylineQuote("under-44.5", "home"), market: "total", selection: "under", line: 44.5 },
  ],
  incumbentDecision: { decision: "action", grade: "Lean", quoteIdentity: "over-44.5",
    decisionRelease: "fixture-decision-r1" },
  prior: { ...distribution(0.50), totalDistribution: { values: [40, 45, 50], probabilities: [0.30, 0.30, 0.40] } },
  posterior: { ...posterior(0.50), totalDistribution: { values: [40, 45, 50], probabilities: [0.20, 0.30, 0.50] } },
  marketDirection: "first_side",
  sourceAvailabilityRegime: "complete",
});
assert.equal(total.selectedQuote?.identity, "over-44.5");

assert.throws(() => decide({
  priorHome: 0.60,
  posteriorHome: 0.60,
  direction: "static",
  menu: [moneylineQuote("away", "away")],
}), /incumbent action is absent/);

const correctedLoss = evaluateNflMarketBrainDecisionConsequence({
  consequence: flip,
  awayScore: 24,
  homeScore: 20,
});
assert.equal(correctedLoss.classification, "corrected_loss");
assert.equal(correctedLoss.incumbent.result, "loss");
assert.equal(correctedLoss.candidate.result, "win");
assert.ok(correctedLoss.unitDelta > 1);

const newHarm = evaluateNflMarketBrainDecisionConsequence({
  consequence: flip,
  awayScore: 20,
  homeScore: 24,
});
assert.equal(newHarm.classification, "new_harm");
assert.equal(newHarm.incumbent.result, "win");
assert.equal(newHarm.candidate.result, "loss");

const avoidedLoss = evaluateNflMarketBrainDecisionConsequence({
  consequence: standDown,
  awayScore: 24,
  homeScore: 20,
});
assert.equal(avoidedLoss.classification, "demotion_avoided_loss");
assert.equal(avoidedLoss.actionCountDelta, -1);

const promotionWin = evaluateNflMarketBrainDecisionConsequence({
  consequence: promoted,
  awayScore: 20,
  homeScore: 24,
});
assert.equal(promotionWin.classification, "promotion_win");
assert.equal(promotionWin.actionCountDelta, 1);

const summary = summarizeNflMarketBrainConsequenceEvaluations([
  correctedLoss,
  newHarm,
  avoidedLoss,
  promotionWin,
]);
assert.equal(summary.correctedLosses, 1);
assert.equal(summary.newHarms, 1);
assert.equal(summary.promotions, 1);
assert.equal(summary.demotions, 1);
assert.equal(summary.netActionCount, 0,
  "the proof report must expose promotions and demotions rather than hiding a flatter board");
assert.throws(() => evaluateNflMarketBrainDecisionConsequence({
  consequence: structuredClone(flip),
  awayScore: 24,
  homeScore: 20,
}), /verified decision consequence/,
"caller-authored or copied decisions cannot enter exact-quote result evaluation");

const source = readFileSync("lib/services/marketBrain/nflMarketBrainConsequence.ts", "utf8");
assert.doesNotMatch(source, /minimumSignals|signalCount\s*[><=]|threeOfFour|pointsTable|sportsbookWeights?\s*:/i,
  "the consequence layer must not regress to signal quotas, points, or fixed sportsbook weights");

console.log("NFL Market Brain exact-quote consequence: all six actions, no invented flip, quote-order invariance, corrected-loss/new-harm scoring, and shadow-only authority passed");
