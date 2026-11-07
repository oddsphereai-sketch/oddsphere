/** Full-source layout normalization for cost counts. SELECT-only, never generates forecasts. */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {createClient} from "@supabase/supabase-js";
import {fromCachedExport} from "../../lib/playerPropsAi/cachedAdapters";
import {enrichCachedPacket,mlbPackets,type EnrichedSource} from "../../lib/playerPropsAi/cachedEnrichment";
import {attachGameReaderContext,type ReaderGameContext} from "../../lib/playerPropsAi/gameContext";
import {attachNflReaderMarkets} from "../../lib/playerPropsAi/nflMarkets";
import {compileMarketReport} from "../../lib/playerPropsAi/marketReport";
import type {GamePacket,Json} from "../../lib/playerPropsAi/evidenceContract";
import {invariant,instant} from "../../lib/playerPropsAi/evidence";
const [directory]=process.argv.slice(2);
async function main(){
 invariant(directory?.startsWith("/private/tmp/"),"New private output required");mkdirSync(directory,{recursive:true,mode:0o700});
 const source=JSON.parse(readFileSync("/private/tmp/props-ai-full-product-enriched-sources-20261106-v2.json","utf8")) as EnrichedSource;
 const previous=JSON.parse(readFileSync("/private/tmp/props-ai-complete-scope-20261106-r3/manifest.json","utf8")) as {packets:{sport:string;gameId:string;stage:string;research:string}[]};
 const base=fromCachedExport(source).packets;
 const mlb=mlbPackets(source);
 const markets=JSON.parse(readFileSync("/private/tmp/oddsphere-props-ai-eval-20261106/nfl_reader_complete_sources_r5.research.source.json","utf8"));
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const packets=[],excluded=[];
 for(const row of previous.packets.filter(p=>p.stage==="final")){
  const original=JSON.parse(readFileSync(row.research,"utf8")) as GamePacket;let raw:GamePacket;
  if(row.sport==="nba"){
   const found=base.find(p=>p.gameId===row.gameId&&p.stage==="final");invariant(found,"Missing NBA full source");raw=enrichCachedPacket(found,source);
   const hasStats=raw.players.every(p=>p.evidence.some(e=>e.kind==="recent_games"));
   if(!hasStats||!raw.quotes.length){excluded.push({sport:row.sport,gameId:row.gameId,reason:"Later cache unavailable at historical cutoff; not a valid complete load profile"});continue;}
  }else if(row.sport==="mlb"){
   const found=mlb.find(p=>p.gameId===row.gameId&&p.stage==="final");invariant(found,"Missing MLB full source");raw=found;
  }else{
   raw={...original,players:original.players.map(p=>({...p,evidence:p.evidence.filter(e=>!e.id.startsWith("market-report:"))}))};
   if(raw.players.every(p=>!p.evidence.some(e=>e.kind==="independent_model"))){excluded.push({sport:row.sport,gameId:row.gameId,reason:"No cutoff-valid source context; not a valid complete load profile"});continue;}
   const {data,error}=await client.from("nfl_forward_evidence_snapshots").select("id,provider_game_id,captured_at,created_at,game_start_at,game:payload->game,injuries:payload->injuries,weather:payload->weather,depth:payload->startersAndDepth")
    .eq("provider_game_id",raw.gameId).lte("captured_at",raw.cutoff).lte("created_at",raw.cutoff).order("captured_at",{ascending:false}).limit(10);
   if(error)throw new Error(`Cost context SELECT failed:${error.code}`);
   const contexts:ReaderGameContext[]=(data??[]).map(value=>{
    const d=value as unknown as {id:string;provider_game_id:string;captured_at:string;created_at:string;game_start_at:string;game:{away:{abbreviation:string};home:{abbreviation:string}};injuries:Json;weather:Json;depth:Json};
    return {id:d.id,gameId:d.provider_game_id,start:d.game_start_at,awayTeam:d.game.away.abbreviation,homeTeam:d.game.home.abbreviation,availableAt:new Date(Math.max(instant(d.captured_at),instant(d.created_at))).toISOString(),source:"existing NFL exact-game context; database availability retained",injuries:d.injuries,weather:d.weather,depth:d.depth};
   });
   raw=attachNflReaderMarkets(attachGameReaderContext(raw,contexts),markets);
  }
  const packet=compileMarketReport(raw),path=`${directory}/${row.sport}-${row.gameId}.research.json`;
  writeFileSync(path,JSON.stringify(packet),{mode:0o600,flag:"wx"});packets.push({...row,research:path});console.log(JSON.stringify({completed:packets.length,sport:row.sport,gameId:row.gameId,players:packet.players.length,markets:packet.players.reduce((n,p)=>n+p.markets.length,0)}));
 }
 writeFileSync(`${directory}/manifest.json`,JSON.stringify({packets,excluded,scope:"Current complete source layout, explicit cutoff-invalid exclusions; no accuracy claim",generationCalls:0,productionWrites:0}),{mode:0o600,flag:"wx"});
 console.log(JSON.stringify({directory,packets:packets.length,excluded,generationCalls:0,productionWrites:0}));
}
void main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
