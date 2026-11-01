import assert from "node:assert/strict";
import type { NflPreviewBookOdds } from "@/lib/services/football/balldontlieNflPreviewSlate";
import { readNflMarketInnovation } from "@/lib/services/football/nflMarketInnovationRuntime";
import { applyNflMarketInnovationPosture } from "@/lib/services/football/nflMarketInnovationPosture";
import { buildNflV1ActionableGradeBundle } from "@/lib/services/football/nflV1ActionableGradeCandidate";
import { buildNflIndependentScoreBaseForecast, getNflV1WeekOneOutcomeForecast } from "@/lib/services/football/nflV1WeekOneOutcome";

const evaluatedAt = "2026-11-01T14:30:00.000Z";
const openingAt = "2026-11-01T12:00:00.000Z";
const currentAt = "2026-11-01T14:00:00.000Z";
const gameStartsAt = "2026-11-01T18:00:00.000Z";
const raw = getNflV1WeekOneOutcomeForecast({ providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX" });
const base = buildNflIndependentScoreBaseForecast({ baseForecast: raw,
  independentScore: { expectedHomeMargin: 8.9, expectedTotal: 39, marketInputPolicy: "prohibited_from_independent_score" } });
const books: NflPreviewBookOdds[] = ["draftkings", "fanduel", "betmgm"].map(sportsbook => ({
  providerGameId: raw.providerGameId, sportsbook, observedAt: currentAt,
  moneyline: { homePrice: -110, awayPrice: -110 },
  spread: { homeLine: -3.5, awayLine: 3.5, homePrice: -110, awayPrice: -110 },
  total: { line: 45.5, overPrice: -110, underPrice: -110 },
}));
const shadowMoneyline = { health: { blockingReasons: [] }, decisionStage: "unlocked", lockedAt: null,
  evaluatedAt, evaluatedQuote: { sportsbook: books[0]!.sportsbook, line: null, price: -110, observedAt: currentAt },
  team: "JAX", modelProbability: base.homeWinProbability, otherBooksConsensusFairProbability: .5,
} as unknown as Parameters<typeof buildNflV1ActionableGradeBundle>[0]["shadowMoneyline"];
const grade = (qualifiedJointForecast: boolean) => buildNflV1ActionableGradeBundle({
  providerGameId: raw.providerGameId, awayTeam: "CLE", homeTeam: "JAX", gameStartsAt,
  current: books[0]!, comparableCurrentBooks: books, shadowMoneyline,
  outcomeForecast: { ...base, marketEvidence: undefined }, qualifiedJointForecast,
});
const original = grade(true);
assert.deepEqual(original.evaluatedBets.map(b => b.grade), ["Best Angle", "Best Angle", "Best Angle"]);
assert.equal(grade(false).evaluatedBets.find(b => b.market === "total")!.grade, "Watchlist",
  "the paired promotion rule qualifies a strong final Total without flattening other markets");
const q = (sportsbook: string, at: string, homePrice: number, awayPrice: number,
  totalLine: number): NflPreviewBookOdds => ({ providerGameId: raw.providerGameId,
  providerEventId: "exact", provider: "owls", sportsbook, observedAt: at,
  moneyline: { homePrice, awayPrice }, spread: null,
  total: { line: totalLine, overPrice: -110, underPrice: -110 },
});
const read = (history: NflPreviewBookOdds[]) => readNflMarketInnovation({ independentForecast: base,
  independentInputPolicy: "market_inputs_prohibited", history, evaluatedAt, gameStartsAt,
  excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] },
});
const conflict = read([
  q("circa", openingAt, -110, -110, 45), q("circa", currentAt, -120, 100, 47),
  q("pinnacle", openingAt, -110, -110, 45), q("pinnacle", currentAt, 100, -120, 43),
]);
assert.equal(conflict.receipt.reasons.moneyline, "opposed_named_economic_episodes");
assert.equal(conflict.receipt.reasons.total, "opposed_named_economic_episodes");
const adjusted = applyNflMarketInnovationPosture({ production: original, innovation: conflict.receipt, homeTeam: "JAX" });
assert.deepEqual(adjusted.production.evaluatedBets.map(b => b.grade), ["Lean", "Best Angle", "Lean"]);
assert.deepEqual(adjusted.posture.boardImpact, { bestAngleToLean: 2, actionableBefore: 3, actionableAfter: 3 });
for (const decision of original.evaluatedBets) {
  const result = adjusted.production.evaluatedBets.find(b => b.market === decision.market)!;
  assert.deepEqual({ ...result, grade: decision.grade }, decision,
    "posture preserves exact probabilities, EV, side, odds, clocks, execution and release fields");
}
assert.equal(applyNflMarketInnovationPosture({ production: adjusted.production, innovation: conflict.receipt,
  homeTeam: "JAX" }).production, adjusted.production, "repeated unresolved evidence cannot demote Lean to No Play");

const appliedAdverse = read([q("circa", openingAt, -120, 100, 45), q("circa", currentAt, -110, -110, 46)]);
assert.equal(appliedAdverse.receipt.selectedSources.moneyline, "circa");
assert.ok(appliedAdverse.outcome.expectedHomeScore > appliedAdverse.outcome.expectedAwayScore);
const adjudicated = applyNflMarketInnovationPosture({ production: original,
  innovation: appliedAdverse.receipt, homeTeam: "JAX" });
assert.equal(adjudicated.production, original,
  "an applied adverse episode is adjudicated and cannot automatically cap a retained independent edge");
assert.equal(adjudicated.posture.boardImpact.bestAngleToLean, 0);

const staticOnly = read([q("circa", openingAt, 100, -120, 45), q("circa", currentAt, 100, -120, 45)]);
assert.equal(applyNflMarketInnovationPosture({ production: original, innovation: staticOnly.receipt,
  homeTeam: "JAX" }).production, original,
  "a static favorite opposed to the final pick is not an adverse price episode");
const noAdverse = { ...conflict.receipt, episodes: conflict.receipt.episodes.filter(e => e.direction === 1) };
const onlySupport = applyNflMarketInnovationPosture({ production: original, innovation: noAdverse, homeTeam: "JAX" });
assert.equal(onlySupport.production.evaluatedBets.find(b => b.market === "moneyline")!.grade, "Best Angle",
  "an unresolved flag without actual adverse same-market economic evidence is insufficient");
const awayAndOver = { ...original, evaluatedBets: original.evaluatedBets.map(b => ({
  ...b, side: b.market === "total" ? "Over 45.5" : "CLE",
})) };
const oppositeSidePosture = applyNflMarketInnovationPosture({ production: awayAndOver,
  innovation: { ...noAdverse, reasons: { ...noAdverse.reasons, spread: "opposed_named_economic_episodes" },
    episodes: [...noAdverse.episodes, { ...noAdverse.episodes[0]!, market: "spread" as const }] }, homeTeam: "JAX" });
assert.deepEqual(oppositeSidePosture.production.evaluatedBets.map(b => b.grade), ["Lean", "Lean", "Best Angle"],
  "home-directed evidence opposes away ML/Spread but supports Over, respecting each market's selected side");

const jointFailure = { ...appliedAdverse.receipt,
  reasons: { ...appliedAdverse.receipt.reasons, moneyline: "joint_score_constraints_unidentifiable" },
  episodes: appliedAdverse.receipt.episodes.map(e => ({ ...e, selected: false })),
};
assert.equal(applyNflMarketInnovationPosture({ production: original, innovation: jointFailure, homeTeam: "JAX" })
  .production.evaluatedBets.find(b => b.market === "moneyline")!.grade, "Lean");

for (const lockedOriginal of [original, { ...original, evaluatedBets: original.evaluatedBets.map(b => ({
  ...b, stage: "t60_locked" as const, lockedAt: "2026-11-01T14:00:00.000Z",
})) }]) {
  const serialized = JSON.stringify(lockedOriginal);
  const locked = applyNflMarketInnovationPosture({ production: lockedOriginal,
    innovation: conflict.receipt, homeTeam: "JAX", existingLockedRecord: lockedOriginal === original });
  assert.equal(locked.production, lockedOriginal);
  assert.equal(JSON.stringify(locked.production), serialized, "existing locked tuples remain exact");
  assert.ok(locked.posture.evaluations.every(e => e.action === "locked_unchanged"));
}
const newlyEvaluatedT60 = { ...original, evaluatedBets: original.evaluatedBets.map(b => ({
  ...b, stage: "t60_locked" as const, lockedAt: "2026-11-01T17:00:00.000Z",
  evaluatedAt: "2026-11-01T17:00:00.000Z",
})) };
const newLock = applyNflMarketInnovationPosture({ production: newlyEvaluatedT60,
  innovation: conflict.receipt, homeTeam: "JAX", creatingNewLock: true });
assert.deepEqual(newLock.production.evaluatedBets.map(b => b.grade), ["Lean", "Best Angle", "Lean"],
  "a newly evaluated T-60 tuple receives the same posture before its first persistence as an unlocked tuple");
for (const decision of newlyEvaluatedT60.evaluatedBets) {
  const after = newLock.production.evaluatedBets.find(b => b.market === decision.market)!;
  assert.deepEqual({ ...after, grade: decision.grade }, decision,
    "new-lock posture preserves exact probability, source, price, stage and lock timestamp");
}
const persistedNewLock = applyNflMarketInnovationPosture({ production: newLock.production,
  innovation: conflict.receipt, homeTeam: "JAX", existingLockedRecord: true, creatingNewLock: true });
assert.equal(persistedNewLock.production, newLock.production,
  "an existing stored lock always takes precedence over a mistaken new-lock attestation");
console.log("NFL market innovation posture: unresolved named opposition, paired Total promotion, exact tuple/lock preservation passed.");
