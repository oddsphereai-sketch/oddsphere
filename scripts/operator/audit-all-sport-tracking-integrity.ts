/** SELECT-only ledger audit; original locks and results are never changed. */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { fetchAllPredictionRecords, dedupePredictionRecordsForTracking, effectiveTrackingPlayGrade, trackingDisplaySport, isTrackingRecordEligible, isTrackingPlayGradeCutEligible } from "../../lib/services/trackingAggregateService";
import { gradeStoredTrackingRecord } from "../../lib/services/predictionGradingService";
import type { PredictionGradeRow, PredictionRecordRow } from "../../lib/types/domain/Tracking";
loadEnvConfig(process.cwd());
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false},global:{fetch:(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(30_000)})}});
async function main(){
 const read=await fetchAllPredictionRecords(db,{});if(read.error)throw read.error;
 const records=dedupePredictionRecordsForTracking(read.rows);console.error('ledger rows',read.rows.length,'canonical',records.length);
 const gameIds=[...new Set(records.map(r=>r.game_id))],games=new Map<number,any>();
 for(let i=0;i<gameIds.length;i+=200){const r=await db.from('games').select('id,external_id,sport,slate_date,game_date,status,home_score,away_score,first_inning_runs').in('id',gameIds.slice(i,i+200));if(r.error)throw r.error;for(const g of r.data??[])games.set(g.id,g);}
 console.error('games',games.size);
 const grades=new Map<number,PredictionGradeRow>();
 const ids=records.map(r=>r.id!);for(let i=0;i<ids.length;i+=500){const r=await db.from('prediction_grades').select('*').in('prediction_record_id',ids.slice(i,i+500));if(r.error)throw r.error;for(const g of r.data??[])grades.set(g.prediction_record_id,g as PredictionGradeRow);}
 const summary:Record<string,any>={},issues:any[]=[];const now=Date.now();
 for(const r of records){const sport=trackingDisplaySport(r),s=summary[sport]??={records:0,locked:0,actionable:0,bestAngles:0,leans:0,actionableSettled:0,actionablePendingFuture:0,actionablePendingAfterStart:0,missingGradeFinal:0,resultMismatches:0,manualResultDifferences:0,lateLocks:0,oldest:null,latest:null,releases:{}};
 s.records++;s.locked+=r.locked_at?1:0;s.oldest=!s.oldest||r.slate_date<s.oldest?r.slate_date:s.oldest;s.latest=!s.latest||r.slate_date>s.latest?r.slate_date:s.latest;s.releases[r.model_version??'missing']=(s.releases[r.model_version??'missing']??0)+1;
 const grade=effectiveTrackingPlayGrade(r),actionable=['best_angle','lean'].includes(grade)&&isTrackingRecordEligible(r)&&isTrackingPlayGradeCutEligible(r);if(actionable){s.actionable++;if(grade==='best_angle')s.bestAngles++;else s.leans++;}
 const g=games.get(r.game_id),stored=grades.get(r.id!);if(!g){issues.push({kind:'missing_game',id:r.id,sport});continue;}
 if(r.locked_at&&Date.parse(r.locked_at)>Date.parse(r.game_date??"")){s.lateLocks++;if(actionable)issues.push({kind:'actionable_late_lock',sport,id:r.id,date:r.slate_date});}
 const recomputed=gradeStoredTrackingRecord(r,g);
 if(actionable){if(stored&&stored.result!=='pending')s.actionableSettled++;else if(Date.parse(r.game_date??"")>now)s.actionablePendingFuture++;else{s.actionablePendingAfterStart++;issues.push({kind:'actionable_unsettled',sport,id:r.id,game:r.external_id,date:r.slate_date,market:r.market,grade,status:g.status,stored:stored?.result??null,recomputed:recomputed.result});}}
 if(!stored&&recomputed.result!=='pending'&&r.locked_at){s.missingGradeFinal++;issues.push({kind:'missing_grade_terminal',sport,id:r.id,date:r.slate_date,market:r.market,grade,status:g.status,recomputed:recomputed.result});}
 if(stored&&stored.result!==recomputed.result&&r.locked_at){const manual=stored.grade_source!=='auto_score_ingest';if(manual)s.manualResultDifferences++;else s.resultMismatches++;issues.push({kind:manual?'manual_result_difference':'result_mismatch',sport,id:r.id,date:r.slate_date,market:r.market,grade,status:g.status,stored:stored.result,recomputed:recomputed.result,notes:stored.grade_notes,actionable});}
 }
 const proof={readOnly:true,checkedAt:new Date().toISOString(),rawRecords:read.rows.length,canonicalRecords:records.length,summary,issues};writeFileSync('/private/tmp/all-sport-tracking-ledger-20261108.json',JSON.stringify(proof,null,2));writeFileSync('/private/tmp/all-sport-tracking-ledger-raw-20261108.json',JSON.stringify({records,grades:[...grades.values()],games:[...games.values()]}));console.log(JSON.stringify({...proof,summary:Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,{...v,releases:Object.keys(v.releases).length}])),issues:issues.slice(0,35)},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
