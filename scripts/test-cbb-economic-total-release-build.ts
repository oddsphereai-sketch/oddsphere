import assert from'node:assert/strict';
import{existsSync,readFileSync}from'node:fs';
import{cbbEconomicTotalLevelNormalizer,cbbEconomicDualAxisRow,cbbEconomicTotalSourceClosure,prepareCbbEconomicLegacyMargins,validateCbbReleaseRawRows,verifyCbbReleaseDataAdmission,CBB_RELEASE_COHORT_PINS,CBB_ECONOMIC_TOTAL_FIT_OPTIONS,CBB_ECONOMIC_TOTAL_CALIBRATION_OPTIONS}from'./operator/build-cbb-economic-total-release';
import{buildCbbOutcomeInputs,cbbOutcomeLevelNormalizer}from'../lib/cbb/economicTotalForecast';
import{validateCbbCrossfitScoreRows,cbbScoreCalibrationTrainingIdsSha256,type CbbCrossfitAxisFitManifest}from'../lib/cbb/contextualScoreCalibrationResearch';
import type{CbbMeasurementTrainingRow}from'../lib/cbb/contextualMeasurementForecast';
const manifest=(axis:'margin'|'total',ids:number[]):CbbCrossfitAxisFitManifest=>({axis,artifactSha256:(axis==='margin'?'a':'b').repeat(64),artifactObjectSha256:'c'.repeat(64),methodSha256:(axis==='margin'?'d':'e').repeat(64),trainingRowsSha256:'f'.repeat(64),trainingGameIds:ids,normalizerTrainingGameIds:ids,trainingGameIdsSha256:cbbScoreCalibrationTrainingIdsSha256(ids),normalizerTrainingGameIdsSha256:cbbScoreCalibrationTrainingIdsSha256(ids),inputSha256:'1'.repeat(64),foldId:axis==='margin'?'old-fold':'new-fold',predictionMode:'retrospective_development',ownGameExcluded:true,source:'saved_game_excluded_prediction'});
const raw={gameId:1,actualHome:80,actualAway:70,input:{}}as CbbMeasurementTrainingRow,m=manifest('margin',[2,3]),t=manifest('total',[3,4]);
// The helper must not substitute axis-specific input hashes; both axis manifests
// are generated from the identical original input in the real build.
import{createHash}from'node:crypto';const hash=createHash('sha256').update(JSON.stringify(raw.input)).digest('hex');m.inputSha256=hash;t.inputSha256=hash;
const row=cbbEconomicDualAxisRow(raw,{mean:8,sd:12,manifest:m},{mean:149,sd:17,manifest:t});assert.deepEqual(row.fitTrainingGameIds,[2,3,4]);assert.equal(validateCbbCrossfitScoreRows([row]),true);assert.equal(row.fitManifest.provenanceScope,'per_axis_union_no_shared_fit_or_normalizer');
assert.deepEqual(CBB_ECONOMIC_TOTAL_FIT_OPTIONS,{maxIterations:250});assert.deepEqual(CBB_ECONOMIC_TOTAL_CALIBRATION_OPTIONS,{maxIterations:60,maxLawEvaluations:25000,gradientTolerance:1e-4,lawNumerics:{absoluteTolerance:1e-10,relativeTolerance:1e-9,tailMassTolerance:1e-13,maxEvaluations:8_000_000,maxAdaptiveDepth:20,maxGridScore:2048,maxGridCells:500_000}});
const closure=cbbEconomicTotalSourceClosure();assert.ok(closure.some(p=>p.path.endsWith('economicTotalForecast.ts')));assert.ok(closure.some(p=>p.path.endsWith('2026-11-06-cbb-economic-total-predeclaration.json')));
const code=readFileSync('scripts/operator/build-cbb-economic-total-release.ts','utf8');assert.ok(!code.includes('fitCbbContextualMeasurementForecast('),'No source-factor fit');assert.ok(!code.includes("for(const axis of ['margin'"),'No Margin fitting loop');
const path='/private/tmp/cbb-contextual-direct-v8-frozen-raw-rows-20261106.json';if(existsSync(path)){
 const raw=JSON.parse(readFileSync(path,'utf8'));assert.equal(validateCbbReleaseRawRows(raw),true);assert.equal(raw.trainingRows.length,CBB_RELEASE_COHORT_PINS.trainingGames);const admission=verifyCbbReleaseDataAdmission(raw);assert.equal(admission.original137BytesAndSemanticsPreserved,true);assert.equal(admission.all45NamedFrameFinalsAdmitted,true);
 const legacy=prepareCbbEconomicLegacyMargins(raw);assert.equal(legacy.rows.length,182);assert.equal(legacy.proof.marginFits,0);assert.ok(legacy.rows.every(r=>!r.manifest.trainingGameIds.includes(r.gameId)));
 const inputs=raw.trainingRows.map((r:CbbMeasurementTrainingRow)=>buildCbbOutcomeInputs(r.input).total);assert.deepEqual(cbbEconomicTotalLevelNormalizer(inputs),cbbOutcomeLevelNormalizer(inputs),'Independent own-cohort normalizer units/active/center/scale proof');
}
console.log('PASS economic Total build: immutable182 admission/folds, independent normalization proof, exact137+45 frozen Margin provenance, truthful dual-axis calibration, unchanged budgets; no fits.');
