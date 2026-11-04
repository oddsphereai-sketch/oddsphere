import assert from "node:assert/strict";
import {
  projectNhlJointMarketConsequences,
  type NhlJointMarketProjectionInput,
} from "../lib/automodel/nhlJointMarketProjection";

const close = (actual: number, expected: number, tolerance = 1e-7, message?: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `${actual} != ${expected}`);
};

const baseInput: NhlJointMarketProjectionInput = {
  independentHomeGoals: 3.35,
  independentAwayGoals: 2.65,
  homePuckLine: -1.5,
  totalLine: 6.5,
};
const base = projectNhlJointMarketConsequences(baseInput);
assert.equal(base.status, "identity");
close(base.pmf.reduce((sum, cell) => sum + cell.probability, 0), 1, 1e-12);
close(
  (base.totalOverProbability ?? 0) + (base.totalUnderProbability ?? 0) + (base.totalPushProbability ?? 0),
  1,
  1e-12,
);

const zeroEvidenceAgain = projectNhlJointMarketConsequences({ ...baseInput });
assert.deepEqual(zeroEvidenceAgain.pmf, base.pmf, "zero evidence returns the exact independent PMF");

const mlOnly = projectNhlJointMarketConsequences({
  ...baseInput,
  targetHomeWinProbability: base.homeWinProbability + 0.035,
});
assert.equal(mlOnly.status, "projected");
close(mlOnly.homeWinProbability, base.homeWinProbability + 0.035);
close(mlOnly.expectedTotalGoals, base.expectedTotalGoals);

const puckTarget = (base.homeCoverProbability ?? 0) < 0.5 ? 0.54 : 0.46;
const puckOnly = projectNhlJointMarketConsequences({
  ...baseInput,
  targetHomeCoverProbability: puckTarget,
});
assert.equal(puckOnly.status, "projected");
close(puckOnly.homeCoverProbability!, puckTarget);
close(puckOnly.homeWinProbability, base.homeWinProbability);
close(puckOnly.expectedTotalGoals, base.expectedTotalGoals);
assert.notEqual((base.homeCoverProbability ?? 0) >= 0.5, puckOnly.homeCoverProbability! >= 0.5, "puck-only evidence can flip the spread side");

const totalOnly = projectNhlJointMarketConsequences({
  ...baseInput,
  targetExpectedTotalGoals: base.expectedTotalGoals + 0.35,
});
assert.equal(totalOnly.status, "projected");
close(totalOnly.expectedTotalGoals, base.expectedTotalGoals + 0.35);
close(totalOnly.homeWinProbability, base.homeWinProbability);

const closeGame = projectNhlJointMarketConsequences({
  ...baseInput,
  targetHomeWinProbability: base.homeWinProbability + 0.025,
  targetHomeCoverProbability: (base.homeCoverProbability ?? 0) - 0.04,
});
assert.equal(closeGame.status, "projected");
close(closeGame.homeWinProbability, base.homeWinProbability + 0.025);
close(closeGame.homeCoverProbability!, (base.homeCoverProbability ?? 0) - 0.04);
close(closeGame.expectedTotalGoals, base.expectedTotalGoals);

const upset = projectNhlJointMarketConsequences({
  ...baseInput,
  targetHomeWinProbability: 0.46,
  targetHomeCoverProbability: Math.min(0.40, (base.homeCoverProbability ?? 0) - 0.02),
});
assert.equal(upset.status, "projected");
assert.ok(upset.homeWinProbability < 0.5, "qualified upset evidence can flip the winner");
assert.ok(upset.homeCoverProbability! < 0.5, "qualified puck evidence can retain the opposing spread side");

const reflected = projectNhlJointMarketConsequences({
  independentHomeGoals: baseInput.independentAwayGoals,
  independentAwayGoals: baseInput.independentHomeGoals,
  homePuckLine: 1.5,
  totalLine: baseInput.totalLine,
  targetHomeWinProbability: 1 - closeGame.homeWinProbability,
  targetHomeCoverProbability: 1 - closeGame.homeCoverProbability!,
});
assert.equal(reflected.status, "projected");
close(reflected.expectedHomeGoals, closeGame.expectedAwayGoals, 2e-7);
close(reflected.expectedAwayGoals, closeGame.expectedHomeGoals, 2e-7);
close(reflected.homeWinProbability, 1 - closeGame.homeWinProbability, 2e-7);
close(reflected.homeCoverProbability!, 1 - closeGame.homeCoverProbability!, 2e-7);
for (const cell of closeGame.pmf) {
  const mirror = reflected.pmf.find((candidate) => (
    candidate.homeGoals === cell.awayGoals && candidate.awayGoals === cell.homeGoals
  ));
  assert.ok(mirror);
  close(mirror.probability, cell.probability, 2e-7);
}

const reordered = projectNhlJointMarketConsequences({
  totalLine: baseInput.totalLine,
  targetHomeCoverProbability: (base.homeCoverProbability ?? 0) - 0.04,
  homePuckLine: baseInput.homePuckLine,
  independentAwayGoals: baseInput.independentAwayGoals,
  targetHomeWinProbability: base.homeWinProbability + 0.025,
  independentHomeGoals: baseInput.independentHomeGoals,
});
assert.equal(reordered.status, "projected");
assert.deepEqual(reordered.pmf, closeGame.pmf, "input property order cannot affect the projection");

const invalid = projectNhlJointMarketConsequences({
  ...baseInput,
  targetHomeWinProbability: 1.2,
});
assert.equal(invalid.status, "failed_closed");
assert.match(invalid.reason ?? "", /invalid_or_infeasible_home_win_probability/);
assert.deepEqual(invalid.pmf, base.pmf, "invalid constraints fail closed to the exact independent PMF");

const missingLine = projectNhlJointMarketConsequences({
  independentHomeGoals: baseInput.independentHomeGoals,
  independentAwayGoals: baseInput.independentAwayGoals,
  targetHomeCoverProbability: 0.55,
});
assert.equal(missingLine.status, "failed_closed");
assert.equal(missingLine.reason, "cover_target_requires_exact_home_puck_line");

console.log("NHL joint market consequence projection tests passed.");
