import assert from "node:assert/strict";
import { validateLaw, lawForecast, primitives } from "../lib/playerPropsAi/law";
import { priceAiLaw } from "../lib/playerPropsAi/pricing";
import { reviewSlots, monthSlots } from "../lib/playerPropsAi/schedule";
import { usageMicroUsd } from "../lib/playerPropsAi/budget";
import { PROPS_AI_SCENARIOS } from "../lib/playerPropsAi/releases";
import { scenarioColumns, decodeScenarioRows } from "../lib/playerPropsAi/scenarioCoordinates";
const vector = (n: number) => Array(PROPS_AI_SCENARIOS).fill(n) as number[];
const nba = { markets: ["points", "threes", "rebounds", "assists", "points_rebounds_assists"] };
const raw = { weights: [9, 1, ...Array(14).fill(0)], outcomes: { points: [10, 40, ...Array(14).fill(10)], rebounds: vector(2), assists: vector(3), threes: vector(0) } };
const before = JSON.stringify(raw), law = validateLaw("nba", nba, raw);
assert.equal(lawForecast(law, "points", 12.5).mean, 13);
assert.equal(lawForecast(law, "points", 12.5).preferredSide, "under"); // Means do not define the favored event.
assert.equal(lawForecast(law, "points_rebounds_assists", 17.5).mean, 18);
assert.equal(JSON.stringify(raw), before);
assert.throws(() => validateLaw("nba", nba, { ...raw, outcomes: { ...raw.outcomes, threes: vector(6) } }), /made threes/);
const integer = lawForecast(law, "points", 10); assert.equal(integer.push, .9); assert.equal(integer.over, .1);
const quotes = ["over", "under"].map(side => ({ id: side, book: "synthetic", provider: "synthetic", line: 12.5, side: side as "over" | "under", american: -110,
  availableAt: "2026-11-06T17:59:00Z", confirmedAt: "2026-11-06T17:59:00Z", current: true, actionRule: "qualifying_participation" as const }));
const priced = priceAiLaw({ law, market: "points", quotes, now: "2026-11-06T18:00:00Z", maxAgeMs: 300000, confidence: 2, exception: null });
assert.equal(priced!.side, "under"); assert.equal(priced!.grade, "Best Angle"); assert.equal(priced!.probability, .9);
assert.equal(priceAiLaw({ law, market: "points", quotes: quotes.map(q => ({ ...q, confirmedAt: null })), now: "2026-11-06T18:00:00Z", maxAgeMs: 300000, confidence: 2, exception: null }), null);
assert.equal(priceAiLaw({ law, market: "points", quotes, now: "2026-11-06T18:00:00Z", maxAgeMs: 300000, confidence: 2, exception: "identity unresolved" })!.grade, "No Play");
const confidenceLaw = validateLaw("nba", nba, { ...raw, weights: [55,45,...Array(14).fill(0)], outcomes: { ...raw.outcomes, points: [20,10,...Array(14).fill(10)] } });
const badPrice = quotes.map(q => ({ ...q, american: q.side === "over" ? -130 : 110 }));
const lean = priceAiLaw({ law: confidenceLaw, market: "points", quotes: badPrice, now: "2026-11-06T18:00:00Z", maxAgeMs: 300000, confidence: 2, exception: null });
assert.equal(lean!.grade, "Lean"); assert.ok(lean!.expectedValue < 0); assert.equal(lean!.recommendationBasis, "outcome_confidence_with_paired_margin");
const nfl = { markets: ["passing_tds", "anytime_td"] }, nflKeys = primitives("nfl", nfl);
const nflOutcomes = Object.fromEntries(nflKeys.map(k => [k, vector(k === "passing_attempts" ? 30 : k === "passing_completions" ? 20 : k === "passing_tds" ? 3 : 0)]));
const nflLaw = validateLaw("nfl", nfl, { weights: vector(1), outcomes: nflOutcomes });
assert.equal(lawForecast(nflLaw, "anytime_td", .5).over, 0); // Passing TDs do not win an anytime scorer bet.
assert.equal(lawForecast(nflLaw, "passing_tds", 1.5).over, 1);
assert.throws(() => validateLaw("nfl", nfl, { weights: vector(1), outcomes: { ...nflOutcomes, passing_completions: vector(31) } }), /attempts/);
const pitcher = { markets: ["pitcher_outs", "pitcher_strikeouts"] };
const pitcherOutcomes = Object.fromEntries(primitives("mlb", pitcher).map(k => [k, vector(k === "pitcher_outs" ? 2 : k === "pitcher_strikeouts" ? 3 : 0)]));
assert.doesNotThrow(() => validateLaw("mlb", pitcher, { weights: vector(1), outcomes: pitcherOutcomes })); // Uncaught third strike.
const batter = { markets: ["batter_hits", "batter_total_bases", "batter_hits_runs_rbis", "batter_home_runs"] };
const batterOutcomes = Object.fromEntries(primitives("mlb", batter).map(k => [k, vector(["batter_home_runs", "batter_runs_scored", "batter_rbis", "batter_singles"].includes(k) ? 1 : 0)]));
const batterLaw = validateLaw("mlb", batter, { weights: vector(1), outcomes: batterOutcomes });
assert.equal(lawForecast(batterLaw, "batter_hits", 1.5).mean, 2); assert.equal(lawForecast(batterLaw, "batter_total_bases", 4.5).mean, 5); assert.equal(lawForecast(batterLaw, "batter_hits_runs_rbis", 3.5).mean, 4);
assert.throws(() => validateLaw("mlb", batter, { weights: vector(1), outcomes: { ...batterOutcomes, batter_rbis: vector(0) } }), /home runs/);
for (const start of ["2026-11-01T18:00:00Z", "2026-03-08T17:00:00Z", "2026-11-09T01:15:00Z"]) {
  const slots = reviewSlots({ sport: "nfl", id: "synthetic", start, lock: new Date(Date.parse(start) - 3600000).toISOString() });
  assert.equal(slots.length, 2); assert.notEqual(slots[0].key, slots[1].key); assert.ok(Date.parse(slots[0].dueAt) < Date.parse(slots[1].dueAt));
}
const crossing = { sport: "nba" as const, id: "boundary", start: "2026-12-01T03:00:00Z", lock: "2026-12-01T02:00:00Z" };
assert.equal(monthSlots([crossing], "2026-11", "2026-11-30T12:00:00Z").length, 1);
assert.equal(monthSlots([crossing], "2026-12", "2026-11-30T12:00:00Z").length, 1);
assert.equal(usageMicroUsd("gpt-6-luna", { input_tokens: 145000, output_tokens: 10000 }), 19500);
assert.equal(usageMicroUsd("gpt-6.1-terra", { input_tokens: 145000, output_tokens: 10000 }), 195000);
assert.equal(usageMicroUsd("gpt-6-luna", { input_tokens: 145000, output_tokens: 10000 },"flex"), 9750);
assert.equal(usageMicroUsd("gpt-6-luna", { input_tokens: 145000, output_tokens: 10000 },"unknown"), 19500);
assert.equal(usageMicroUsd("gpt-6-luna", { input_tokens: 1, output_tokens: 1 },"flex"), 1); // Integer ceiling after discount.
const physical = (sport: "nba"|"nfl"|"mlb", player: {markets:string[]}, coordinates: Record<string,number>) => {
  const rows=Array.from({length:PROPS_AI_SCENARIOS},()=>scenarioColumns(sport,player).map(k=>coordinates[k]??0));
  return validateLaw(sport,player,decodeScenarioRows(sport,player,rows));
};
const qb={markets:["passing_yards","passing_tds","interceptions","rushing_yards","anytime_td"]};
const physicalQb=physical("nfl",qb,{relativeWeight:1,other_incomplete_passes:6,non_touchdown_completions:18,passing_tds:2,interceptions:1,passing_yards_gained:210,passing_yards_lost:10,rushing_yards_lost:2,touchdowns:0});
assert.equal(physicalQb.outcomes.passing_completions[0],20);assert.equal(physicalQb.outcomes.passing_attempts[0],27);
assert.equal(physicalQb.outcomes.passing_yards[0],200);assert.equal(physicalQb.outcomes.rushing_yards[0],-2);
assert.equal(lawForecast(physicalQb,"anytime_td",.5).over,0);
const physicalBatter=physical("mlb",batter,{relativeWeight:1,batter_home_runs:2,batter_non_home_run_runs:1,batter_non_home_run_rbis:3,batter_singles:1});
assert.equal(physicalBatter.outcomes.batter_runs_scored[0],3);assert.equal(physicalBatter.outcomes.batter_rbis[0],5);
assert.equal(lawForecast(physicalBatter,"batter_hits",.5).mean,3);assert.equal(lawForecast(physicalBatter,"batter_total_bases",.5).mean,9);
assert.equal(lawForecast(physicalBatter,"batter_hits_runs_rbis",.5).mean,11);
console.log("Player-prop AI core: coherent laws, rare/binary/push contracts, symmetric grade changes, exact prices, clocks and two-window billing boundaries passed. No API calls.");
