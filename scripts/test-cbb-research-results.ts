import assert from "node:assert/strict";
import results from "../lib/cbb/artifacts/research-r6-r9.json";
assert.equal(results.status, "private_research_no_replacement");
assert.equal(results.productionWrites, 0); assert.equal(results.providerCalls, 0);
assert.equal(results.r9.selected, null);
assert.equal(results.r6.candidates.length + results.r7.candidates.length + results.r8.candidates.length + results.r9.candidates.length, 19);
assert.ok(results.r6.candidates.every(c => c.numerical.unconverged === 0));
for (const profile of [results.r7, results.r8]) {
  assert.equal(profile.diagnostic.candidate.games, results.baseline.games);
  assert.equal(profile.diagnostic.candidate.wins - results.baseline.wins, profile.diagnostic.corrections - profile.diagnostic.harms);
  assert.ok(profile.diagnostic.candidate.marginMae < results.baseline.marginMae);
  assert.ok(profile.diagnostic.candidate.totalMae < results.baseline.totalMae);
}
for (const cohort of [results.openingTotal635, ...Object.values(results.threeMarket353)]) {
  for (const version of ["r2", "r6", "r7", "r8"] as const) {
    const row = cohort[version], baseline = cohort.r2;
    assert.equal(row.wins + row.losses + row.pushes + row.passes, baseline.wins + baseline.losses + baseline.pushes + baseline.passes);
    assert.equal(row.wins - baseline.wins, row.corrections - row.harms);
    assert.ok(Number.isFinite(row.unitsAtOneRisked));
  }
}
assert.ok(results.threeMarket353.spread.r8.wins < results.threeMarket353.spread.r2.wins);
assert.ok(results.openingTotal635.r8.wins < results.openingTotal635.r2.wins);
console.log("CBB research results: 19 settings retained, exact paired cohorts/WLP deltas, regressions exposed and no replacement/production claims passed.");
