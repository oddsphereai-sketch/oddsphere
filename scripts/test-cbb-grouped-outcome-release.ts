/** Synthetic engine/transport integration, never predictive qualification. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {coordinates} from "../lib/cbb/groupedOutcomeCoordinates";
import {RELEASE,type ResidualModel} from "../lib/cbb/groupedResidualPrediction";
import {CBB_GROUPED_OUTCOME_RELEASE,cbbGroupedOutcomeMethodSha256,predictCbbGroupedOutcomeForecast,validateCbbGroupedOutcomeArtifact,type CbbGroupedOutcomeArtifact} from "../lib/cbb/groupedOutcomeForecast";
import {cbbContextualForecastObjectSha256,type CbbContextualForecastCalibrationBinding} from "../lib/cbb/contextualForecastCalibrationBinding";
import {cbbScoreCalibrationMethodSha256} from "../lib/cbb/contextualScoreCalibrationResearch";
import {packageCbbPrivateOutcomeArtifact,decodeCbbPrivateOutcomeArtifact} from "../lib/services/cbb/cbbOutcomeArtifactEnvelope";
import {createCbbContextualOutcomeRuntime,CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,readCbbContextualOutcomeEvidence} from "../lib/services/cbb/cbbContextualOutcomeRuntime";
import {CBB_CONTEXTUAL_READER_INPUT_RELEASE,type CbbContextualAssembledInput} from "../lib/services/cbb/cbbContextualReaderInput";
import type {CbbForecast} from "../lib/cbb/types";
const sha=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const at="2026-11-18T16:00:00Z",available="2026-11-18T12:00:00Z";
const independent:CbbForecast={gameId:9001,homeId:71,awayId:72,asOf:"2026-11-18T15:00:00Z",release:"synthetic",inputStatus:"complete",
  homeScore:75.5,awayScore:70.5,possessions:70,issues:[],margin:5,total:146,homeWinProbability:.65,uncertainty:{marginSd:11,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:100}};
const input:CbbContextualAssembledInput={independent,asOf:at,startsAt:"2026-11-18T18:00:00Z",currentQuotes:[],
  sourceStateEvidence:{release:CBB_CONTEXTUAL_READER_INPUT_RELEASE,gameId:9001,startsAt:"2026-11-18T18:00:00Z",priceQuarantines:[],sourceBaselineQuotes:[]}};
const built=coordinates(input),ids=Array.from({length:100},(_,i)=>i+1),calIds=Array.from({length:40},(_,i)=>i+1001);
const models=Object.fromEntries((["margin","total"] as const).map(axis=>{
  const row=built[axis],index=row.names.indexOf("independent.relative_point");
  const m:ResidualModel={release:RELEASE,axis,status:"converged",iterations:1,names:row.names,groups:row.groups,
    scales:row.names.map(()=>1),active:[index],coefficients:[.5],covariance:[[.5]],noiseVariance:axis==="margin"?121:256,
    fittedPrecisions:{level:2},trainingIds:ids,trainingSha256:"a".repeat(64),initialObjective:2,objective:1,maxGradientPerGame:0};
  return[axis,m];
})) as {margin:ResidualModel;total:ResidualModel};
const model:CbbGroupedOutcomeArtifact={release:CBB_GROUPED_OUTCOME_RELEASE,authority:"offline_research_only",methodSha256:cbbGroupedOutcomeMethodSha256(),
  trainingRowsSha256:"b".repeat(64),trainingGameIds:ids,trainingGames:100,calibrationGameIds:calIds,createdAt:available,availableBy:available,
  trainingCutoff:"2026-11-15T12:00:00Z",models,frozenResearchArtifactSha256:"c".repeat(64)};
validateCbbGroupedOutcomeArtifact(model);const before=JSON.stringify(model),p=predictCbbGroupedOutcomeForecast(model,{gameId:9001,asOf:at,input},"future");
assert.equal(p.margin.mean,5);assert.equal(p.total.mean,146);assert.equal(p.margin.sd,11);assert.equal(p.total.sd,16);
assert.equal(JSON.stringify(model),before);
assert.throws(()=>predictCbbGroupedOutcomeForecast(model,{gameId:1001,asOf:at,input:{...input,independent:{...independent,gameId:1001}}},"future"),/exclusion/);
assert.throws(()=>predictCbbGroupedOutcomeForecast(model,{gameId:9001,asOf:"2026-11-18T11:00:00Z",input:{...input,asOf:"2026-11-18T11:00:00Z"}},"future"),/availability/);
const binding:CbbContextualForecastCalibrationBinding={authority:"offline_development_only",forecastArtifactObjectSha256:cbbContextualForecastObjectSha256(model),
  forecastMethodSha256:model.methodSha256,calibrationMethodSha256:cbbScoreCalibrationMethodSha256(),availableBy:available,status:"converged",
  parameters:{logMarginScale:0,logTotalScale:0,beta:0},crossfit:{scope:"disjoint_later_calibration",ownGameExcluded:true,
    trainingGameIdsSha256:sha(ids),calibrationGameIdsSha256:sha(calIds),rowsSha256:"d".repeat(64)}};
const modelJSON=JSON.stringify(model),calibrationJSON=JSON.stringify({schema:"cbb_outcome_joint_calibration_v1",availableBy:available,
  fullModel:{fileSha256:createHash("sha256").update(modelJSON).digest("hex"),objectSha256:cbbContextualForecastObjectSha256(model)},
  calibration:{status:"converged",parameters:binding.parameters},binding});
const packed=packageCbbPrivateOutcomeArtifact({runtimeModelRelease:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,modelJSON,calibrationJSON});
const loaded=decodeCbbPrivateOutcomeArtifact(packed.compressed,packed.manifest),runtime=createCbbContextualOutcomeRuntime({manifest:packed.manifest,loaded});
const board=runtime.evaluate({input,independent,targets:[]});
assert.equal(board.modelRelease,CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE);assert.equal(board.rows.length,3);
assert.equal(board.score.home+board.score.away,board.score.total);
assert.ok(Math.abs(board.score.home-board.score.away-board.score.margin)<1e-10);
assert.throws(()=>readCbbContextualOutcomeEvidence(board),/identity mismatch/,"Synthetic private model cannot impersonate the pinned production artifact");
assert.equal(board.rows.every(r=>r.grade==="Held"),true,"No native price is fabricated");
const corrupt=structuredClone(model);Object.freeze(corrupt);corrupt.models.margin.coefficients[0]=NaN;
assert.throws(()=>validateCbbGroupedOutcomeArtifact(corrupt),/head invalid/);
console.log("PASS grouped R8: coherent score law, genuine disjoint calibration, bounded private transport, missing-price honesty, own-game/clock guards, immutable model and exact stored reader");
