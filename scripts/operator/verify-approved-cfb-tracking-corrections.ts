/** SELECT-only exact-source proof. This does not materialize or grade history. */
import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { CFB_APPROVED_TRACKING_CORRECTIONS, buildApprovedCfbTrackingCorrection } from '../../lib/services/football/cfbPublishedTrackingCorrection';
import { gradeStoredTrackingRecord } from '../../lib/services/predictionGradingService';
import type { PredictionRecordRow } from '../../lib/types/domain/Tracking';
loadEnvConfig(process.cwd());
async function main() {
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
 const originals=await db.from('prediction_records').select('*').in('id',CFB_APPROVED_TRACKING_CORRECTIONS.map(a=>a.originalId)); if(originals.error)throw originals.error;
 const sources=await db.from('cfb_forward_evidence_snapshots').select('id,payload_sha256,payload').in('id',[...new Set(CFB_APPROVED_TRACKING_CORRECTIONS.map(a=>a.sourceId))]);if(sources.error)throw sources.error;
 const gameIds=[...new Set(originals.data.map(r=>r.game_id))];const games=await db.from('games').select('*').in('id',gameIds);if(games.error)throw games.error;
 const proof=CFB_APPROVED_TRACKING_CORRECTIONS.map(a=>{const original=originals.data.find(r=>r.id===a.originalId)!,s=sources.data.find(s=>s.id===a.sourceId)!;
  const correction=buildApprovedCfbTrackingCorrection({source:original as PredictionRecordRow,payload:s.payload,evidenceId:s.id,evidenceSha256:s.payload_sha256});
  const game=games.data.find(g=>g.id===original.game_id)!;const grade=gradeStoredTrackingRecord(correction,game);
  return{originalId:original.id,matchup:correction.matchup,market:correction.market,playGrade:correction.play_grade,pick:correction.pick,line:correction.line_value,price:correction.odds_american,probability:correction.model_probability,lockedAt:correction.locked_at,sourceId:s.id,sourceSha256:s.payload_sha256,gameStatus:game.status,homeScore:game.home_score,awayScore:game.away_score,result:grade.result};});
 const result={readOnly:true,rows:proof,wins:proof.filter(p=>p.result==='win').length,losses:proof.filter(p=>p.result==='loss').length,pending:proof.filter(p=>p.result==='pending').length};
 writeFileSync('/private/tmp/approved-cfb-tracking-exact-source-proof-20261108.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
