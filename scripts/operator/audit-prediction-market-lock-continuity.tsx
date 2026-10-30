/** SELECT-only stored production replay. Zero provider calls or writes. */
import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {supabase} from "../../lib/db/supabase";
import {readPredictionMarketPrelock,type PrelockFeed} from "../../lib/providers/owls/predictionMarketPrelock";
import {readerHistoryContractSelection} from "../../lib/providers/owls/predictionMarketContracts";
import {predictionMarketComparison,predictionMarketHasSharedHistory,predictionMarketReaderBookTrail,predictionMarketArchivedBook,predictionMarketLockBoundary,selectedPredictionMarketOutcome} from "../../app/lab/lib/predictionMarketDisplay";
import {publicMarketDisplayBook,publicMarketPrelockHeldBook} from "../../app/lab/lib/publicMarketDisplayTrail";
import {PredictionMarketChart} from "../../app/lab/components/daily-edge/PredictionMarketPanel";
import type {PredictionMarketSport} from "../../lib/providers/owls/owlsPredictionMarkets";
import type {DailyEdgeGameDto} from "../../app/lab/lib/labTypes";

const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const unpack=(p:Record<string,unknown>)=>p?.encoding==="gzip-base64"?JSON.parse(gunzipSync(Buffer.from(p.payload as string,"base64"),{maxOutputLength:64_000_000}).toString()):p;
async function main(){
 const now=Date.now(),date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
 const summary=[];
 for(const sport of["cfb","nfl","nba","nhl","mlb","wnba","soccer","ucl"]as PredictionMarketSport[]){
  const query=supabase.from("lab_response_snapshots").select("snapshot_key,payload,generated_at");
  const result=sport==="cfb"||sport==="nfl"?await query.like("snapshot_key",`${sport}::daily-edge::2026::%`).order("generated_at",{ascending:false}).limit(1).maybeSingle():await query.eq("snapshot_key",sport==="soccer"?"soccer::english_premier_league::current-week":sport==="ucl"?"soccer::uefa_champions_league::current-week":`${sport}::${date}::current-only::live-copy`).maybeSingle();
  if(result.error)throw result.error;
  if(!result.data){summary.push({sport,snapshot:false});continue;}
  const p=unpack(result.data.payload),games=((p.fixture?.snapshot??p.snapshot??p).games??[])as DailyEdgeGameDto[];
  const stored=await supabase.from("lab_response_snapshots").select("payload").like("snapshot_key",`daily-edge::prediction-market-prelock::${sport}::%`).order("generated_at",{ascending:false}).limit(1).maybeSingle();
  if(stored.error)throw stored.error;
  const feed=stored.data?unpack(stored.data.payload)as PrelockFeed:null;
  const before=hash({games,feed}),checks=[];
  let locks=0,receipts=0,oldShared=0,newShared=0,recovered=0;
  for(const game of games){
   const boundary=predictionMarketLockBoundary(game,now);if(boundary===undefined)continue;locks++;
   for(const key of["moneyline","total","first_inning"]as const){
    const market=game.markets[key],selection=readerHistoryContractSelection(game,key),pick=market.pick?.replace(/\s+ML$/i,"").toUpperCase();
    const side=selection?.side??(pick===game.homeTeam?"home":pick===game.awayTeam?"away":pick==="DRAW"?"draw":null);
    if(!side)continue;
    const archive=readPredictionMarketPrelock(feed,game,selection?.kind??"moneyline",side,selection?.line??null,now);
    if(!archive?.market)continue;receipts++;
    const outcome=selectedPredictionMarketOutcome(archive.market,market.pick);if(!outcome)continue;
    const oldBook=predictionMarketReaderBookTrail(market,market.pick??"",boundary!,selection?.line??null);
    const legacy=predictionMarketArchivedBook(oldBook,archive.book,archive.capturedAt,boundary,selection?.line??null);
    const exact=publicMarketPrelockHeldBook(publicMarketDisplayBook(market),archive.capturedAt,boundary);
    const book=predictionMarketArchivedBook(exact,archive.book,archive.capturedAt,boundary,selection?.line??null);
    const old=predictionMarketComparison(outcome,legacy,boundary),next=predictionMarketComparison(outcome,book,boundary);
    const oldReady=predictionMarketHasSharedHistory(old),ready=predictionMarketHasSharedHistory(next);
    oldShared+=Number(oldReady);newShared+=Number(ready);recovered+=Number(!oldReady&&ready);
    if(oldReady)assert.ok(ready,`${game.id}/${key}: no loss of an existing shared graph`);
    if(ready){const html=renderToStaticMarkup(<PredictionMarketChart row={outcome} book={book} context={archive.market.context} bookLabel={selection?.label??pick??""} lockedAt={boundary}/>);
     assert.match(html,/data-kalshi-line=/);assert.match(html,/data-sportsbook-line=/);assert.doesNotMatch(html,/NaN|Infinity/);
    }
    if(game.external_id===458441||!oldReady&&ready)checks.push({game:game.id,key,pick:market.pick,line:market.line,boundary,prelockCapturedAt:archive.capturedAt,archiveBook:archive.book?.sportsbook,book:book?.sportsbook,storedPoints:book?.points.length,kalshiPoints:next.points.length,oldShared:oldReady,newShared:ready,chartStart:next.start,chartEnd:next.cutoff});
   }
  }
  assert.equal(hash({games,feed}),before,"all locked/member/source payloads remain byte-for-byte unchanged in replay");
  summary.push({sport,games:games.length,locks,receipts,oldShared,newShared,recovered,unchanged:true,hash:before,checks});
 }
 console.log(JSON.stringify({at:new Date(now).toISOString(),providerRequests:0,writes:0,summary},null,2));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
