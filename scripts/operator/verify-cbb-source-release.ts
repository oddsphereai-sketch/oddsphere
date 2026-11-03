/** Read-only before/after public-record proof. Never updates a stored record. */
import fs from "node:fs";
import {createHash} from "node:crypto";
import {supabase} from "../../lib/db/supabase";
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?
 Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const fields="id,game_id,market,pick,side,line_value,odds_american,play_grade,locked_at,model_version,calibration_version,confidence,model_probability,market_probability,edge,expected_value,no_bet,no_bet_reason,best_angle,market_aligned,source_quality,data_quality_tier,model_used,snapshot_json";
async function main(){
 const [mode,path]=process.argv.slice(2);if(!["capture","verify"].includes(mode)||!path?.startsWith("/private/tmp/cbb-independent-"))throw new Error("Use capture|verify /private/tmp/cbb-independent-* baseline path");
 const [members,tracking,health]=await Promise.all([
  supabase.from("lab_response_snapshots").select("snapshot_key,payload,generated_at").like("snapshot_key","cbb::member-game::%").limit(1000),
  supabase.from("prediction_records").select(fields).eq("sport","cbb").order("id",{ascending:true}).limit(1000),
  supabase.from("data_refresh_log").select("refresh_started_at,refresh_completed_at,refresh_status,error_message,api_calls_made")
   .eq("sport","cbb").eq("data_source","cbb_daily_refresh").order("refresh_started_at",{ascending:false}).limit(2),
 ]);
 if(members.error||tracking.error||health.error)throw new Error("Read-only CBB preservation query failed");
 if((members.data?.length??0)>=1000||(tracking.data?.length??0)>=1000)throw new Error("Baseline row bound reached; refusing partial proof");
 const locked=Object.fromEntries((members.data??[]).filter(row=>row.payload?.snapshot?.lockedAt).map(row=>[row.snapshot_key,hash(row.payload)]));
 const records=Object.fromEntries((tracking.data??[]).map(row=>[String(row.id),hash(row)]));
 const open=(members.data??[]).filter(row=>!row.payload?.snapshot?.lockedAt).map(row=>({gameId:row.payload.snapshot.gameId,
  startsAt:row.payload.snapshot.startsAt,asOf:row.payload.snapshot.board.asOf,model:row.payload.snapshot.board.modelRelease,
  grade:row.payload.snapshot.board.gradeRelease,board:row.payload.snapshot.board.release}));
 if(mode==="capture")fs.writeFileSync(path,JSON.stringify({at:new Date().toISOString(),locked,records}),{flag:"wx",mode:0o600});
 else{
  const baseline=JSON.parse(fs.readFileSync(path,"utf8"));
  for(const [key,digest] of Object.entries(baseline.locked))if(locked[key]!==digest)throw new Error(`Locked member payload changed or disappeared: ${key}`);
  for(const [key,digest] of Object.entries(baseline.records))if(records[key]!==digest)throw new Error(`Frozen tracking fields changed or disappeared: ${key}`);
 }
 console.log(JSON.stringify({mode,at:new Date().toISOString(),lockedMembers:Object.keys(locked).length,trackingRecords:Object.keys(records).length,
  preserved:mode==="verify",open,health:health.data,providerRequests:0,databaseWrites:0}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"CBB preservation proof failed");process.exitCode=1;});
