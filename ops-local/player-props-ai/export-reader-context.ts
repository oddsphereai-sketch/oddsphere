/** SELECT-only current context rehearsal. No provider calls, forecasts, writes or key output. */
import {readFileSync,writeFileSync} from "node:fs";
import {createClient} from "@supabase/supabase-js";
import type {GamePacket,Json} from "../../lib/playerPropsAi/evidenceContract";
import {attachGameReaderContext,type ReaderGameContext} from "../../lib/playerPropsAi/gameContext";
import {invariant,instant} from "../../lib/playerPropsAi/evidence";
const arg=(key:string)=>process.argv.find(s=>s.startsWith(`--${key}=`))?.slice(key.length+3);
async function main(){
  const input=arg("packet"),out=arg("out");
  invariant(input&&out&&out.startsWith("/private/tmp/")&&process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY,"Private packet/output and configured read-only source access required");
  const packet=JSON.parse(readFileSync(input,"utf8")) as GamePacket;
  invariant(packet.sport==="nfl","NFL exact-game source expected");
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.from("nfl_forward_evidence_snapshots")
    .select("id,provider_game_id,captured_at,created_at,game_start_at,game:payload->game,injuries:payload->injuries,weather:payload->weather,depth:payload->startersAndDepth")
    .eq("provider_game_id",packet.gameId).lte("captured_at",packet.cutoff).lte("created_at",packet.cutoff).order("captured_at",{ascending:false}).limit(10);
  if(error)throw new Error(`read_only_context_http_error:${error.code}`);
  const contexts:ReaderGameContext[]=(data??[]).map(raw=>{
    const row=raw as unknown as {id:string;provider_game_id:string;captured_at:string;created_at:string;game_start_at:string;game:{away:{abbreviation:string};home:{abbreviation:string}};injuries:Json;weather:Json;depth:Json};
    return {id:row.id,gameId:row.provider_game_id,start:row.game_start_at,awayTeam:row.game.away.abbreviation,homeTeam:row.game.home.abbreviation,
      availableAt:new Date(Math.max(instant(row.captured_at),instant(row.created_at))).toISOString(),source:"existing NFL forward-context source; database availability retained; no Daily Edge forecast copied",injuries:row.injuries,weather:row.weather,depth:row.depth};
  }).filter(row=>instant(row.start)===instant(packet.start));
  const enriched=attachGameReaderContext(packet,contexts);
  writeFileSync(out,JSON.stringify(enriched),{mode:0o600,flag:"wx"});
  writeFileSync(out.replace(/\.json$/,".context-source.json"),JSON.stringify({contexts,productionWrites:0,providerCalls:0}),{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({out,players:packet.players.length,contextRows:contexts.length,addedEvidence:enriched.players.reduce((n,p,i)=>n+p.evidence.length-packet.players[i].evidence.length,0),productionWrites:0,providerCalls:0}));
}
void main().catch(e=>{console.error((e as Error).message.replace(/sk-[\w-]+/g,"redacted"));process.exitCode=1;});
