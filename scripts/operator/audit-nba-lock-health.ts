/** SELECT-only NBA lock/reader/cron diagnostic. Never runs a writer/provider. */
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {supabase} from "../../lib/db/supabase";
import {NBA_PREDICTION_RECORD_RELEASE} from "../../lib/automodel/nba/nbaChampionRuntime";
import {assessNbaLockCoherence} from "../../lib/services/nba/nbaLockCoherence";
import {classifyLockState,computeLocksAt} from "../../lib/automodel/lockState";

async function main(){
 if(process.argv.includes("--write"))throw new Error("Read-only audit; writes are not supported");
 const date=process.argv.find(v=>v.startsWith("--date="))?.slice(7)??new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date());
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid date");
 const now=new Date();
 const [games,records,logs,snapshots]=await Promise.all([
  supabase.from("games").select("id,external_id,game_date,status,home_team:home_team_id(abbreviation),away_team:away_team_id(abbreviation)").eq("sport","nba").eq("slate_date",date).order("game_date"),
  supabase.from("prediction_records").select("id,game_id,market,pick,line_value,model_version,locked_at,snapshot_json,confidence,model_probability,market_probability,edge,play_grade,odds_american").eq("sport","nba").eq("slate_date",date),
  supabase.from("data_refresh_log").select("id,data_source,sport,refresh_status,refresh_started_at,refresh_completed_at,error_message,records_updated").eq("sport","nba").in("data_source",["pregame_sweep","nba_daily_refresh"]).order("refresh_started_at",{ascending:false}).limit(15),
  supabase.from("lab_response_snapshots").select("snapshot_key,generated_at,payload").like("snapshot_key",`nba::${date}::%`).order("generated_at",{ascending:false}).limit(4),
 ]);
 for(const r of [games,records,logs,snapshots])if(r.error)throw new Error(r.error.message);
 const lockHashes=(records.data??[]).filter(r=>r.locked_at!==null).map(r=>({id:r.id,hash:createHash("sha256").update(JSON.stringify(r)).digest("hex")}));
 const report=(games.data??[]).map(g=>{
  const rows=(records.data??[]).filter(r=>r.game_id===g.id),current=rows.filter(r=>r.model_version===NBA_PREDICTION_RECORD_RELEASE);
  const markets=["moneyline","spread","total"];
  const locked=markets.every(m=>rows.some(r=>r.market===m&&r.locked_at!==null));
  const lock=locked?rows.filter(r=>r.locked_at!==null).map(r=>r.locked_at!).sort()[0]:null;
  return {game:g,locksAt:computeLocksAt(g.game_date),state:classifyLockState({game_date:g.game_date,locked_at:lock},now),records:rows.map(({snapshot_json,...r})=>process.argv.includes("--verbose")?({...r,snapshotFields:Object.keys(snapshot_json??{})}):({id:r.id,market:r.market,locked_at:r.locked_at})),coherence:locked?null:assessNbaLockCoherence({gameIds:[g.id],rows:current})};
 });
 const readers=(snapshots.data??[]).map(s=>{
  let p=s.payload;if(p?.encoding==="gzip-base64")p=JSON.parse(gunzipSync(Buffer.from(p.payload,"base64"),{maxOutputLength:32_000_000}).toString());
  const board=p?.fixture?.snapshot??p?.snapshot??p;
  return {key:s.snapshot_key,at:s.generated_at,games:(board?.games??[]).filter((g:Record<string,unknown>)=>typeof g.gameStartAt==="string"&&new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date(g.gameStartAt))===date).map((g:Record<string,unknown>)=>({id:g.id,event:g.external_id,away:g.awayTeam,home:g.homeTeam,start:g.gameStartAt,lockState:g.lockState,lockedAt:g.lockedAt,locksAt:g.locksAt}))};
 });
 console.log(JSON.stringify({at:now.toISOString(),date,release:NBA_PREDICTION_RECORD_RELEASE,games:report,lockHashes,readers:readers.slice(0,1),cron:logs.data?.slice(0,4)}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
