/** Manual SELECT-only NFL market export. Never calls a sports provider or writer. */
import {readFileSync,writeFileSync} from "node:fs";
import {createClient} from "@supabase/supabase-js";
import {readNflPlayerPropsMarketObserverHistory} from "../../lib/services/football/nflPlayerPropsMarketObserverStore";
import {readNflPlayerPropsReferenceOffers} from "../../lib/services/football/nflPlayerPropsReferenceOfferStore";
import {attachNflReaderMarkets} from "../../lib/playerPropsAi/nflMarkets";
import {compileMarketReport} from "../../lib/playerPropsAi/marketReport";
import type {GamePacket} from "../../lib/playerPropsAi/evidenceContract";
import {invariant} from "../../lib/playerPropsAi/evidence";
const [file,out]=process.argv.slice(2);
async function main(){
  invariant(file&&out?.startsWith("/private/tmp/")&&process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY,"Private source/output and configured SELECT access required");
  const packet=JSON.parse(readFileSync(file,"utf8")) as GamePacket;
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const [observer,references]=await Promise.all([readNflPlayerPropsMarketObserverHistory({client,season:2026,week:9}),readNflPlayerPropsReferenceOffers({client,season:2026,week:9})]);
  const source={availableAt:new Date().toISOString(),observer,references:references?.offers??[]};
  const raw=attachNflReaderMarkets({...packet,players:packet.players.map(p=>({...p,evidence:p.evidence.filter(e=>!e.id.startsWith("market-report:"))}))},source);
  const enriched=compileMarketReport(raw);
  writeFileSync(out,JSON.stringify(enriched),{mode:0o600,flag:"wx"});
  writeFileSync(out.replace(/\.json$/,".source.json"),JSON.stringify(source),{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({out,players:enriched.players.length,markets:enriched.players.reduce((n,p)=>n+p.markets.length,0),rawQuotesAdded:raw.quotes.length-packet.quotes.length,retainedQuotes:enriched.quotes.length,productionWrites:0,providerCalls:0}));
}
void main().catch(e=>{console.error((e as Error).message.replace(/sk-[\w-]+/g,"redacted"));process.exitCode=1;});
