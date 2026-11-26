/** Private early comparison only. Never writes a database/member/grade record. */
import fs from "node:fs";
import path from "node:path";
import {gunzipSync,gzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {verifyNbaOriginalRoster,type verifyNbaOriginalTwoWayImpact} from "../../../lib/research/nba/nbaOriginalPlayerImpact";
import {verifyNbaOriginalTeamGame} from "../../../lib/research/nba/nbaOriginalTeamFeatures";
import {buildNbaOriginalForwardFeatures} from "../../../lib/services/nba/nbaPointInTimeFeatures";
import {buildNbaTwoWayRotation,applyNbaTwoWayResidual} from "../../../lib/research/nba/nbaTwoWayRotation";
import {NBA_ARCHIVED_BASELINE_RECIPE} from "../../../lib/research/nba/nbaArchivedImpactFit";
import {nbaPlayerStateHash} from "../../../lib/research/nba/nbaPlayerStateLedger";
import {scoreNbaPortableModel} from "../../../lib/automodel/nba/nbaPortableScoreModel";
import type {NbaArchivedRotationGame,NbaArchivedRotationSnapshot} from "../../../lib/research/nba/nbaArchivedRotationLedger";
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex"),read=(p:string)=>JSON.parse(gunzipSync(fs.readFileSync(p)).toString());
async function main(){
 const[root,heldReportPath,artifactPath,destination]=process.argv.slice(2);if(!root||!heldReportPath||!artifactPath||!destination||fs.existsSync(destination))throw Error("usage: freeze-forward-player-impact FORWARD_ARCHIVE HELD_TWO_WAY_REPORT CURRENT_ARTIFACT NEW_FREEZE.json.gz");
 const capturedAt=new Date().toISOString(),targetsFile=JSON.parse(fs.readFileSync(path.join(root,"targets.json"),"utf8")),targets=targetsFile.targets as {gameId:string;season:number;startAt:string;teams:{teamId:number;abbreviation:string}[]}[];
 const records=read(path.join(root,"current-records-early-freeze.json.gz")),base=read(path.join(root,"forward-rotation-r7.json.gz")) as {rows:NbaArchivedRotationSnapshot[]};
 if(targets.length!==10||records.rows.length!==30||Date.parse(records.capturedAt)>Date.parse(capturedAt)||targets.some(t=>Date.parse(t.startAt)-3600000<=Date.parse(capturedAt)))throw Error("invalid_early_forward_scope");
 const corpus=path.join(root,"corpus"),manifest=JSON.parse(fs.readFileSync(path.join(corpus,"native-job-manifest.json"),"utf8")) as {games:{id:string;season:number}[]};
 const impacts=new Map<string,ReturnType<typeof verifyNbaOriginalTwoWayImpact>>();for(const line of gunzipSync(fs.readFileSync(path.join(root,"all-two-way-r1.jsonl.gz"))).toString().trim().split("\n")){const p=JSON.parse(line);if(p.players?.length)impacts.set(p.gameId,p);}
 const games:NbaArchivedRotationGame[]=[],teamSources=[];const unavailable:Record<string,number>={};
 for(const job of manifest.games){try{const stem=path.join(corpus,"native",job.id+"-boxscore"),bytes=gunzipSync(fs.readFileSync(stem+".json.gz")),receipt=JSON.parse(fs.readFileSync(stem+".receipt.json","utf8")),roster=verifyNbaOriginalRoster({gameId:job.id,bytes,receipt});games.push({...roster,season:job.season,impact:impacts.get(job.id)??null});teamSources.push(verifyNbaOriginalTeamGame({gameId:job.id,season:job.season,bytes,receipt}));}catch(e){const reason=e instanceof Error?e.message:String(e);unavailable[reason]=(unavailable[reason]??0)+1;}}
 const upcomingGames=targets.map(t=>({gameId:Number(t.gameId),season:t.season,startTime:t.startAt,homeTeamId:t.teams[0]!.teamId,awayTeamId:t.teams[1]!.teamId,homeTeam:t.teams[0]!.abbreviation,awayTeam:t.teams[1]!.abbreviation}));
 const features=buildNbaOriginalForwardFeatures({games:teamSources.map(s=>s.game),boxes:teamSources.flatMap(s=>s.boxes),upcomingGames,emitGameIds:new Set(upcomingGames.map(g=>g.gameId)),finalAvailableAt:new Map(teamSources.map(s=>[s.game.gameId,s.sourceAvailableAt])),capturedAt});
 const held=read(heldReportPath),artifact=JSON.parse(fs.readFileSync(artifactPath,"utf8"));
 // Conservative completion bound: artifact already existed at this actual
 // repository commit. This is not an invented exact end of model training.
 const wrapper={recipe:NBA_ARCHIVED_BASELINE_RECIPE,artifact,trainingRows:artifact.trainingRows,trainingEnd:"2026-10-20T16:26:50.000Z",trainingHash:nbaPlayerStateHash(artifact)};
 const baseline={...wrapper,hash:nbaPlayerStateHash(wrapper)},rows=[];
 const health=JSON.parse(fs.readFileSync(path.join(root,"../live-nba-20261123-health-r2.json"),"utf8"));
 for(const t of targets){const b=base.rows.find(r=>r.target.gameId===t.gameId),f=features.find(r=>Number(r.game_id)===Number(t.gameId));if(!b||!f)throw Error("missing_current_native_forecast_input");const modelFeatures=Object.fromEntries((artifact.design.features as string[]).map(k=>[k,typeof f[k]==="number"?f[k]:null])) as Record<string,number|null>;
  const snapshot=buildNbaTwoWayRotation(b,games),portable=scoreNbaPortableModel(artifact,modelFeatures),candidate=snapshot.status==="complete"?applyNbaTwoWayResidual(held.head,snapshot,baseline,modelFeatures):null;
  const canon=(s:string)=>({NO:"NOP",SA:"SAS",UTAH:"UTA"}[s]??s);
  // Exact database ID from the schedule-corroborated live census; no fuzzy names.
  const game=health.games.find((g:{game:{game_date:string;home_team:{abbreviation:string};away_team:{abbreviation:string}}})=>g.game.game_date.slice(0,19)===t.startAt.slice(0,19)&&canon(g.game.home_team.abbreviation)===t.teams[0]!.abbreviation&&canon(g.game.away_team.abbreviation)===t.teams[1]!.abbreviation);
  if(!game)throw Error("missing_exact_live_fixture");const live=records.rows.filter((r:{game_id:number})=>r.game_id===game.game.id);if(live.length!==3)throw Error("missing_frozen_live_market");
  rows.push({nativeGameId:t.gameId,siteGameId:game.game.id,event:`${t.teams[1]!.abbreviation}@${t.teams[0]!.abbreviation}`,startAt:t.startAt,status:snapshot.status,sourceSnapshot:snapshot,featureInput:f,portable,candidate,incumbentRecordIds:live.map((r:{id:number})=>r.id),incumbentProjection:live.map((r:{market:string;snapshot_json:Record<string,unknown>})=>({market:r.market,home:r.snapshot_json.predicted_home_score,away:r.snapshot_json.predicted_away_score,total:r.snapshot_json.predicted_total,spreadHome:r.snapshot_json.predicted_spread_home}))});
 }
 const inputFiles=[heldReportPath,artifactPath,path.join(root,"targets.json"),path.join(root,"forward-rotation-r7.json.gz"),path.join(root,"current-records-early-freeze.json.gz"),path.join(root,"all-two-way-r1.jsonl.gz")],core={capturedAt,generatedAt:new Date().toISOString(),contract:"early_forecast_not_T60_lock",heldHeadHash:held.head.hash,headFailedHistoricalPromotionGate:true,baselineArtifactAvailableBy:{commit:"b20183c009dca9f1e821b05440198fadeb36c7c7",at:wrapper.trainingEnd,meaning:"conservative training-completed upper bound; artifact release unchanged"},inputHashes:Object.fromEntries(inputFiles.map(p=>[p,sha(fs.readFileSync(p))])),unavailable,rows,productionWrites:0,providerRequests:0,gradeChanges:0,modelPromotionEligible:false};
 fs.writeFileSync(destination,gzipSync(JSON.stringify({...core,hash:nbaPlayerStateHash(core)})),{flag:"wx",mode:0o600});console.log(JSON.stringify({capturedAt,generatedAt:core.generatedAt,games:rows.length,candidateComplete:rows.filter(r=>r.candidate).length,unknown:rows.filter(r=>!r.candidate).map(r=>({event:r.event,reasons:r.sourceSnapshot.teams.filter(t=>t.reason).map(t=>t.reason)})),headFailedHistoricalPromotionGate:true,productionWrites:0,gradeChanges:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
