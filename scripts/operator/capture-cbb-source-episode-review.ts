/** Bounded stored-input audit. No provider request or production write. */
import fs from "node:fs";
import {supabase} from "../../lib/db/supabase";
import {readCbbCanonicalReaderHistory} from "../../lib/services/cbb/cbbCanonicalReaderHistory";
import {pairCbbCanonicalMarketEvidence} from "../../lib/services/cbb/cbbCanonicalMarketEvidence";
import {cbbCanonicalBehaviorInputs} from "../../lib/services/cbb/cbbCanonicalBehaviorInputs";
import {readCbbCapturedPublicSplits} from "../../lib/services/cbb/cbbReaderMarketEvidence";
import {cbbDecisionSplitContext} from "../../lib/cbb/decisionSplitContext";
import {readCbbCurrentTraining} from "../../lib/services/cbb/cbbCurrentSeasonTraining";
import type {cbbCurrentSplitEvidence} from "../../lib/cbb/owlsSplitEvidence";
import type {CbbGame} from "../../lib/cbb/types";
async function main(){
 const [seedPath,outputPath]=process.argv.slice(2);if(!seedPath||!outputPath||!outputPath.startsWith("/private/tmp/cbb-independent-"))throw new Error("Pass preserved board seed and NEW private/tmp/cbb-independent-* output path");
 if(fs.existsSync(outputPath))throw new Error("Audit output already exists; preserve prior evidence");
 const seed=JSON.parse(fs.readFileSync(seedPath,"utf8"));
 const ids:number[]=[...new Set<number>(seed.rows.map((r:{payload:{snapshot:{gameId:number}}})=>r.payload.snapshot.gameId))];
 if(!ids.length||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)))throw new Error("Invalid bounded fixture seed");
 const allOpen=process.argv.includes("--all-open");
 const [snapshots,health,training]=await Promise.all([
  allOpen?supabase.from("lab_response_snapshots").select("snapshot_key,payload,generated_at,updated_at").like("snapshot_key","cbb::member-game::%").limit(1000):
   supabase.from("lab_response_snapshots").select("snapshot_key,payload,generated_at,updated_at").in("snapshot_key",ids.map(id=>`cbb::member-game::${id}`)),
  supabase.from("data_refresh_log").select("refresh_started_at,refresh_completed_at,refresh_status,error_message,records_updated,api_calls_made")
   .eq("sport","cbb").eq("data_source","cbb_daily_refresh").order("refresh_started_at",{ascending:false}).limit(2),
  readCbbCurrentTraining(2026,supabase),
 ]);
 if(snapshots.error||health.error)throw new Error("Stored CBB snapshot/health audit failed");
 if(allOpen&&(snapshots.data?.length??0)>=1000)throw new Error("Full open-board row bound reached");
 const rows=(snapshots.data??[]).filter(row=>!allOpen||!row.payload.snapshot.lockedAt),open=rows.filter(row=>!row.payload.snapshot.lockedAt);
 const cutoff=open.map(row=>row.payload.snapshot.board.asOf).sort().at(-1);
 const games:CbbGame[]=open.map(row=>{
  const p=row.payload,s=p.snapshot,b=s.board,i=b.marketContext.verifiedMarketRead?.forecastIdentity??b.marketContext.retainedLevelInput?.independent,m=p.memberGame;
  if(!i)throw new Error("Missing retained original independent identity");
  const team=(id:number,college:string|null,full_name:string,abbreviation:string)=>({id,college,full_name,name:full_name,abbreviation,conference_id:null});
  return {id:s.gameId,date:s.startsAt,season:2026,status:"pre",period:0,home_score:0,away_score:0,
   home_team:team(i.homeId,m.cbbHomeCollege??null,m.homeTeamDisplayName,m.homeTeam),
   visitor_team:team(i.awayId,m.cbbAwayCollege??null,m.awayTeamDisplayName,m.awayTeam)};
 });
 const contextByGame:Record<string,unknown>={};let coverage:unknown=null,publicRows=0;
 if(cutoff){
  const [history,publicSplitRows]=await Promise.all([
   readCbbCanonicalReaderHistory({db:supabase,gameIds:games.map(g=>g.id),asOf:cutoff}),
   readCbbCapturedPublicSplits(supabase,games.map(g=>g.id),Date.parse(cutoff)),
  ]);
  coverage={price:history.price,split:history.split,retail:history.retailPrice};publicRows=publicSplitRows.length;
  for(const game of games){
   const row=open.find(row=>row.payload.snapshot.gameId===game.id)!,asOf=row.payload.snapshot.board.asOf;
   const native=pairCbbCanonicalMarketEvidence({game,decisionAt:asOf,
    priceRows:[...(history.price.complete?history.priceRows:[]),...history.retailPriceRows].filter(q=>q.canonical_event_id===String(game.id)),
    splitRows:(history.split.complete?history.splitRows:[]).filter(q=>q.canonical_event_id===String(game.id))});
   const normalized=cbbCanonicalBehaviorInputs(native);
   const empty={rows:[]} as unknown as ReturnType<typeof cbbCurrentSplitEvidence>;
   contextByGame[String(game.id)]={...normalized,decisionAt:asOf,
    decisionSplits:cbbDecisionSplitContext({game,allGames:games,asOf,direct:empty,canonical:native.splitPairs,publicRows:publicSplitRows,draftKings:null}),
    completeness:{price:history.price.complete,split:history.split.complete}};
  }
 }
 const out={capturedAt:new Date().toISOString(),scope:"stored_current_inputs_only_no_prediction_or_database_write",rows,contextByGame,training,
  health:health.data,coverage,publicRows,providerRequests:0,databaseWrites:0,
  retailNetworkScope:"No new network request; only native stored split contexts and bounded public capture are joined"};
 fs.writeFileSync(outputPath,JSON.stringify(out),{flag:"wx",mode:0o600});
 console.log(JSON.stringify({outputPath,capturedAt:out.capturedAt,stored:rows.length,unlocked:open.length,contextGames:games.length,publicRows,coverage,health:out.health,providerRequests:0,databaseWrites:0}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Stored-input capture failed");process.exitCode=1;});
