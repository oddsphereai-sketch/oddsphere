/** Settle only the nine owner-approved append-only rows after protected deployment.
 * The canonical CFB writer creates them; this operator never creates predictions
 * and never regrades an original. No provider calls or model evaluation. */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { acquireCronJobLease, releaseCronJobLease } from '../../lib/cron/leases';
import { gradePredictionsForSlate } from '../../lib/services/predictionGradingService';
import { CFB_APPROVED_TRACKING_CORRECTIONS, CFB_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION, cfbTrackingCorrectionSupersededRecordId } from '../../lib/services/football/cfbPublishedTrackingCorrection';

async function main() {
 const apply=process.argv.includes('--apply');
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
 if(apply){
  const local=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const r=await fetch('https://www.oddsphereai.com/api/admin/cbb/contextual-readiness',{headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`}});
  const body=await r.json();if(!r.ok||body.deployment?.commit!==local)throw new Error('Refusing apply before this exact clean protected production commit is deployed.');
  if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Refusing apply from dirty checkout.');
 }
 const jobName='prediction_pipeline:cfb',runId=`approved-cfb-tracking-settlement:${Date.now()}`;
 if(apply){const lease=await acquireCronJobLease({jobName,runId,leaseSeconds:240});if(lease.mode!=='acquired')throw new Error(`CFB pipeline unavailable: ${lease.mode}`);}
 try {
  const q=await db.from('prediction_records').select('id,slate_date,model_version,snapshot_json').eq('sport','cfb').eq('model_version',CFB_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION);if(q.error)throw q.error;
  const approved=new Set<number>();
  for(const row of q.data){const original=cfbTrackingCorrectionSupersededRecordId({modelVersion:row.model_version,correctionRelease:row.snapshot_json?.tracking_correction_release,supersedesPredictionRecordId:row.snapshot_json?.supersedes_prediction_record_id});
   if(original===null||approved.has(original))throw new Error('Unapproved or duplicate correction identity.');approved.add(original);}
  if(approved.size!==CFB_APPROVED_TRACKING_CORRECTIONS.length)throw new Error(`Canonical deployed CFB writer has materialized ${approved.size}/9 corrections; wait for it before settlement.`);
  const results=[];
  for(const slateDate of [...new Set(q.data.map(r=>r.slate_date))]) {
   results.push(await gradePredictionsForSlate({sport:'cfb',slateDate,apply,supabase:db,source:'auto_score_ingest',recordIds:q.data.filter(r=>r.slate_date===slateDate).map(r=>r.id)}));
  }
  console.log(JSON.stringify({apply,approvedRecords:approved.size,results},null,2));
  if(results.some(r=>r.errors.length>0||r.computed.pending>0))throw new Error('Scoped correction settlement incomplete. Original rows were not selected.');
 } finally {if(apply)await releaseCronJobLease({jobName,runId});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
