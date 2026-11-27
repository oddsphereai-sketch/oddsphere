import { nbaPlayerStateHash } from "./nbaPlayerStateLedger";
import { NBA_ORIGINAL_TWO_WAY_IMPACT_RELEASE } from "./nbaOriginalPlayerImpact";
import type { NbaArchivedRotationGame,NbaArchivedRotationSnapshot } from "./nbaArchivedRotationLedger";
import { NBA_ARCHIVED_BASELINE_RECIPE,fitNbaFixedSixResidual,type NbaArchivedBaselineHead } from "./nbaArchivedImpactFit";
import { scoreNbaPortableModel,type NbaPortableFeatureRow } from "../../automodel/nba/nbaPortableScoreModel";
export const NBA_TWO_WAY_ROTATION_RELEASE="nba_two_way_rotation_2026_11_23_r1_separate_scoring_prevention" as const;
export const NBA_TWO_WAY_RESIDUAL_RELEASE="nba_two_way_residual_2026_11_23_r1_fixed_chronological" as const;
const time=(s:string)=>{const n=Date.parse(s);if(!Number.isFinite(n))throw Error("invalid_two_way_clock");return n;};
export function buildNbaTwoWayRotation(base:NbaArchivedRotationSnapshot,games:readonly NbaArchivedRotationGame[]){
 const {hash,...body}=base;if(hash!==nbaPlayerStateHash(body)||time(base.target.cutoff)!==time(base.target.startAt)-3600000||games.length>10000)throw Error("invalid_two_way_base");
 const cutoff=time(base.target.cutoff),prior=games.filter(g=>g.gameId!==base.target.gameId&&time(g.startAt)<cutoff&&time(g.sourceAvailableAt)<=cutoff&&g.season>=base.target.season-1&&g.season<=base.target.season).sort((a,b)=>time(a.startAt)-time(b.startAt)||a.gameId.localeCompare(b.gameId));
 const teams=base.teams.map(t=>{try{
  if(t.status!=="complete")throw Error("unknown_original_allocation");
  const ids=new Set([...t.players.filter(p=>p.baselineMinutes>0||p.expectedMinutes>0).map(p=>p.playerId),...t.referenceRotation.filter(p=>p.minutes>0).map(p=>p.playerId)]);
  const profiles=[...ids].sort((a,b)=>a-b).map(id=>{
   const appearances=prior.flatMap(g=>g.teams.flatMap(team=>team.players.filter(p=>p.playerId===id&&p.played&&p.seconds>0).map(p=>({game:g,team,player:p}))));
   const sample=[...appearances.filter(a=>a.game.season===base.target.season-1).slice(-10),...appearances.filter(a=>a.game.season===base.target.season).slice(-10)];
   let minutes=0,off=0,def=0;const observed:{gameId:string;season:number;startAt:string;sourceAvailableAt:string;minutes:number;offense:number;defense:number;sourceHashes:string[]}[]=[],unavailable:string[]=[];
   for(const a of sample){const impact=a.game.impact;if(!impact||impact.release!==NBA_ORIGINAL_TWO_WAY_IMPACT_RELEASE||time(impact.sourceAvailableAt)>cutoff){unavailable.push(a.game.gameId);continue;}
    const p=impact.players.find(p=>p.playerId===id);if(!p||p.issues.length||p.estimatedOffense==null||p.estimatedDefense==null||![p.estimatedOffense,p.estimatedDefense].every(Number.isFinite)){unavailable.push(a.game.gameId);continue;}
    if(impact.sources.some(s=>time(s.sourceAvailableAt)>cutoff||time(s.fetchedAt)<time(s.sourceAvailableAt)||!/^[a-f0-9]{64}$/.test(s.sha256)))throw Error("invalid_two_way_source_receipt");
    const m=a.player.seconds/60*14400/a.team.players.reduce((n,p)=>n+p.seconds,0);minutes+=m;off+=m*p.estimatedOffense;def+=m*p.estimatedDefense;
    observed.push({gameId:a.game.gameId,season:a.game.season,startAt:a.game.startAt,sourceAvailableAt:impact.sourceAvailableAt,minutes:m,offense:p.estimatedOffense,defense:p.estimatedDefense,sourceHashes:impact.sources.map(s=>s.sha256)});
   }
   if(minutes<=0)throw Error("no_original_two_way_profile");
   const expected=t.players.find(p=>p.playerId===id)?.expectedMinutes??0,reference=t.referenceRotation.find(p=>p.playerId===id)?.minutes??0;
   return{playerId:id,expectedMinutes:expected,referenceMinutes:reference,offense:off/minutes,defense:def/minutes,observed,unavailableGameIds:unavailable,windowAppearances:sample.length};
  });
  const offenseShock=profiles.reduce((n,p)=>n+(p.expectedMinutes-p.referenceMinutes)*p.offense/240,0),defenseShock=profiles.reduce((n,p)=>n+(p.expectedMinutes-p.referenceMinutes)*p.defense/240,0);
  return{teamId:t.teamId,status:"complete" as const,reason:null,offenseShock,defenseShock,overlapLoss:t.overlapLoss!,verifiedChange:!!t.rosterChange||t.outMinuteShare!>0,profiles};
 }catch(e){return{teamId:t.teamId,status:"unknown" as const,reason:e instanceof Error?e.message:String(e),offenseShock:null,defenseShock:null,overlapLoss:null,verifiedChange:false,profiles:[]};}});
 const [h,a]=teams,features=h?.status==="complete"&&a?.status==="complete"?[h.offenseShock!-a.offenseShock!,h.offenseShock!+a.offenseShock!,h.defenseShock!-a.defenseShock!,h.defenseShock!+a.defenseShock!,h.overlapLoss!-a.overlapLoss!,h.overlapLoss!+a.overlapLoss!]:null;
 const core={release:NBA_TWO_WAY_ROTATION_RELEASE,baseSnapshotHash:base.hash,target:base.target,status:features?"complete" as const:"unknown" as const,teams,features};return{...core,hash:nbaPlayerStateHash(core)};
}
export type NbaTwoWayRotationSnapshot=ReturnType<typeof buildNbaTwoWayRotation>;
export const NBA_TWO_WAY_SCHEMA_HASH=nbaPlayerStateHash({release:NBA_TWO_WAY_ROTATION_RELEASE,sourceRelease:NBA_ORIGINAL_TWO_WAY_IMPACT_RELEASE,features:["offense_difference","offense_sum","defense_difference","defense_sum","overlap_difference","overlap_sum"],currentAppearances:10,priorAppearances:10,allocation:"exact_frozen_R7",alpha:1000,intercept:0,ledgerHashMode:"ordered_verified_snapshot_hashes"});
export function qualifyNbaTwoWayRotation(rows:readonly NbaTwoWayRotationSnapshot[],proof?:{ledgerHash:string;schemaHash:string;baseLedgerHash:string;sourcesVerified:boolean;mutationCases:number;mutationSuiteSha256:string}){
 if(rows.length>10000)throw Error("two_way_ledger_budget");
 const issues:string[]=[],ids=new Set<string>();let selectionComplete=0,selectionChanges=0;const ledgerHash=nbaPlayerStateHash(rows.map(r=>r.hash).sort());
 for(const r of rows){const {hash,...core}=r;if(hash!==nbaPlayerStateHash(core)||r.release!==NBA_TWO_WAY_ROTATION_RELEASE||time(r.target.cutoff)!==time(r.target.startAt)-3600000||!/^[a-f0-9]{64}$/.test(r.baseSnapshotHash))issues.push("invalid_two_way_snapshot");if(ids.has(r.target.gameId))issues.push("duplicate_two_way_game");ids.add(r.target.gameId);
  if(r.status==="complete"){
   if(r.teams.length!==2||!r.features||r.features.length!==6||!r.features.every(Number.isFinite))issues.push("invalid_two_way_features");
   for(const t of r.teams){if(t.status!=="complete"||Math.abs(t.profiles.reduce((n,p)=>n+p.expectedMinutes,0)-240)>1e-7||Math.abs(t.profiles.reduce((n,p)=>n+p.referenceMinutes,0)-240)>1e-7||new Set(t.profiles.map(p=>p.playerId)).size!==t.profiles.length)issues.push("invalid_two_way_rotation");
    for(const p of t.profiles){if(![p.offense,p.defense,p.expectedMinutes,p.referenceMinutes].every(Number.isFinite)||p.expectedMinutes<0||p.expectedMinutes>48||p.referenceMinutes<0||p.referenceMinutes>48||!p.observed.length||p.observed.length+p.unavailableGameIds.length!==p.windowAppearances||p.observed.some(o=>!Number.isFinite(o.minutes)||o.minutes<=0||o.gameId===r.target.gameId||time(o.startAt)>=time(r.target.cutoff)||time(o.sourceAvailableAt)>time(r.target.cutoff)||o.season<r.target.season-1||o.season>r.target.season||![o.offense,o.defense].every(Number.isFinite)||o.sourceHashes.length!==2||o.sourceHashes.some(s=>!/^[a-f0-9]{64}$/.test(s))))issues.push("invalid_two_way_profile");
     const m=p.observed.reduce((n,o)=>n+o.minutes,0);if(Math.abs(p.observed.reduce((n,o)=>n+o.minutes*o.offense,0)/m-p.offense)>1e-9||Math.abs(p.observed.reduce((n,o)=>n+o.minutes*o.defense,0)/m-p.defense)>1e-9)issues.push("two_way_profile_replay");}
    if(Math.abs(t.profiles.reduce((n,p)=>n+(p.expectedMinutes-p.referenceMinutes)*p.offense/240,0)-t.offenseShock!)>1e-9||Math.abs(t.profiles.reduce((n,p)=>n+(p.expectedMinutes-p.referenceMinutes)*p.defense/240,0)-t.defenseShock!)>1e-9)issues.push("two_way_shock_replay");}
   const [h,a]=r.teams;if(h&&a){const f=[h.offenseShock!-a.offenseShock!,h.offenseShock!+a.offenseShock!,h.defenseShock!-a.defenseShock!,h.defenseShock!+a.defenseShock!,h.overlapLoss!-a.overlapLoss!,h.overlapLoss!+a.overlapLoss!];if(!r.features||f.some((x,i)=>Math.abs(x-r.features![i]!)>1e-9))issues.push("two_way_feature_replay");}
   if([2023,2024].includes(r.target.season)){selectionComplete++;if(r.teams.some(t=>t.verifiedChange))selectionChanges++;}
  }else if(r.features!==null)issues.push("unknown_two_way_features");
 }
 if(selectionComplete<1000)issues.push("two_way_selection_below_1000");if(selectionChanges<300)issues.push("two_way_changes_below_300");
 if(!proof||proof.ledgerHash!==ledgerHash||proof.schemaHash!==NBA_TWO_WAY_SCHEMA_HASH||!/^[a-f0-9]{64}$/.test(proof.baseLedgerHash)||!proof.sourcesVerified||proof.mutationCases<50||!/^[a-f0-9]{64}$/.test(proof.mutationSuiteSha256))issues.push("two_way_frozen_proof_missing");
 return{release:NBA_TWO_WAY_ROTATION_RELEASE,ledgerHash,schemaHash:NBA_TWO_WAY_SCHEMA_HASH,selectionComplete,selectionChanges,issues:[...new Set(issues)],mayFit:issues.length===0};
}
type Proof=NonNullable<Parameters<typeof qualifyNbaTwoWayRotation>[1]>;
type Training={snapshotHash:string;features:NbaPortableFeatureRow;actualMargin:number;actualTotal:number;finalAvailableAt:string};
export function fitNbaTwoWayResidual(args:{snapshots:readonly NbaTwoWayRotationSnapshot[];proof:Proof;baseline:NbaArchivedBaselineHead;training:readonly Training[]}){
 const q=qualifyNbaTwoWayRotation(args.snapshots,args.proof);if(!q.mayFit)throw Error("two_way_data_gate_closed:"+q.issues.join(","));
 const {hash,...body}=args.baseline;if(hash!==nbaPlayerStateHash(body)||args.baseline.recipe!==NBA_ARCHIVED_BASELINE_RECIPE)throw Error("invalid_two_way_baseline");
 const byHash=new Map(args.snapshots.map(s=>[s.hash,s])),ids=new Set<string>(),x:number[][]=[],m:number[]=[],t:number[]=[];let end=-Infinity;
 const training=[...args.training].sort((a,b)=>a.snapshotHash.localeCompare(b.snapshotHash));
 for(const row of training){const s=byHash.get(row.snapshotHash);if(!s||s.status!=="complete"||!s.features||s.target.season!==2022||ids.has(s.target.gameId)||time(args.baseline.trainingEnd)>=time(s.target.cutoff)||time(row.finalAvailableAt)<=time(s.target.startAt)||![row.actualMargin,row.actualTotal].every(Number.isFinite)||row.actualTotal<=0)throw Error("invalid_two_way_training");ids.add(s.target.gameId);end=Math.max(end,time(row.finalAvailableAt));const p=scoreNbaPortableModel(args.baseline.artifact,row.features);x.push(s.features);m.push(row.actualMargin-p.marginHome);t.push(row.actualTotal-p.total);}
 if(args.snapshots.some(s=>[2023,2024].includes(s.target.season)&&time(s.target.cutoff)<=end))throw Error("two_way_training_crosses_selection");
 const coefficients=fitNbaFixedSixResidual(x,m,t),core={release:NBA_TWO_WAY_RESIDUAL_RELEASE,alpha:1000,intercept:0,baselineRecipe:args.baseline.recipe,baselineTrainingHash:hash,ledgerHash:q.ledgerHash,trainingHash:nbaPlayerStateHash(training),trainingRows:x.length,trainingEnd:new Date(end).toISOString(),...coefficients};return{...core,hash:nbaPlayerStateHash(core)};
}
export function applyNbaTwoWayResidual(head:ReturnType<typeof fitNbaTwoWayResidual>,snapshot:NbaTwoWayRotationSnapshot,baseline:NbaArchivedBaselineHead,features:NbaPortableFeatureRow){
 const {hash,...body}=head,{hash:sh,...sc}=snapshot,{hash:bh,...bc}=baseline;
 if(hash!==nbaPlayerStateHash(body)||sh!==nbaPlayerStateHash(sc)||bh!==nbaPlayerStateHash(bc)||head.release!==NBA_TWO_WAY_RESIDUAL_RELEASE||head.alpha!==1000||head.intercept!==0||head.baselineRecipe!==baseline.recipe||snapshot.status!=="complete"||snapshot.features?.length!==6||!snapshot.features.every(Number.isFinite)||time(snapshot.target.cutoff)<=Math.max(time(head.trainingEnd),time(baseline.trainingEnd)))throw Error("invalid_two_way_application");
 const p=scoreNbaPortableModel(baseline.artifact,features),marginCorrection=snapshot.features.reduce((n,v,i)=>n+v*head.margin[i]!,0),totalCorrection=snapshot.features.reduce((n,v,i)=>n+v*head.total[i]!,0),margin=p.marginHome+marginCorrection,total=p.total+totalCorrection;if(![margin,total].every(Number.isFinite)||total<=0)throw Error("invalid_two_way_score");return{marginCorrection,totalCorrection,margin,total,homeScore:(total+margin)/2,awayScore:(total-margin)/2};
}
