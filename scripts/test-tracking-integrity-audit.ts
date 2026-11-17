import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PredictionRecordRow, PredictionGradeRow } from "../lib/types/domain/Tracking";
import { readFrozenFirstInningTrackingAuthority, fetchGradesForRecordIds, effectiveTrackingPlayGrade, isTrackingPlayGradeCutEligible } from "../lib/services/trackingAggregateService";
import { runTrackingIntegrityAudit, compareTrackingLockExpectations, inspectTrackingSettlements, inspectCbbLockedMarketCoverage, trackingManifestInSlateWindow, type TrackingLockExpectation } from "../lib/services/audit/trackingIntegrityAudit";
import { dedupePredictionRecordsForTracking } from "../lib/services/trackingAggregateService";
import { excludeSupersededCfbWinnerRecords, preferAppendOnlyWinnerTrackingCorrections } from "../lib/services/tracking/winnerAccuracyScorecardQuery";
import { CFB_APPROVED_TRACKING_CORRECTIONS, CFB_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION as CM, CFB_PUBLISHED_TRACKING_CORRECTION_RELEASE as CR, cfbTrackingCorrectionSupersededRecordId, buildApprovedCfbTrackingCorrection, writeApprovedCfbTrackingCorrections } from "../lib/services/football/cfbPublishedTrackingCorrection";
import { gradeStoredTrackingRecord } from "../lib/services/predictionGradingService";

async function main() {
 const legacy = { id: 1, game_id: 10, external_id: 100, sport: "mlb", market: "first_inning", game_date: "2026-07-10T20:00:00Z", slate_date: "2026-07-10", locked_at: "2026-07-10T19:00:00Z", pick: "Toss-Up", side: null, play_grade: "held", member_facing_grade: "best_angle", no_bet: true, held: true, prediction_type: "toss_up" } as unknown as PredictionRecordRow;
 const frozen = { sport: "mlb", market: "first_inning", pick: "NRFI", side: "under", grade: "best_angle", play_grade: "best_angle", best_angle: true, no_bet: false, confidence: 60, line_value: .5, odds_american: -117 };
 const before = structuredClone(legacy), beforeFrozen = structuredClone(frozen);
 let writes = 0;
 const client = { from(table: string) { assert.equal(table, "prediction_records"); const q = {
   select(fields: string) { assert.equal(fields, "id,frozen:snapshot_json->member_facing_at_lock"); return q; },
   in() { return Promise.resolve({ data: [{ id: 1, frozen }], error: null }); },
   insert() { writes++; }, update() { writes++; }, upsert() { writes++; },
 }; return q; } } as unknown as SupabaseClient;
 const [restored] = await readFrozenFirstInningTrackingAuthority(client, [legacy]);
 assert.equal(restored.pick, "NRFI"); assert.equal(restored.side, "under"); assert.equal(restored.odds_american, -117);
 assert.equal(restored.confidence, 60); assert.equal(restored.no_bet, false); assert.equal(restored.held, false);
 assert.equal(effectiveTrackingPlayGrade(restored), "best_angle"); assert.equal(isTrackingPlayGradeCutEligible(restored), true);
 assert.deepEqual(legacy, before); assert.deepEqual(frozen, beforeFrozen); assert.equal(writes, 0);
 const outcome = { status: "final", game_date: legacy.game_date, home_score: 2, away_score: 1, first_inning_runs: 0 };
 assert.equal(gradeStoredTrackingRecord(restored, outcome).result, "win");
 const failed = { from() { const q = { select() { return q; }, in() { return Promise.resolve({ data: null, error: { message: "database unavailable" } }); } }; return q; } } as unknown as SupabaseClient;
 await assert.rejects(readFrozenFirstInningTrackingAuthority(failed, [legacy]), /frozen FI read failed/);
 await assert.rejects(fetchGradesForRecordIds(failed, [1]), /tracking grades read failed/);
 let gradeCalls = 0;
 const gradeClient = { from() { const q = { select() { return q; }, in(_key: string, ids: number[]) { gradeCalls++; assert(ids.length <= 500); return Promise.resolve({ data: ids.map(prediction_record_id => ({ prediction_record_id, result: "win" })), error: null }); } }; return q; } } as unknown as SupabaseClient;
 assert.equal((await fetchGradesForRecordIds(gradeClient, Array.from({ length: 1_203 }, (_, i) => i + 1))).length, 1_203); assert.equal(gradeCalls, 3);
 const lock: TrackingLockExpectation = { sport: "mlb", externalId: 100, market: "first_inning", grade: "best_angle", lockedAt: legacy.locked_at!, startsAt: legacy.game_date!, source: "original-public-lock" };
 assert.equal(compareTrackingLockExpectations([], [lock])[0].kind, "published_lock_missing_tracking");
 assert.equal(compareTrackingLockExpectations([restored], [lock]).length, 0);
 assert.equal(compareTrackingLockExpectations([{ ...restored, locked_at: null }], [lock])[0].severity, "error");
 for (const sport of ["mlb", "nba", "wnba", "nhl", "nfl", "cfb", "cbb", "soccer"]) assert.equal(compareTrackingLockExpectations([], [{ ...lock, sport }]).length, 1);
 const coverage={externalId:100,source:"saved-lock",rows:[{market:"moneyline",grade:"No Play",price:-800},{market:"spread",grade:"Watchlist",price:-110},{market:"total",grade:"Held",reason:"execution_pair_not_current_unambiguous_interpreted_quote"}]};
 const coverageBytes=JSON.stringify(coverage);
 assert.equal(inspectCbbLockedMarketCoverage([],coverage).filter(f=>f.kind==="cbb_priced_market_missing_tracking").length,2,"Nonactionable priced markets still require tracking");
 assert.equal(inspectCbbLockedMarketCoverage([],coverage).filter(f=>f.kind==="cbb_locked_market_unpriced").length,1,"A quote failure cannot disappear into a healthy accuracy-only record");
 const healthy=coverage.rows.slice(0,2),coverageRecords=healthy.map((r,i)=>({...restored,id:i+1,sport:"cbb" as const,market:r.market as PredictionRecordRow["market"],external_id:100,odds_american:r.price??null}));
 assert.deepEqual(inspectCbbLockedMarketCoverage(coverageRecords,{...coverage,rows:healthy}),[]);
 assert.equal(inspectCbbLockedMarketCoverage(coverageRecords.map(r=>({...r,odds_american:null})),{...coverage,rows:healthy}).length,2);
 assert.deepEqual(inspectCbbLockedMarketCoverage([],{...coverage,rows:[{market:"moneyline",grade:"Held",reason:"game_forecast_without_qualified_wager"}]}),[],"Explicit domain-only forecasts do not invent three wagers");
 assert.equal(JSON.stringify(coverage),coverageBytes);
 assert.equal(trackingManifestInSlateWindow("cfb", "2026-10-31T02:30:00Z", "2026-10-31"), false, "Friday Eastern game cannot become a Saturday missing-record alarm");
 assert.equal(trackingManifestInSlateWindow("cfb", "2026-10-31T02:30:00Z", "2026-10-30"), true);
 assert.equal(trackingManifestInSlateWindow("nfl", "2026-11-02T01:20:00Z", "2026-11-01"), true, "DST Sunday night remains the Sunday slate");
 const now = "2026-07-11T12:00:00Z";
 const expected = gradeStoredTrackingRecord(restored, outcome);
 const games = new Map([[10, outcome]]), grades = new Map([[1, expected]]);
 assert.equal(inspectTrackingSettlements({ records: [restored], games, grades, now }).length, 0);
 assert.equal(inspectTrackingSettlements({ records: [restored], games, grades: new Map(), now })[0].kind, "locked_result_overdue");
 const pendingGame = { ...outcome, status: "in_progress", home_score: null, away_score: null, first_inning_runs: null };
 assert.equal(inspectTrackingSettlements({ records: [restored], games: new Map([[10, pendingGame]]), grades: new Map(), now: "2026-07-10T21:00:00Z" }).length, 0);
 assert.equal(inspectTrackingSettlements({ records: [restored], games: new Map([[10, pendingGame]]), grades: new Map(), now })[0].kind, "locked_result_overdue");
 const wrong = { ...expected, result: "loss" } as PredictionGradeRow;
 assert.equal(inspectTrackingSettlements({ records: [restored], games, grades: new Map([[1, wrong]]), now })[0].kind, "settled_result_differs");
 assert.equal(inspectTrackingSettlements({ records: [restored], games: new Map([[10, { ...outcome, status: "scheduled" }]]), grades, now })[0].severity, "warn");
 const postponed = gradeStoredTrackingRecord(restored, { ...outcome, status: "STATUS_POSTPONED" });
 assert.equal(inspectTrackingSettlements({ records: [restored], games: new Map([[10, { ...outcome, status: "STATUS_POSTPONED" }]]), grades: new Map([[1, postponed]]), now }).length, 0);
 const wnba = { ...restored, sport: "wnba", market: "spread", slate_date: "2026-07-09" } as PredictionRecordRow;
 assert.equal(gradeStoredTrackingRecord(wnba, outcome).result, "void", "audit and writer share legacy slate-void semantics");
 const approvals=CFB_APPROVED_TRACKING_CORRECTIONS;
 assert.equal(approvals.length,9);assert.equal(new Set(approvals.map(a=>a.originalId)).size,9);
 assert.equal(new Set(approvals.map(a=>a.sourceId)).size,6);
 for(const a of approvals){
  assert.match(a.sourceSha256,/^[a-f0-9]{64}$/);
  assert.equal(cfbTrackingCorrectionSupersededRecordId({modelVersion:CM,correctionRelease:CR,supersedesPredictionRecordId:a.originalId}),a.originalId);
 }
 for(const bad of [{modelVersion:'wrong',correctionRelease:CR,supersedesPredictionRecordId:478269},{modelVersion:CM,correctionRelease:'wrong',supersedesPredictionRecordId:478269},{modelVersion:CM,correctionRelease:CR,supersedesPredictionRecordId:999}])assert.equal(cfbTrackingCorrectionSupersededRecordId(bad),null);
 const fakePayload={capturedAt:'2026-10-24T18:30:15.741Z',game:{scheduledStart:'2026-10-24T19:30:00Z'},decisions:{evaluatedBets:[]}} as never;
 const fakeOriginal={id:478269,sport:'cfb',external_id:457744,market:'total',prediction_source:'cfb_forward_evidence_published_pregame_accuracy_recovery',play_grade:'no_play',locked_at:'2026-10-18T04:00:16.340Z',odds_american:null} as PredictionRecordRow;
 assert.throws(()=>buildApprovedCfbTrackingCorrection({source:fakeOriginal,payload:fakePayload,evidenceId:approvals[8].sourceId,evidenceSha256:'0'.repeat(64)}),/refuses unapproved or changed source/);
 assert.throws(()=>buildApprovedCfbTrackingCorrection({source:{...fakeOriginal,id:123},payload:fakePayload,evidenceId:approvals[8].sourceId,evidenceSha256:approvals[8].sourceSha256}),/refuses unapproved or changed source/);
 const original={...restored,sport:'cfb',id:478269,market:'total',play_grade:'no_play',member_facing_grade:'no_play',model_version:'original',snapshot_json:{}} as PredictionRecordRow;
 const corrected={...original,id:999999,play_grade:'best_angle',member_facing_grade:'best_angle',model_version:CM,snapshot_json:{tracking_correction_release:CR,supersedes_prediction_record_id:478269}} as PredictionRecordRow;
 const originalCopy=structuredClone(original);
 for(const ordered of [[original,corrected],[corrected,original]]){
  const unique=dedupePredictionRecordsForTracking(ordered);assert.equal(unique.length,1);assert.equal(unique[0].id,999999);
 }
 assert.deepEqual(original,originalCopy);
 const winnerRows=[{id:478269,model_version:'original',tracking_correction_release:null,supersedes_prediction_record_id:null},{id:999999,model_version:CM,tracking_correction_release:CR,supersedes_prediction_record_id:478269}];
 assert.deepEqual(preferAppendOnlyWinnerTrackingCorrections(winnerRows),[winnerRows[1]]);
 const correctionClient=(rows:unknown[],error:unknown=null)=>({from(table:string){assert.equal(table,'prediction_records');const q={select(fields:string){assert(!fields.includes('locked_at'));return q;},eq(){return q;},then(resolve:(value:{data:unknown[]|null;error:unknown})=>unknown){return Promise.resolve({data:rows,error}).then(resolve);}};return q;}} as unknown as SupabaseClient);
 assert.deepEqual(await excludeSupersededCfbWinnerRecords(correctionClient([winnerRows[1]]),[winnerRows[0]]),[], 'old early-lock date cannot retain an original when replacement is outside its time window');
 assert.deepEqual(await excludeSupersededCfbWinnerRecords(correctionClient([]),[winnerRows[0]]),[winnerRows[0]], 'without an actual stored replacement, keep original');
 assert.deepEqual(await excludeSupersededCfbWinnerRecords(correctionClient([{...winnerRows[1],model_version:'unreleased'}]),[winnerRows[0]]),[winnerRows[0]]);
 await assert.rejects(excludeSupersededCfbWinnerRecords(correctionClient([],{message:'unavailable'}),[winnerRows[0]]),/CFB winner correction read failed/);
 let correctionWrites=0;
 const alreadyDone={from(){const query={select(){return query;},eq(){return query;},then(resolve:(value:{data:unknown[]|null;error:unknown})=>unknown){return Promise.resolve({data:approvals.map(a=>({id:a.originalId+100000,external_id:a.externalId,market:a.market,model_version:CM,release:CR,supersedes:a.originalId})),error:null}).then(resolve);},insert(){correctionWrites++;throw new Error('must not insert twice');},update(){throw new Error('immutable');},delete(){throw new Error('immutable');}};return query;}} as unknown as SupabaseClient;
 assert.equal(await writeApprovedCfbTrackingCorrections(alreadyDone),0);assert.equal(correctionWrites,0);
 const writer=readFileSync(new URL('../lib/services/football/cfbForwardEvidenceWriter.ts',import.meta.url),'utf8');assert(writer.includes('args.apply ? await writeApprovedCfbTrackingCorrections(args.client) : 0'));
 const append=readFileSync(new URL('../lib/services/football/cfbPublishedTrackingCorrection.ts',import.meta.url),'utf8');assert(!/\.(update|upsert|delete)\(/.test(append));assert(append.includes('matchesCfbForwardEvidencePayloadHash(payload, approval.sourceSha256)'));
 const operator=readFileSync(new URL('./operator/settle-approved-cfb-tracking-corrections.ts',import.meta.url),'utf8');assert(operator.includes("jobName='prediction_pipeline:cfb'"));assert(operator.includes('recordIds:q.data.filter'));assert(!operator.includes('ingestCfbFinalScores'));
 // Exercise the complete guard with the real CBB storage contract: the
 // relational slate date is null, while lock publication and ET start are valid.
 const cbbRecord={...restored,id:901,game_id:902,external_id:903,sport:'cbb',market:'moneyline',pick:'HOME',side:'home',slate_date:'2026-11-07',game_date:'2026-11-08T02:00:00Z',locked_at:'2026-11-08T01:00:00Z',play_grade:'best_angle',member_facing_grade:'best_angle'} as unknown as PredictionRecordRow;
 const cbbGame={id:902,status:'final',game_date:cbbRecord.game_date,home_score:80,away_score:70,first_inning_runs:null};
 const cbbGrade=gradeStoredTrackingRecord(cbbRecord,cbbGame);cbbGrade.prediction_record_id=901;
 const cbbManifest={snapshot_key:'cbb::member-game::903',slate_date:null,generated_at:'2026-11-08T01:00:00Z',id:'903',locked:'2026-11-08T01:00:00Z',starts:'2026-11-08T02:00:00Z',rows:[{market:'moneyline',grade:'Best Angle'}]};
 let cbbLedger=[cbbRecord];
 let nflManifest:unknown[]=[];let nflManifestError=false;
 const cbbClauses:Array<[string,string,unknown]>=[];
 const cbbClient={from(table:string){let like=false,nflLike=false,census=false;const q={select(){return q;},order(){return q;},range(){return q;},eq(){return q;},not(){return q;},in(key:string){if(key==='sport')census=true;return q;},like(_key:string,pattern:string){like=pattern.startsWith('cbb::');nflLike=pattern.startsWith('nfl::');return q;},gte(key:string,value:unknown){if(table==='lab_response_snapshots'&&like)cbbClauses.push(['gte',key,value]);return q;},lte(key:string,value:unknown){if(table==='lab_response_snapshots'&&like)cbbClauses.push(['lte',key,value]);return q;},abortSignal(){return q;},then(resolve:(value:{data:unknown[]|null;error:unknown})=>unknown){let data:unknown[]=[];
  if(table==='prediction_records_tracking_projection')data=cbbLedger;
  else if(table==='games'&&!census)data=[cbbGame];
  else if(table==='prediction_grades')data=[cbbGrade];
  else if(table==='lab_response_snapshots'&&nflLike){if(nflManifestError)return Promise.resolve({data:null,error:{message:'manifest unavailable'}}).then(resolve);data=nflManifest;}
  else if(table==='lab_response_snapshots'&&like){data=[cbbManifest];for(const [op,key,value]of cbbClauses)data=data.filter(r=>{const field=(r as Record<string,unknown>)[key];return typeof field==='string'&&typeof value==='string'&&(op==='gte'?field>=value:field<=value);});}
  return Promise.resolve({data,error:null}).then(resolve);}};return q;}} as unknown as SupabaseClient;
 const cbbReport=await runTrackingIntegrityAudit({client:cbbClient,now:'2026-11-08T14:00:00Z',from:'2026-11-07'});
 assert.equal(cbbReport.sports.cbb.publishedActionableLocks,1,'null relational slate date must not hide a published CBB call');assert.equal(cbbReport.errors,0);
 assert(cbbClauses.every(([,key])=>key==='generated_at'),'bound CBB reads by its writer publication clock');
 cbbManifest.starts='2026-11-07T02:00:00Z';
 const oldEtReport=await runTrackingIntegrityAudit({client:cbbClient,now:'2026-11-08T14:00:00Z',from:'2026-11-07'});assert.equal(oldEtReport.sports.cbb.publishedActionableLocks,0,'Thursday ET late game must stay outside Friday window');
 assert(oldEtReport.findings.some(f=>f.kind==='cbb_published_source_missing'),'a zero-source result with real CBB actionables must fail visibly');
 cbbManifest.starts='2026-11-08T02:00:00Z';cbbLedger=[];
 const missingWholeCbb=await runTrackingIntegrityAudit({client:cbbClient,now:'2026-11-08T14:00:00Z',from:'2026-11-07'});
 assert.equal(missingWholeCbb.sports.cbb.publishedActionableLocks,1);assert(missingWholeCbb.findings.some(f=>f.kind==='published_lock_missing_tracking'),'detect an entirely missing tracked CBB game from its independent member source');
 const nflCard=(id:number,start:string,best=false)=>({external_id:id,gameStartAt:start,lockedAt:'2026-11-07T17:00:00Z',markets:{moneyline:{verdict:{label:'No Play'}},first_inning:{verdict:{label:'No Play'}},total:{verdict:{label:best?'Best Angle':'No Play'}}}});
 nflManifest=[{snapshot_key:'nfl::daily-edge::mock',games:[nflCard(1392358,'2026-11-07T18:00:00Z',true),nflCard(1392362,'2026-11-07T21:05:00Z'),{...nflCard(1392365,'2026-11-09T01:15:00Z'),lockedAt:null}]}];
 const nflReport=await runTrackingIntegrityAudit({client:cbbClient,now:'2026-11-08T14:00:00Z',from:'2026-11-07'});
 assert.equal(nflReport.findings.filter(f=>f.kind==='published_nfl_game_missing_tracking').length,6,'entirely absent games, including operational No Plays, cannot evade the real published slate reader');
 assert.equal(nflReport.sports.nfl.publishedActionableLocks,1,'public-card Best Angle remains independently checked without any successful T60 source');
 nflManifestError=true;await assert.rejects(runTrackingIntegrityAudit({client:cbbClient,now:'2026-11-08T14:00:00Z',from:'2026-11-07'}),/NFL published-slate read failed/);
 const cron = readFileSync(new URL("../app/api/cron/tracking-refresh/route.ts", import.meta.url), "utf8");
 assert(cron.includes("sport === sports.at(-1)")); assert(cron.includes("tracking_integrity_errors:"));
 const endpoint = readFileSync(new URL("../app/api/internal/tracking-integrity-audit/route.ts", import.meta.url), "utf8");
 assert(endpoint.includes("validateCronAuth(request)")); assert(!endpoint.includes("sendAuditAlert"));
 console.log("PASS tracking integrity: original FI authority/immutability, >1,000 grade reads, read failure refusal, every sport, missing entire lock, live vs overdue/final result, canonical WNBA void policy and single scheduled owner.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
