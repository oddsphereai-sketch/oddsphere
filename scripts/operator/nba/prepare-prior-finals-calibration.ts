/** Offline export only: verifies original archives and frozen earlier-fit baselines. */
import fs from "node:fs";import path from "node:path";import{gunzipSync,gzipSync,createGunzip}from"node:zlib";import{createInterface}from"node:readline";import{createHash}from"node:crypto";
import{scoreNbaPortableModel}from"../../../lib/automodel/nba/nbaPortableScoreModel";
import{verifyNbaOriginalTeamGame,NBA_ORIGINAL_TEAM_FEATURE_SOURCE_RELEASE}from"../../../lib/research/nba/nbaOriginalTeamFeatures";
import{nbaPlayerStateHash}from"../../../lib/research/nba/nbaPlayerStateLedger";
async function main() {
const[archive,featurePath,baselinePath,destination]=process.argv.slice(2);if(!archive||!featurePath||!baselinePath||!destination||fs.existsSync(destination))throw Error("usage: prepare-prior-finals-calibration ARCHIVE FEATURES FROZEN_BASELINES NEW_OUTPUT.json.gz");
const read=(p:string)=>JSON.parse(gunzipSync(fs.readFileSync(p),{maxOutputLength:128_000_000}).toString());
const frozen=read(baselinePath),a1=frozen.baselineA1,a2=frozen.baselineA2;
for(const b of[a1,a2]){const{hash,...core}=b;if(hash!==nbaPlayerStateHash(core))throw Error("frozen_baseline_hash_mismatch");}
if(a1.recipe!==a2.recipe||a1.artifact.design.features.join("|")!==a2.artifact.design.features.join("|"))throw Error("baseline_recipe_mismatch");
const originalHash=createHash("sha256");for await(const chunk of fs.createReadStream(path.join(archive,"original-team-features-r1.json.gz"))) originalHash.update(chunk);const originalFeaturesSha256=originalHash.digest("hex");
let header:{originalFeaturesSha256:string}|null=null,footer:number|null=null;const rows=[],parity=new Map<string,{gameId:string;baselineMargin:number;baselineTotal:number}>((frozen.evaluations??[]).map((r:{gameId:string;baselineMargin:number;baselineTotal:number})=>[r.gameId,r]));let matched=0;
for await(const line of createInterface({input:fs.createReadStream(featurePath).pipe(createGunzip()),crlfDelay:Infinity})){const f=JSON.parse(line);if(header===null){header=f;if(f.contract!=="nba_prior_feature_subset_jsonl_r1"||f.originalFeaturesSha256!==originalFeaturesSha256||f.baselineReportSha256!==createHash("sha256").update(fs.readFileSync(baselinePath)).digest("hex"))throw Error("invalid_compact_source_header");continue;}if(f.endCount!==undefined){footer=f.endCount;continue;}if(footer!==null||rows.length>=10000||f.season<2022||f.season>2025)throw Error("invalid_compact_source_scope");const gameId=String(f.game_id).padStart(10,"0"),receipt=f.originalFinal;if(!receipt||receipt.gameId!==f.game_id)throw Error("missing_original_final_receipt");
 const stem=path.join(archive,"native",gameId+"-boxscore"),verified=verifyNbaOriginalTeamGame({gameId,season:f.season,bytes:gunzipSync(fs.readFileSync(stem+".json.gz")),receipt:JSON.parse(fs.readFileSync(stem+".receipt.json","utf8"))});
 if(verified.receipt.sha256!==receipt.receipt.sha256||verified.sourceAvailableAt!==receipt.sourceAvailableAt||Date.parse(f.feature_cutoff)!==Date.parse(verified.game.startTime)-3600000||f.target_home_score!==verified.game.homeScore||f.target_away_score!==verified.game.awayScore)throw Error("original_feature_final_or_clock_mismatch");
 const b=f.season===2022?a1:a2;if(Date.parse(b.trainingEnd)>=Date.parse(f.feature_cutoff))throw Error("in_sample_baseline");const score=scoreNbaPortableModel(b.artifact,f),expected=parity.get(gameId);
 if(expected){if(Math.abs(expected.baselineMargin-score.marginHome)>1e-10||Math.abs(expected.baselineTotal-score.total)>1e-10)throw Error("changed_frozen_score_recipe");matched++;}
 rows.push({gameId,season:f.season,startAt:verified.game.startTime,cutoff:f.feature_cutoff,finalAvailableAt:receipt.sourceAvailableAt,sourceSha256:verified.receipt.sha256,sourceRecipe:NBA_ORIGINAL_TEAM_FEATURE_SOURCE_RELEASE,baselineHash:b.hash,baselineRecipe:b.recipe,baselineTrainingEnd:b.trainingEnd,baselineMargin:score.marginHome,baselineTotal:score.total,homeScore:verified.game.homeScore,awayScore:verified.game.awayScore});
}
if(!header||footer!==rows.length||new Set(rows.map(r=>r.gameId)).size!==rows.length)throw Error("incomplete_compact_source");
const firstSelection=rows.filter(r=>r.season===2023).map(r=>r.cutoff).sort()[0]!;const train=rows.filter(r=>r.season===2022&&Date.parse(r.finalAvailableAt)<Date.parse(firstSelection));
if(train.length<1000||matched<1000)throw Error("prior_calibration_source_gate_closed");
const out={createdAt:new Date().toISOString(),contract:"original_source_prior_finals_calibration_inputs_r1",sourceRecipe:NBA_ORIGINAL_TEAM_FEATURE_SOURCE_RELEASE,baselineRecipe:a1.recipe,inputHashes:{originalFeatures:header.originalFeaturesSha256,compactFeatures:createHash("sha256").update(fs.readFileSync(featurePath)).digest("hex"),baselines:createHash("sha256").update(fs.readFileSync(baselinePath)).digest("hex")},trainingBaselineHash:a1.hash,evaluationBaselineHash:a2.hash,trainingHash:nbaPlayerStateHash(train),trainingEnd:train.map(r=>r.finalAvailableAt).sort().at(-1),firstSelection,verifiedOriginalSourceRows:rows.length,frozenScoreParityRows:matched,trainingRows:train.length,rows,productionWrites:0,providerRequests:0};
fs.writeFileSync(destination,gzipSync(JSON.stringify(out)),{flag:"wx",mode:0o600});console.log(JSON.stringify({...out,rows:undefined}));

}
main().catch(error => { console.error(error); process.exitCode = 1; });
