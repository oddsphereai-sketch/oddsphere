import type {CbbGame,CbbQuote} from "@/lib/cbb/types";
import {cbbSplitOrientation} from "@/lib/cbb/exactSplitIdentity";
import {normalizeCbbOwlsCurrent,type CbbCurrentOddsRejection} from "@/lib/cbb/owlsMarketEvidence";
import type {RawOwlsOddsEvent} from "@/lib/providers/owls/owlsSharpBookOdds";

export const CBB_THE_ODDS_API_CURRENT_RELEASE="cbb_the_odds_api_current_2026_11_05_r1_exact_gap_capture" as const;
const BOOKS=["pinnacle","draftkings","fanduel","betmgm","betrivers","williamhill_us","bet365","bovada"];
const RESERVE=1000,CREDITS=3,MAX_BYTES=4_000_000,FIXTURE_TOLERANCE_MS=10*60_000;
const diagnosticText=(value:unknown,max:number)=>typeof value==="string"&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value:"";
const aliases:Record<string,string>={williamhill_us:"caesars"};
const int=(value:string|null)=>{const n=value===null?NaN:Number(value);return Number.isInteger(n)&&n>=0?n:null;};
export type CbbTheOddsApiReceipt={release:typeof CBB_THE_ODDS_API_CURRENT_RELEASE;status:"read"|"credit_reserve"|"quota_unavailable";
  requestedAt:string;availableAt:string;requests:number;paidRequests:number;creditsUsed:number;creditsRemaining:number|null;
  eventsReturned:number;unmatchedEventCount?:number;unmatchedEvents?:Array<{eventId:string;away:string;home:string;startsAt:string}>;quotes:CbbQuote[];rejections:Array<CbbCurrentOddsRejection&{gameId:number}>};
export function normalizeCbbTheOddsApiCurrent(games:CbbGame[],body:unknown,requestedAt:string,availableAt:string):Pick<CbbTheOddsApiReceipt,"eventsReturned"|"unmatchedEventCount"|"unmatchedEvents"|"quotes"|"rejections">{
 if(!Array.isArray(body))throw Error("CBB The Odds API response must be an event array");
 const events=body.filter((e):e is RawOwlsOddsEvent&{id:string;sport_key:string}=>!!e&&typeof e==="object"&&
   e.sport_key==="basketball_ncaab"&&typeof e.id==="string"&&!!e.id&&e.id.length<=256);
 const quotes:CbbQuote[]=[],rejections:Array<CbbCurrentOddsRejection&{gameId:number}>=[];
 const used=new Set<string>();
 for(const game of games){
  const own={homeTeamDisplayName:game.home_team.full_name,awayTeamDisplayName:game.visitor_team.full_name,cbbHomeCollege:game.home_team.college,cbbAwayCollege:game.visitor_team.college};
  const participants=events.filter(e=>typeof e.away_team==="string"&&typeof e.home_team==="string"&&cbbSplitOrientation(e.away_team??"",e.home_team??"",own)!==null);
  const matches=participants.filter(e=>typeof e.commence_time==="string"&&Number.isFinite(Date.parse(e.commence_time))&&Math.abs(Date.parse(e.commence_time!)-Date.parse(game.date))<=FIXTURE_TOLERANCE_MS);
  if(matches.length!==1||used.has(matches[0]?.id)){
   rejections.push({gameId:game.id,book:null,reason:matches.length===0?participants.length?"matching_schools_wrong_start":"exact_event_absent":"exact_event_ambiguous_or_reused"});continue;
  }
  const source=matches[0];used.add(source.id);
  const event={...source,sport:"ncaab",bookmakers:source.bookmakers?.filter(book=>BOOKS.includes(book.key??"")).map(book=>({...book,key:aliases[book.key??""]??book.key}))};
  const result=normalizeCbbOwlsCurrent(game,{success:true,data:[event]},availableAt,availableAt);
  // Same named-book validation, with actual transport origin retained. Never
  // relabel a The Odds API row as Owls merely because their JSON schemas agree.
  quotes.push(...result.quotes.map(q=>({...q,provider:"the_odds_api" as const,requestedAt,
    providerEventId:source.id})));
  rejections.push(...result.rejected.map(r=>({...r,gameId:game.id})));
  if(!result.quotes.length&&!result.rejected.length)rejections.push({gameId:game.id,book:null,reason:"no_complete_named_book_markets"});
 }
 const unmatched=events.filter(e=>!used.has(e.id));
 return {eventsReturned:body.length,quotes,rejections,unmatchedEventCount:unmatched.length,unmatchedEvents:unmatched.slice(0,20).map(e=>({
  eventId:diagnosticText(e.id,256),away:diagnosticText(e.away_team,160),home:diagnosticText(e.home_team,160),
  startsAt:diagnosticText(e.commence_time,64)}))};
}
// Whitelist only non-secret acquisition facts. The normal cron response body
// is not retained by refreshLogger; these receipts make ordinary cycles
// verifiable without another paid read or manual refresh.
function observed(receipt:CbbTheOddsApiReceipt):CbbTheOddsApiReceipt{
 const rejectionReasons:Record<string,number>={},rejectedGameIds:Record<string,number[]>={};
 for(const row of receipt.rejections){
  rejectionReasons[row.reason]=(rejectionReasons[row.reason]??0)+1;
  const ids=rejectedGameIds[row.reason]??=[];if(!ids.includes(row.gameId))ids.push(row.gameId);
 }
 console.info(`[cbb-source-receipt] ${JSON.stringify({release:receipt.release,provider:"the_odds_api",status:receipt.status,
   requestedAt:receipt.requestedAt,availableAt:receipt.availableAt,requests:receipt.requests,paidRequests:receipt.paidRequests,
   creditsUsed:receipt.creditsUsed,creditsRemaining:receipt.creditsRemaining,eventsReturned:receipt.eventsReturned,
   matchedGames:new Set(receipt.quotes.map(q=>q.gameId)).size,quoteGameIds:[...new Set(receipt.quotes.map(q=>q.gameId))],
   quotes:receipt.quotes.length,rejectionReasons,rejectedGameIds,unmatchedEventCount:receipt.unmatchedEventCount??0,
   unmatchedEventSample:(receipt.unmatchedEvents??[]).slice(0,20)})}`);
 return receipt;
}
function failed(stage:"quota"|"current",status:number|null,requests:number,creditsUsed:number|null,creditsRemaining:number|null){
 console.info(`[cbb-source-receipt] ${JSON.stringify({release:CBB_THE_ODDS_API_CURRENT_RELEASE,provider:"the_odds_api",
   status:"read_failed",stage,httpStatus:status,requests,creditsUsed,creditsRemaining})}`);
}
export async function fetchCbbTheOddsApiCurrent(args:{apiKey:string;games:CbbGame[];fetcher?:typeof fetch;now?:()=>string;onRequest?:(kind:"quota"|"current")=>void}):Promise<CbbTheOddsApiReceipt>{
 if(!args.apiKey.trim()||!args.games.length)throw Error("CBB The Odds API requires a configured key and actual gap fixtures");
 const fetcher=args.fetcher??fetch,now=args.now??(()=>new Date().toISOString());
 const requestedAt=now(),base="https://api.the-odds-api.com/v4";
 const url=(path:string)=>{const value=new URL(`${base}/${path}`);value.searchParams.set("apiKey",args.apiKey);return value;};
 // One quota-free request and at most one current-board request per existing
 // leased refresh. No per-game polling, retries or historical requests.
 args.onRequest?.("quota");
 let quota:Response;try{quota=await fetcher(url("sports"),{cache:"no-store",signal:AbortSignal.timeout(8000)});}
 catch{failed("quota",null,1,null,null);throw Error("CBB The Odds API quota request failed");}
 if(!quota.ok){failed("quota",quota.status,1,int(quota.headers.get("x-requests-last")),int(quota.headers.get("x-requests-remaining")));throw Error(`CBB The Odds API quota read failed (${quota.status})`);}
 const remaining=int(quota.headers.get("x-requests-remaining"));
 const receipt:CbbTheOddsApiReceipt={release:CBB_THE_ODDS_API_CURRENT_RELEASE,status:"read",requestedAt,availableAt:now(),requests:1,paidRequests:0,
   creditsUsed:0,creditsRemaining:remaining,eventsReturned:0,quotes:[],rejections:[]};
 if(remaining===null||remaining<RESERVE+CREDITS)return observed({...receipt,status:remaining===null?"quota_unavailable":"credit_reserve"});
 const current=url("sports/basketball_ncaab/odds");
 current.searchParams.set("bookmakers",BOOKS.join(","));current.searchParams.set("markets","h2h,spreads,totals");
 current.searchParams.set("oddsFormat","american");current.searchParams.set("dateFormat","iso");
 const starts=args.games.map(g=>Date.parse(g.date));
 if(starts.some(t=>!Number.isFinite(t)))throw Error("CBB The Odds API gap fixture time invalid");
 current.searchParams.set("commenceTimeFrom",new Date(Math.min(...starts)-FIXTURE_TOLERANCE_MS).toISOString().replace(/\.\d{3}Z$/,"Z"));
 current.searchParams.set("commenceTimeTo",new Date(Math.max(...starts)+FIXTURE_TOLERANCE_MS).toISOString().replace(/\.\d{3}Z$/,"Z"));
 let response:Response;
 const currentRequestedAt=now();
 args.onRequest?.("current");
 try{response=await fetcher(current,{cache:"no-store",headers:{accept:"application/json"},signal:AbortSignal.timeout(10000)});}
 catch{failed("current",null,2,null,remaining);throw Error("CBB The Odds API current-board request failed");}
 if(!response.ok){failed("current",response.status,2,int(response.headers.get("x-requests-last")),int(response.headers.get("x-requests-remaining")));throw Error(`CBB The Odds API current-board read failed (${response.status})`);}
 try{
 const declared=Number(response.headers.get("content-length"));if(Number.isFinite(declared)&&declared>MAX_BYTES)throw Error("CBB The Odds API current-board byte budget exceeded");
 const raw=await response.text();if(Buffer.byteLength(raw)>MAX_BYTES)throw Error("CBB The Odds API current-board byte budget exceeded");
 let body:unknown;try{body=JSON.parse(raw);}catch{throw Error("CBB The Odds API current-board JSON invalid");}
 const availableAt=now();
 return observed({...receipt,...normalizeCbbTheOddsApiCurrent(args.games,body,currentRequestedAt,availableAt),requestedAt:currentRequestedAt,availableAt,requests:2,paidRequests:1,
   creditsUsed:int(response.headers.get("x-requests-last"))??CREDITS,creditsRemaining:int(response.headers.get("x-requests-remaining"))});
 }catch(error){failed("current",response.status,2,int(response.headers.get("x-requests-last")),int(response.headers.get("x-requests-remaining")));throw error;}
}
