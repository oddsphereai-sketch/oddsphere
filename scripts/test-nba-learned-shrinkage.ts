import assert from "node:assert/strict";
import {scoreNbaLearnedShrinkage,NBA_LEARNED_SHRINKAGE_RELEASE,type NbaLearnedShrinkageHead} from "../lib/research/nba/nbaLearnedShrinkage";
import {scoreNbaPortableModel,type NbaPortableModelArtifact} from "../lib/automodel/nba/nbaPortableScoreModel";
import {nbaPlayerStateHash} from "../lib/research/nba/nbaPlayerStateLedger";
const names=Array.from({length:75},(_,i)=>`feature_${i}`),coefficients=names.map((_,i)=>(i-37)/100);
const design={features:names,missingIndicatorColumns:[names[0]],rawFeatureMedians:names.map((_,i)=>i),designMeans:Array(76).fill(0),designStandardDeviations:Array(76).fill(2),designColumns:76,splineKnots:[]};
const margin={weightVariance:1,noiseVariance:1000,alpha:1000,coefficients:[...coefficients,2,3]},total={...margin,coefficients:[...coefficients,4,220]};
const core:Omit<NbaLearnedShrinkageHead,"hash">={release:NBA_LEARNED_SHRINKAGE_RELEASE,sourceRecipe:"verified-original",trainingHash:"a".repeat(64),baselineHash:"b".repeat(64),rawFitSha256:"c".repeat(64),trainingEnd:"2023-04-10T00:00:00Z",trainingRows:2457,design,margin,total};
const head={...core,hash:nbaPlayerStateHash(core)},target={season:2023,cutoff:"2023-11-01T22:00:00Z",sourceRecipe:head.sourceRecipe};
const artifact:NbaPortableModelArtifact={release:"fixed-comparator",featureRelease:"verified-original",architecture:"margin_total",model:{family:"ridge",alpha:1000},design,coefficients:{target_home_margin:margin.coefficients,target_total:total.coefficients}};
for(const absent of [false,true]){
 const features:Record<string,number|null>=Object.fromEntries(names.map((f,i)=>[f,i/2]));if(absent)features[names[0]]=null;
 const bytes=JSON.stringify(features),got=scoreNbaLearnedShrinkage(head,features,target),reference=scoreNbaPortableModel(artifact,features);
 assert.deepEqual({homeScore:got.homeScore,awayScore:got.awayScore,marginHome:got.marginHome,total:got.total},reference);
 assert.deepEqual(scoreNbaLearnedShrinkage(head,{...features,target_total:99999,target_home_score:-99999},target),got,"target poison not a selected feature");
 assert.equal(JSON.stringify(features),bytes);
 assert(Math.abs(got.homeScore+got.awayScore-got.total)<1e-12);assert(Math.abs(got.homeScore-got.awayScore-got.marginHome)<1e-12);
}
assert.throws(()=>scoreNbaLearnedShrinkage(head,{}, {...target,season:2022}),/incompatible/);
assert.throws(()=>scoreNbaLearnedShrinkage(head,{}, {...target,cutoff:head.trainingEnd}),/incompatible/);
assert.throws(()=>scoreNbaLearnedShrinkage(head,{}, {...target,sourceRecipe:"different"}),/incompatible/);
assert.throws(()=>scoreNbaLearnedShrinkage({...head,total:{...total,coefficients:[NaN]}},{},target),/incompatible/);
const rehash=(changed:Omit<NbaLearnedShrinkageHead,"hash">)=>({...changed,hash:nbaPlayerStateHash(changed)});
assert.throws(()=>scoreNbaLearnedShrinkage(rehash({...core,total:{...total,alpha:2}}),{},target),/coefficients/);
assert.throws(()=>scoreNbaLearnedShrinkage(rehash({...core,design:{...design,missingIndicatorColumns:["unknown"]}}),{},target),/indicator/);
assert.throws(()=>scoreNbaLearnedShrinkage(rehash({...core,design:{...design,designStandardDeviations:Array(76).fill(0)}}),{},target),/incompatible/);
assert.throws(()=>scoreNbaLearnedShrinkage(rehash({...core,total:{...total,coefficients:Array(77).fill(-100)}}),{},target),/score/);
console.log("PASS C4 exact portable design/score parity, missing indicators, selected features, source/training clock, head/parameter integrity and coherent immutable score");
