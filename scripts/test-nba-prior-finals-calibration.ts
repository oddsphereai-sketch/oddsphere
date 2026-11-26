import assert from "node:assert/strict";
import { applyNbaPriorFinalsCalibration, groupNbaClimateResiduals, nbaClimateDay, nbaClimatePosterior,
  NBA_PRIOR_FINALS_CALIBRATION_RELEASE, NBA_PRIOR_FINALS_SOURCE_RECIPE,
  type NbaClimateHead, type NbaClimateObservation, type NbaClimateTarget } from "../lib/research/nba/nbaPriorFinalsCalibration";
import { nbaPlayerStateHash } from "../lib/research/nba/nbaPlayerStateLedger";
const parameters = { signalVariance: 5, noiseVariance: 11, lengthDays: 3 };
const headCore = { release: NBA_PRIOR_FINALS_CALIBRATION_RELEASE, sourceRecipe: NBA_PRIOR_FINALS_SOURCE_RECIPE,
  baselineRecipe: "frozen-earlier-training", clockMode: "verified_original_publication_only" as const,
  trainingSeason: 2022, trainingEnd: "2023-04-10T01:00:00Z", trainingHash: "a".repeat(64),
  trainingBaselineHash: "b".repeat(64), rawFitSha256: "c".repeat(64), margin: parameters, total: parameters };
const head: NbaClimateHead = { ...headCore, hash: nbaPlayerStateHash(headCore) };
const target: NbaClimateTarget = { gameId: "0000000999", season: 2023, startAt: "2023-11-06T23:00:00Z", cutoff: "2023-11-06T22:00:00Z",
  baselineHash: "d".repeat(64), baselineRecipe: head.baselineRecipe, baselineTrainingEnd: "2023-04-10T00:00:00Z", sourceRecipe: NBA_PRIOR_FINALS_SOURCE_RECIPE };
function row(id: number, day: number, totalResidual: number): NbaClimateObservation {
  return { gameId: String(id).padStart(10,"0"), season: 2023, startAt: `2023-11-${String(day).padStart(2,"0")}T23:00:00Z`,
    finalAvailableAt: `2023-11-${String(day+1).padStart(2,"0")}T02:00:00Z`, sourceSha256: String(id%10).repeat(64),
    sourceRecipe: target.sourceRecipe, baselineHash: target.baselineHash, baselineMargin: 1, baselineTotal: 200-totalResidual,
    homeScore: 101, awayScore: 99 };
}
const observations = [row(1,1,-3),row(2,1,4),row(3,2,2),row(4,5,-1),row(5,5,7),row(6,5,3)];
const originalBytes = JSON.stringify(observations);
const apply = (rows: NbaClimateObservation[], t = target, h = head) => applyNbaPriorFinalsCalibration({head: h,target: t,observations: rows,independent:{margin:2,total:220}});
const result = apply(observations);
assert.equal(result.observationsUsed,6); assert.equal(result.daysUsed,3);
// Fixed dense individual-observation GP fixture, independently computed in SciPy.
assert(Math.abs(result.totalCorrection-1.2816738776982177)<1e-12);
assert(Math.abs(result.totalStateVariance-3.490812916937936)<1e-12);
assert.equal(result.homeScore+result.awayScore,result.total);
assert(Math.abs(result.homeScore-result.awayScore-result.marginHome)<1e-12);
assert.deepEqual(apply([...observations].reverse()),result);
assert.deepEqual(apply([...observations,structuredClone(observations[0])]),result);
assert.throws(()=>apply([...observations,{...observations[0],homeScore:102}]),/conflicting/);
const poisons = [
  {...observations[0],gameId:target.gameId,homeScore:NaN},
  {...observations[0],season:2024,homeScore:NaN},
  {...observations[0],gameId:"0000000777",startAt:"2023-11-07T00:00:00Z",homeScore:NaN},
  {...observations[0],gameId:"0000000778",finalAvailableAt:"2023-11-06T22:00:01Z",homeScore:NaN}
];
assert.deepEqual(apply([...observations,...poisons]),result);
const noSource = apply([],target);
assert.equal(noSource.status,"no_eligible_prior");assert.equal(noSource.marginHome,2);assert.equal(noSource.total,220);
assert.equal(noSource.totalStateVariance,5);assert.equal(noSource.marginStateVariance,5);
assert.deepEqual(apply(observations,{...target,season:2024,startAt:"2024-11-06T23:00:00Z",cutoff:"2024-11-06T22:00:00Z"}),noSource);
assert.throws(()=>apply([{...observations[0],baselineHash:"e".repeat(64)}]),/invalid_climate_observation/);
assert.throws(()=>apply([{...observations[0],sourceSha256:"bad"}]),/invalid_climate_observation/);
assert.throws(()=>apply([{...observations[0],finalAvailableAt:observations[0].startAt}]),/invalid_climate_observation/);
assert.throws(()=>apply(observations,{...target,baselineTrainingEnd:target.cutoff}),/incompatible/);
assert.throws(()=>apply(observations,target,{...head,total:{...parameters,noiseVariance:0}}),/incompatible/);
assert.throws(()=>apply(observations,target,{...head,trainingEnd:target.cutoff}),/incompatible/);
assert.throws(()=>apply(Array.from({length:10001},()=>observations[0])),/budget/);
assert.throws(()=>nbaClimatePosterior(parameters,[{day:7,count:1,totalMean:1,marginMean:1,totalSse:0,marginSse:0}],6,"total"),/invalid/);
const sameDay = row(7,6,5); sameDay.startAt="2023-11-06T16:00:00Z";sameDay.finalAvailableAt="2023-11-06T19:00:00Z";
assert.equal(groupNbaClimateResiduals([sameDay],target).observations,1,"earlier original same-day final is eligible");
assert.equal(groupNbaClimateResiduals([{...sameDay,finalAvailableAt:target.cutoff}],target).observations,1,"inclusive source cutoff");
assert.equal(nbaClimateDay("2023-11-06T02:00:00Z"),nbaClimateDay("2023-11-05T23:00:00Z"),"Eastern slate clock");
assert.equal(JSON.stringify(observations),originalBytes,"original evidence is immutable");
console.log("PASS NBA C3 dense fixture, grouping, clock/source/target/future/duplicate/season controls, coherent scores and immutability");
