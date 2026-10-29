/** SELECT-only production rehearsal; optional bounded provider reads, no writes. */
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {writeFileSync} from "node:fs";
import {supabase} from "../../lib/db/supabase";
import {OwlsInsightClient} from "../../lib/providers/owls/owlsInsightClient";
import {captureOwlsBookDisplayHistory} from "../../lib/providers/owls/owlsBookDisplayHistory";
import {backfillKalshiDisplayHistory} from "../../lib/providers/owls/kalshiDisplayHistory";
import {parseOwlsPredictionMarkets,matchPredictionMarketGame,PREDICTION_MARKET_TARGETS,type PredictionMarketSport} from "../../lib/providers/owls/owlsPredictionMarkets";
import {readerContractSelection,resolveReaderContract,type ContractFeed} from "../../lib/providers/owls/predictionMarketContracts";
import type {DailyEdgeGameDto} from "../../app/lab/lib/labTypes";

async function main(){
 const now=Date.now(),date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
 const sports:PredictionMarketSport[]=["nba","nhl","nfl","cfb","mlb","wnba","soccer","ucl"];
 const summary=[],proof:Record<string,unknown>={};
 for(const sport of sports){
  const q=supabase.from("lab_response_snapshots").select("payload");
  const result=sport==="nfl"||sport==="cfb"?await q.like("snapshot_key",`${sport}::daily-edge::2026::%`).order("generated_at",{ascending:false}).limit(1).maybeSingle():await q.eq("snapshot_key",sport==="soccer"?"soccer::english_premier_league::current-week":sport==="ucl"?"soccer::uefa_champions_league::current-week":`${sport}::${date}::current-only::live-copy`).maybeSingle();
  if(result.error)throw result.error;
  let p=result.data?.payload;if(p?.encoding==="gzip-base64")p=JSON.parse(gunzipSync(Buffer.from(p.payload,"base64"),{maxOutputLength:8_000_000}).toString());
  const games=(p?.fixture?.snapshot??p?.snapshot??p)?.games as DailyEdgeGameDto[]|undefined;
  if(!games){summary.push({sport,snapshot:false});continue;}
  const original=JSON.stringify(games),stored=await supabase.from("lab_response_snapshots").select("snapshot_key,payload").like("snapshot_key",`daily-edge::prediction-market%::${sport}::%`);
  if(stored.error)throw stored.error;
  const feed=stored.data?.find(r=>r.snapshot_key.includes("::prediction-market-display::"))?.payload;
  const byKind=(kind:string)=>stored.data?.find(r=>r.snapshot_key.includes(`::${kind}::`))?.payload as ContractFeed|null;
  let available=0,absent=0,unsupported=0;
  for(const g of games){const match=matchPredictionMarketGame(feed??null,{sport,awayTeam:g.awayTeam,homeTeam:g.homeTeam,gameStartAt:g.gameStartAt??"",awayName:g.awayTeamDisplayName,homeName:g.homeTeamDisplayName},now);
   for(const key of["moneyline","total","first_inning"]as const){const s=readerContractSelection(g,key);if(key!=="moneyline"&&!s){unsupported++;continue;}const market=s?resolveReaderContract(byKind(s.kind)??null,match,s,now):match;if(market)available++;else absent++;}
  }
  summary.push({sport,games:games.length,available,explicitUnavailable:absent,unsupported,unchanged:JSON.stringify(games)===original,checksum:createHash("sha256").update(original).digest("hex")});
  if(sport===(process.argv.find(a=>a.startsWith("--provider-sport="))?.slice(17)??"nba")&&process.argv.includes("--live-provider-check")){
   const selectedGame=games.filter(g=>g.lockState!=="locked"&&Date.parse(g.gameStartAt??"")>now).sort((a,b)=>Date.parse(a.gameStartAt!)-Date.parse(b.gameStartAt!))[0];
   if(!selectedGame)continue;
   const client=new OwlsInsightClient(process.env.OWLS_INSIGHT_API_KEY!,{timeoutMs:5000});
   const book=await captureOwlsBookDisplayHistory(null,[selectedGame],sport,client,now),target=PREDICTION_MARKET_TARGETS[sport];
   const raw=await client.get<unknown>(`/api/v2/kalshi/${target.sport}`,{league:target.series}),current=parseOwlsPredictionMarkets(raw.body,sport);
   if(!current)throw new Error(`Live ${sport} feed invalid`);
   const match=matchPredictionMarketGame(current,{sport,awayTeam:selectedGame.awayTeam,homeTeam:selectedGame.homeTeam,gameStartAt:selectedGame.gameStartAt!,awayName:selectedGame.awayTeamDisplayName,homeName:selectedGame.homeTeamDisplayName});
   const selected={...current,rows:current.rows.filter(r=>r.eventTicker===match?.eventTicker)};
   const history=await backfillKalshiDisplayHistory(selected,Date.now());
   proof[sport]={book:book.feed,kalshi:history};
   console.log(JSON.stringify({liveProviderCheck:{sport,game:selectedGame.id,owlsRequests:book.requests+1,warnings:book.warnings,bookOpenings:book.feed.rows.map(r=>({event:r.event,kind:r.kind,book:r.book,opening:r.opening,quotes:r.quotes.length})),kalshi:history.rows.map(r=>({ticker:r.ticker,openedAt:r.marketOpenedAt,historyFrom:r.historyFrom,firstQuote:r.openingQuote,points:r.historicalCandles?.length}))}}));
  }
 }
 console.log(JSON.stringify({coverage:summary}));
 const output=process.argv.find(a=>a.startsWith("--output="))?.slice(9);if(output)writeFileSync(output,JSON.stringify({summary,proof}));
}
void main();
