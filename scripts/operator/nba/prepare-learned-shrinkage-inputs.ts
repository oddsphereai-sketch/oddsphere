/** Native original-only C4 source export. No fitting, provider or DB. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createGunzip, gunzipSync, gzipSync } from "node:zlib";
import { createInterface } from "node:readline";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { verifyNbaOriginalTeamGame, NBA_ORIGINAL_TEAM_FEATURE_SOURCE_RELEASE } from "../../../lib/research/nba/nbaOriginalTeamFeatures";
import type { ArchivedBaselineRow } from "../../../lib/research/nba/nbaArchivedImpactFit";
async function main(){
 const [archive,compact,baselinePath,output]=process.argv.slice(2);
 if(!archive||!compact||!baselinePath||!output||fs.existsSync(output))throw Error("usage: prepare-learned-shrinkage-inputs ARCHIVE COMPACT BASELINE NEW_OUTPUT");
 const baseline=JSON.parse(gunzipSync(fs.readFileSync(baselinePath)).toString()).baselineA2;
 const {hash,...core}=baseline;if(hash!==nbaPlayerStateHash(core)||baseline.artifact.model.alpha!==1000)throw Error("changed_frozen_baseline");
 const sourceHash=createHash("sha256");for await(const chunk of fs.createReadStream(path.join(archive,"original-team-features-r1.json.gz")))sourceHash.update(chunk);
 const originalSha=sourceHash.digest("hex"),baselineSha=createHash("sha256").update(fs.readFileSync(baselinePath)).digest("hex");
 let header=false,footer:number|null=null;
 const rows:(ArchivedBaselineRow & {startAt:string;sourceSha256:string})[]=[];
 for await(const line of createInterface({input:fs.createReadStream(compact).pipe(createGunzip()),crlfDelay:Infinity})){
  const f=JSON.parse(line);
  if(!header){if(f.contract!=="nba_prior_feature_subset_jsonl_r1"||f.originalFeaturesSha256!==originalSha||f.baselineReportSha256!==baselineSha)throw Error("source_header_mismatch");header=true;continue;}
  if(f.endCount!==undefined){if(footer!==null)throw Error("duplicate_footer");footer=f.endCount;continue;}
  if(footer!==null||rows.length>=10000||!Number.isInteger(f.season)||f.season<2021||f.season>2025)throw Error("source_scope_or_budget");
  const gameId=String(f.game_id).padStart(10,"0"),stem=path.join(archive,"native",gameId+"-boxscore");
  const v=verifyNbaOriginalTeamGame({gameId,season:f.season,bytes:gunzipSync(fs.readFileSync(stem+".json.gz")),receipt:JSON.parse(fs.readFileSync(stem+".receipt.json","utf8"))});
  if(v.receipt.sha256!==f.originalFinal.receipt.sha256||v.sourceAvailableAt!==f.originalFinal.sourceAvailableAt||Date.parse(f.feature_cutoff)!==Date.parse(v.game.startTime)-3600000||f.target_home_score!==v.game.homeScore||f.target_away_score!==v.game.awayScore||f.target_home_margin!==v.game.homeScore-v.game.awayScore||f.target_total!==v.game.homeScore+v.game.awayScore)throw Error("original_source_score_or_clock_mismatch");
  rows.push({gameId,season:f.season,startAt:v.game.startTime,cutoff:f.feature_cutoff,finalAvailableAt:v.sourceAvailableAt,sourceSha256:v.receipt.sha256,
   features:Object.fromEntries((baseline.artifact.design.features as string[]).map(k=>[k,typeof f[k]==="number"?f[k]:null])),actualMargin:f.target_home_margin,actualTotal:f.target_total});
 }
 if(!header||footer!==rows.length||new Set(rows.map(r=>r.gameId)).size!==rows.length)throw Error("incomplete_source");
 rows.sort((a,b)=>a.gameId.localeCompare(b.gameId));
 const firstEvaluation=rows.filter(r=>r.season===2023).map(r=>r.cutoff).sort()[0];
 const train=rows.filter(r=>r.season<=2022&&Date.parse(r.finalAvailableAt)<Date.parse(firstEvaluation));
 const trainingHash=nbaPlayerStateHash(train.map(({gameId,season,cutoff,finalAvailableAt,features,actualMargin,actualTotal})=>({gameId,season,cutoff,finalAvailableAt,features,actualMargin,actualTotal})));
 if(trainingHash!==baseline.trainingHash||train.length!==baseline.trainingRows||baseline.trainingEnd>=firstEvaluation)throw Error("changed_training_corpus");
 const result={createdAt:new Date().toISOString(),contract:"nba_learned_shrinkage_inputs_r1",sourceRecipe:NBA_ORIGINAL_TEAM_FEATURE_SOURCE_RELEASE,originalFeaturesSha256:originalSha,compactSha256:createHash("sha256").update(fs.readFileSync(compact)).digest("hex"),baseline,firstEvaluation,trainingHash,trainingRows:train.length,rows,productionWrites:0,providerRequests:0,fittingPerformed:false};
 fs.writeFileSync(output,gzipSync(JSON.stringify(result)),{flag:"wx",mode:0o600});console.log(JSON.stringify({...result,baseline:undefined,rows:undefined,verifiedRows:rows.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
