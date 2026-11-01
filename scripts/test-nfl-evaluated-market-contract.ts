import assert from "node:assert/strict";

import { deriveNflEvaluatedMarketContract, stabilizeNflFullGameEvidenceTargets,
  type applyNflFullGameEvidenceRuntime } from "@/lib/services/football/nflFullGameEvidenceRuntime";
import type { NflV1ActionableGradeBundle } from "@/lib/services/football/nflV1ActionableGradeCandidate";
import { buildNflMarketState } from "@/lib/services/football/nflMarketState";

const quote = (line: number) => ({
  sportsbook: "betrivers", line, price: -108, observedAt: "2026-11-01T11:39:00.000Z",
});
const baselineProduction = { evaluatedBets: [
  { market: "spread" as const, side: "MIN", evaluatedQuote: quote(3) },
  { market: "total" as const, side: "Under 46", evaluatedQuote: quote(46) },
] };
const contract = deriveNflEvaluatedMarketContract({ baselineProduction, homeTeam: "DET" });
assert.deepEqual(contract, { spread: { homeLine: -3 }, total: { line: 46 } },
  "the selected away spread must orient to home margin, and each market owns its selected line");
assert.deepEqual(deriveNflEvaluatedMarketContract({
  homeTeam: "DET", baselineProduction: { evaluatedBets: [
    { market: "spread", side: "DET", evaluatedQuote: quote(-3) },
  ] },
}), { spread: { homeLine: -3 }, total: null });
assert.deepEqual(deriveNflEvaluatedMarketContract({
  homeTeam: "DET", baselineProduction: { evaluatedBets: [] },
}), { spread: null, total: null }, "missing selected markets may not borrow representative lines");

const split = {
  provider: "playbook" as const, capturedAt: "2026-11-01T10:51:00.000Z", booksUsed: 11,
  awayMoneyPct: null, homeMoneyPct: null, awayBetsPct: null, homeBetsPct: null,
  overMoneyPct: 52, underMoneyPct: 48, overBetsPct: 41, underBetsPct: 59,
};
const args = {
  market: "total" as const, evaluatedAt: "2026-11-01T11:47:00.000Z", snapshots: [],
  playbookLine: {
    provider: "playbook" as const, capturedAt: split.capturedAt,
    total: 46.5, homeSpread: -3.5, awaySpread: 3.5,
    homeMoneyline: -174, awayMoneyline: 146, sourceTier: null,
  },
  playbookSplits: { moneyline: split, spread: split, total: split }, sharpSplits: null,
};
assert.equal(buildNflMarketState({ ...args, current: {
  spread: { homeLine: -3.5 }, total: { line: 46.5 },
} }).splits.length, 1, "fixture reproduces qualification against the wrong representative contract");
assert.equal(buildNflMarketState({ ...args, current: contract }).splits.length, 0,
  "Playbook 46.5 flow must not direct an evaluated Under 46 contract");
assert.equal(buildNflMarketState({ ...args, current: contract,
  playbookLine: { ...args.playbookLine, total: 46 },
}).splits.length, 1, "fresh flow at the actual selected line remains eligible");

console.log("NFL evaluated market contract: passed");

type RuntimeResult = ReturnType<typeof applyNflFullGameEvidenceRuntime>;
const targets = (book: string, line: number) => ({ evaluatedBets: [
  { market: "moneyline", side: "DET", evaluatedQuote: { ...quote(0), sportsbook: book, line: null } },
  { market: "spread", side: "MIN", evaluatedQuote: { ...quote(3), sportsbook: book } },
  { market: "total", side: `Under ${line}`, evaluatedQuote: { ...quote(line), sportsbook: book } },
] }) as unknown as NflV1ActionableGradeBundle;
const upstream = { expectedAwayScore: 21, expectedHomeScore: 24 } as RuntimeResult["outcome"];
const resultFor = (production: NflV1ActionableGradeBundle) => ({
  production, outcome: { ...upstream, expectedHomeScore: 26 },
  arbitration: { status: "applied", finalHomeMargin: 5, finalTotal: 47 },
}) as unknown as RuntimeResult;
const start = targets("draftkings", 46);
const selected = targets("betrivers", 46.5);
const evaluated: string[] = [];
const stable = stabilizeNflFullGameEvidenceTargets({
  baselineProduction: start, releasedForecast: upstream, homeTeam: "DET",
  build: (target) => {
    evaluated.push(target.evaluatedBets[0].evaluatedQuote.sportsbook);
    return resultFor(selected);
  },
});
assert.deepEqual(evaluated, ["draftkings", "betrivers"],
  "a changed final sportsbook/line must rebuild its own target-excluded evidence");
assert.equal(stable.targetResolution.status, "stable");
assert.equal(stable.targetResolution.iterations, 2);
assert.equal(stable.outcome.expectedHomeScore, 26, "iterations may not compound changed scores");
const lineOnly = stabilizeNflFullGameEvidenceTargets({
  baselineProduction: start, releasedForecast: upstream, homeTeam: "DET",
  build: () => resultFor(targets("draftkings", 46.5)),
});
assert.equal(lineOnly.targetResolution.iterations, 2,
  "same-book changes of evaluated line also require a new interpretation");
const cyclic = stabilizeNflFullGameEvidenceTargets({
  baselineProduction: start, releasedForecast: upstream, homeTeam: "DET",
  build: (target) => resultFor(target.evaluatedBets[0].evaluatedQuote.sportsbook === "draftkings" ? selected : start),
});
assert.equal(cyclic.targetResolution.status, "cycle");
assert.equal(cyclic.targetResolution.iterations, 2);
assert.equal(cyclic.outcome, upstream, "a target cycle must retain the exact original forecast");
assert.equal(cyclic.production, start, "a target cycle must retain the exact original grades");
assert.equal(cyclic.arbitration.status, "neutral");
console.log("NFL final-target convergence and cycle: passed");
