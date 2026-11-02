import assert from "node:assert/strict";
import fixture from "./fixtures/cbb-exact-reference-probabilities-20261102.json";
import { gradeCbbProvisional } from "../lib/cbb/provisionalGradePolicy";
import type { CbbGradeEvidence } from "../lib/cbb/provisionalGradePolicy";
import { cbbExactMarketCenter } from "../lib/cbb/marketReaderResearch";
import { cbbThresholdProbabilities } from "../lib/cbb/model";

for (const row of fixture.cases) {
  const input = {target: row.target, references: row.references, forecast: row.forecast, asOf: fixture.asOf} as CbbGradeEvidence;
  const before = JSON.stringify(input);
  const result = gradeCbbProvisional(input);
  assert.equal(result.grade, row.nextGrade, row.match);
  assert.equal(result.referenceState, row.nextState, row.match);
  assert.equal(result.professionalReferenceQuotes.length,result.professionalReferences,"future frozen grades retain the exact references used");
  assert.ok(result.professionalReferenceQuotes.every(q=>q.gameId===row.id&&q.providerObservedAt<=fixture.asOf&&q.fetchedAt<=fixture.asOf));
  assert.equal(JSON.stringify(input), before, "grading does not mutate source, forecast or uncertainty");
}
const forecast = fixture.cases[0].forecast as CbbGradeEvidence["forecast"];
const quote = fixture.cases[0].target as CbbGradeEvidence["target"];
for (const line of [-7.5, -3.5, 0, 1.5, 10.5]) {
  for (const selection of ["first", "second"] as const) {
    const strong = selection === "first" ? 30 : -30;
    const margin = strong;
    const score = {...forecast, margin, homeScore: (forecast.total + margin)/2, awayScore: (forecast.total - margin)/2};
    const target = {...quote, line, firstPrice: -110, secondPrice: -110};
    const neutral = {...target, sportsbook: "circa"};
    const input = {target, references: [neutral], forecast: score, asOf: forecast.asOf} as CbbGradeEvidence;
    assert.equal(gradeCbbProvisional(input).referenceState, "neutral", `50% is neutral on either side of ${line}`);
    assert.equal(gradeCbbProvisional(input).grade, "Watchlist");
    const p = cbbThresholdProbabilities({...score, margin: cbbExactMarketCenter(score, neutral, .5)}, "spread", line);
    assert.ok(Math.abs(p.first/(p.first+p.second)-.5)<1e-7);
  }
}
for (const market of ["moneyline", "total"] as const) {
  const target = {...quote, market, line: market === "total" ? 145.5 : null, firstPrice:-110, secondPrice:-110};
  const result = gradeCbbProvisional({target, references:[{...target,sportsbook:"circa"}], forecast, asOf:forecast.asOf});
  assert.equal(result.referenceState,"neutral",`${market} exact fair50% remains neutral`);
}
console.log("PASS actual paired promotions/demotions, neutral references on both spread sides, totals, moneyline and unchanged inputs");
