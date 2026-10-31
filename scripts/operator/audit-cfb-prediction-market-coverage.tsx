/** SELECT-only coverage/render proof. --live uses the normal existing beta
 * login then bounded member-API GETs. No provider/model calls, cron triggers,
 * product-data writes or credential/cookie output. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {supabase} from "../../lib/db/supabase";
import type {DailyEdgeGameDto} from "../../app/lab/lib/labTypes";
import {matchPredictionMarketGame,type PredictionMarketFeed} from "../../lib/providers/owls/owlsPredictionMarkets";
import {readerHistoryContractSelection,resolveReaderContract,type ContractFeed,type ReaderMarketMatch} from "../../lib/providers/owls/predictionMarketContracts";
import {readPredictionMarketPrelock,type PrelockFeed} from "../../lib/providers/owls/predictionMarketPrelock";
import {recoverCfbHistoricalChart} from "../../lib/providers/owls/cfbHistoricalChart";
import {marketDisplayGameIdentity} from "../../lib/cbb/marketDisplayIdentity";
import {predictionMarketLockBoundary,predictionMarketVisibleComparison,selectedPredictionMarketOutcome,type PredictionMarketBookTrail} from "../../app/lab/lib/predictionMarketDisplay";
import {publicMarketDisplayBook,publicMarketPrelockHeldBook} from "../../app/lab/lib/publicMarketDisplayTrail";
import {PredictionMarketChart} from "../../app/lab/components/daily-edge/PredictionMarketPanel";

const et=(d:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(d);
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const unpack=(p:Record<string,unknown>)=>p?.encoding==="gzip-base64"?JSON.parse(gunzipSync(Buffer.from(p.payload as string,"base64"),{maxOutputLength:64_000_000}).toString()):p;
async function main(){
 if(process.argv.includes("--write"))throw new Error("Read-only audit");
 const date=process.argv.find(a=>a.startsWith("--date="))?.slice(7)??et(new Date());
 const now=Date.now(),live=process.argv.includes("--live");
 let cookie:string|undefined;
 if(live){
  if(!process.env.LAB_BETA_PASSWORD)throw new Error("Live member audit requires the configured beta login credential");
  const login=await fetch("https://www.oddsphereai.com/api/auth/login",{method:"POST",redirect:"manual",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:process.env.LAB_BETA_PASSWORD,next:"/lab/daily-edge?sport=cfb"}),signal:AbortSignal.timeout(12_000)});
  cookie=login.headers.get("set-cookie")?.split(";")[0];
  if(login.status!==303||!cookie)throw new Error("Ordinary member audit login failed; no API coverage claims are valid");
 }
 const [board,sources,locks]=await Promise.all([
  supabase.from("lab_response_snapshots").select("snapshot_key,payload,generated_at").like("snapshot_key","cfb::daily-edge::2026::%").order("generated_at",{ascending:false}).limit(1).single(),
  supabase.from("lab_response_snapshots").select("snapshot_key,payload,generated_at").like("snapshot_key","daily-edge::prediction-market%::cfb::%"),
  supabase.from("prediction_records").select("*").eq("sport","cfb").not("locked_at","is",null).gte("game_date","2026-10-27").order("id").limit(1000),
 ]);
 if(board.error||sources.error||locks.error)throw board.error??sources.error??locks.error;
 const raw=unpack(board.data.payload),games=((raw.fixture?.snapshot??raw.snapshot??raw).games??[])as DailyEdgeGameDto[];
 const feeds=sources.data!.map(s=>({...s,payload:unpack(s.payload)}));
 const winners=feeds.find(s=>s.snapshot_key.includes("::prediction-market-display::"))?.payload as PredictionMarketFeed??null;
 const archive=feeds.find(s=>s.snapshot_key.includes("::prediction-market-prelock::"))?.payload as PrelockFeed??null;
 const before=hash({games,feeds}),jobs=games.filter(g=>g.gameStartAt&&et(new Date(g.gameStartAt))===date).flatMap(game=>(["moneyline","total","first_inning"]as const).map(key=>({game,key})));
 const rows:Array<Record<string,unknown>>=[];let cursor=0;
 const worker=async()=>{while(cursor<jobs.length){
  const {game,key}=jobs[cursor++],selection=readerHistoryContractSelection(game,key),kind=key==="moneyline"?"moneyline":selection?.kind;
  const pick=game.markets[key].pick,side=selection?.side??(pick?.replace(/\s+ML$/i,"").toUpperCase()===game.awayTeam?"away":"home");
  const boundary=predictionMarketLockBoundary(game,now),contracts=feeds.find(f=>f.snapshot_key.includes(`::${kind}::`))?.payload as ContractFeed??null;
  const match=matchPredictionMarketGame(winners,marketDisplayGameIdentity(game,"cfb"),now);
  const receipt=boundary!==undefined&&kind?readPredictionMarketPrelock(archive,game,kind,side,selection?.line??null,now):null;
  const recovery=kind?recoverCfbHistoricalChart(game,kind,side,selection?.line??null,winners,contracts,now):null;
  let market:ReaderMarketMatch|null=receipt?.market??recovery?.market??(selection?resolveReaderContract(contracts,match,selection,now):match);
  const tracker=publicMarketDisplayBook(game.markets[key]);
  let book:PredictionMarketBookTrail|null=receipt?.market?publicMarketPrelockHeldBook(tracker,receipt.capturedAt,boundary):recovery?.book??tracker;
  let availability=market?"available":"source_or_selection_unavailable",http:number|undefined,release:string|null=null;
  if(live&&kind){
   const query=new URLSearchParams({sport:"cfb",away:game.awayTeam,home:game.homeTeam,start:game.gameStartAt!,market:kind,event:String(game.external_id),display:"public-tracker-v1",side});
   if(selection?.line!==null&&selection?.line!==undefined)query.set("line",String(selection.line));
   if(game.awayTeamDisplayName)query.set("awayName",game.awayTeamDisplayName);if(game.homeTeamDisplayName)query.set("homeName",game.homeTeamDisplayName);
   try{const response=await fetch("https://www.oddsphereai.com/api/lab/prediction-market?"+query,{headers:cookie?{Cookie:cookie}:{},signal:AbortSignal.timeout(12_000)});
    http=response.status;release=response.headers.get("X-CFB-Chart-Continuity");const body=await response.json();market=body.market;book=body.book;availability=body.availability;
   }catch{market=null;book=null;availability="request_failed";}
  }
  const outcome=market?selectedPredictionMarketOutcome(market,pick):null;
  const visible=outcome?predictionMarketVisibleComparison(outcome,book,boundary,true):null;
  const html=outcome&&visible&&visible.comparison.points.length>=2?renderToStaticMarkup(<PredictionMarketChart row={outcome} book={visible.book} context={market?.context} bookLabel={outcome.label} lockedAt={boundary}/>):"";
  assert.doesNotMatch(html,/NaN|Infinity/,`${game.id}/${key}`);
  if(boundary!==undefined)assert.ok(visible?.comparison.points.every(p=>p[0]<=boundary)??true,"no post-lock quotes");
  rows.push({event:game.external_id,game:game.awayTeam+"@"+game.homeTeam,key,kind,pick,line:selection?.line??null,scope:game.collegeFootballScope,locked:boundary!==undefined,http,availability,release,kalshi:html.includes("data-kalshi-line="),sportsbook:html.includes("data-sportsbook-line="),points:visible?.comparison.points.length??0});
 }};
 await Promise.all(Array.from({length:live?3:1},()=>worker()));
 assert.equal(hash({games,feeds}),before,"member and source payloads remain unchanged");
 console.log(JSON.stringify({at:new Date(now).toISOString(),date,live,board:{key:board.data.snapshot_key,at:board.data.generated_at,games:games.length},markets:rows.length,kalshi:rows.filter(r=>r.kalshi).length,paired:rows.filter(r=>r.sportsbook).length,missing:rows.filter(r=>!r.kalshi),unchanged:true,inputHash:before,lockedHashes:locks.data?.map(r=>({id:r.id,hash:hash(r)})),rows}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
