/** Auxiliary DISPLAY receipts only. Never writes/reconstructs a member lock. */
import type {DailyEdgeGameDto} from "@/app/lab/lib/labTypes";
import {predictionMarketLockBoundary,selectedPredictionMarketOutcome,type PredictionMarketBookTrail} from "@/app/lab/lib/predictionMarketDisplay";
import {readerHistoryContractSelection,resolveReaderContract,type ContractFeed,type ReaderMarketMatch} from "./predictionMarketContracts";
import {matchPredictionMarketGame,type PredictionMarketFeed,type PredictionMarketSport} from "./owlsPredictionMarkets";
import {bookDisplayTrail,type BookDisplayFeed} from "./owlsBookDisplayHistory";
import {publicMarketDisplayBook,publicMarketDisplayHistory} from "@/app/lab/lib/publicMarketDisplayTrail";

export const PREDICTION_MARKET_PRELOCK_RELEASE="prediction_market_prelock_display_2026_10_29_r1";
type PrelockFrame={event:number;start:string;away:string;home:string;key:"moneyline"|"total"|"first_inning";pick:string;kind:string;side:string;line:number|null;capturedAt:number;market:ReaderMarketMatch|null;book:PredictionMarketBookTrail|null};
export type PrelockReceipt=PrelockFrame&{checkpoints?:PrelockFrame[]};
export type PrelockFeed={release:typeof PREDICTION_MARKET_PRELOCK_RELEASE;sport:PredictionMarketSport;rows:PrelockReceipt[]};
const identity=(r:Pick<PrelockReceipt,"event"|"start"|"key"|"pick"|"side"|"line">)=>JSON.stringify([r.event,Date.parse(r.start),r.key,r.pick,r.side,r.line]);

/** Same sole five-minute capture. No new upstream requests, no model input.
 * Only genuinely unlocked games may refresh a candidate; after lock the
 * prior pre-lock receipt is retained unchanged. Existing locks have no new
 * receipt and continue using their exact legacy display behavior. */
export function capturePredictionMarketPrelock(previous:PrelockFeed|null,games:DailyEdgeGameDto[],sport:PredictionMarketSport,winners:PredictionMarketFeed,contracts:ContractFeed[],books:BookDisplayFeed|null,now=Date.now()):PrelockFeed{
 const rows=new Map((previous?.rows??[]).filter(r=>Date.parse(r.start)>now-90*86_400_000).map(r=>[identity(r),r]));
 for(const game of games){
  if(game.lockState==="locked"||predictionMarketLockBoundary(game,now)!==undefined||Date.parse(game.gameStartAt??"")<=now)continue;
  const match=matchPredictionMarketGame(winners,{sport,awayTeam:game.awayTeam,homeTeam:game.homeTeam,gameStartAt:game.gameStartAt!,awayName:game.awayTeamDisplayName,homeName:game.homeTeamDisplayName},now);
  for(const key of ["moneyline","total","first_inning"] as const){
   const selection=readerHistoryContractSelection(game,key),pick=game.markets[key].pick??"",outcome=match?selectedPredictionMarketOutcome(match,pick):null;
   const label=pick.replace(/\s+ML$/i,"").trim().toUpperCase();
   const kind=key==="moneyline"?"moneyline":selection?.kind,side=selection?.side??outcome?.side??(label===game.homeTeam.toUpperCase()?"home":label===game.awayTeam.toUpperCase()?"away":label==="DRAW"?"draw":null);
   if(!kind||!side)continue;
   const line=selection?.line??null,market=selection?resolveReaderContract(contracts.find(c=>c.kind===selection.kind)??null,match,selection,now):match;
   const storedBook=publicMarketDisplayBook(game.markets[key]);
   const publishedBook=storedBook?.sportsbook??game.markets[key].movementReferenceSportsbook??game.markets[key].oddsTrail?.filter(s=>s.label==="current"&&s.sportsbook).sort((a,b)=>Date.parse(b.observedAt??"")-Date.parse(a.observedAt??""))[0]?.sportsbook;
   const candidates=books?.rows.filter(e=>e.event===game.external_id&&Date.parse(e.start)===Date.parse(game.gameStartAt!)&&e.away===game.awayTeam&&e.home===game.homeTeam&&e.kind===kind&&e.side===side&&Date.parse(e.checkedAt)<=now)??[];
   const entry=candidates.find(e=>e.book===publishedBook?.trim().toLowerCase())??(storedBook?undefined:candidates[0]);
   const history=entry?bookDisplayTrail(entry,storedBook?.line??line,now):null;
   // Capture the same book/threshold/endpoint users actually see, not an
   // independently ranked sharp source. Published observations work even
   // while optional provider backfill is unavailable or budget-deferred.
   const book=storedBook?publicMarketDisplayHistory(storedBook,history):history;
   if(!market&&!book)continue;
   const next:PrelockReceipt={event:game.external_id,start:game.gameStartAt!,away:game.awayTeam,home:game.homeTeam,key,pick,kind,side,line,capturedAt:now,market,book};
   const prior=rows.get(identity(next));
   // A transient missing source cannot erase a coherent pre-lock receipt.
   const frame=(r:PrelockReceipt):PrelockFrame=>{const {checkpoints:_,...value}=r;return value;};
   // Lock publication can lag its real timestamp. Preserve the first actual
   // receipt plus two recent checkpoints so stale unlocked publication cannot
   // overwrite the only provably pre-lock context. Never guess a T-60 lock.
   const priorFrames=prior?[...(prior.checkpoints??[]),frame(prior)]:[];
   const checkpoints=[...new Map(priorFrames.map(r=>[r.capturedAt,r])).values()].sort((a,b)=>a.capturedAt-b.capturedAt);
   const retained=checkpoints.length>3?[checkpoints[0],...checkpoints.slice(-2)]:checkpoints;
   rows.set(identity(next),{...next,market:market??prior?.market??null,book:book??prior?.book??null,...(retained.length?{checkpoints:retained}:{})});
  }
 }
 return {release:PREDICTION_MARKET_PRELOCK_RELEASE,sport,rows:[...rows.values()].sort((a,b)=>Date.parse(b.start)-Date.parse(a.start)).slice(0,450)};
}

export function readPredictionMarketPrelock(feed:PrelockFeed|null,game:DailyEdgeGameDto,kind:string,side:string,line:number|null,now=Date.now()):PrelockReceipt|null{
 const boundary=predictionMarketLockBoundary(game,now);
 if(boundary===undefined||!Number.isFinite(boundary))return null;
 const key=kind==="moneyline"?"moneyline":kind==="total"?"total":"first_inning";
 const row=feed?.rows.find(r=>r.event===game.external_id&&Date.parse(r.start)===Date.parse(game.gameStartAt??"")&&r.away===game.awayTeam&&r.home===game.homeTeam&&r.key===key&&r.kind===kind&&r.side===side&&r.line===line&&r.pick===(game.markets[key].pick??""));
 // It must actually have been captured before the authoritative boundary,
 // not retrospectively downloaded prices with old source timestamps.
 return row?[row,...(row.checkpoints??[])].filter(r=>r.capturedAt<=boundary).sort((a,b)=>b.capturedAt-a.capturedAt)[0]??null:null;
}
