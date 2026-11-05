import type {CbbGame,CbbQuote} from "@/lib/cbb/types";
import {cbbSplitOrientation} from "@/lib/cbb/exactSplitIdentity";
import {normalizeCbbOwlsCurrent,type CbbCurrentOddsRejection} from "@/lib/cbb/owlsMarketEvidence";
import type {RawOwlsOddsEvent} from "@/lib/providers/owls/owlsSharpBookOdds";

export const CBB_THE_ODDS_API_CURRENT_RELEASE="cbb_the_odds_api_current_2026_11_05_r1_exact_gap_capture" as const;
const BOOKS=["pinnacle","draftkings","fanduel","betmgm","betrivers","williamhill_us","bet365","bovada"];
const RESERVE=1000,CREDITS=3,MAX_BYTES=4_000_000;
const aliases:Record<string,string>={williamhill_us:"caesars"};
const int=(value:string|null)=>{const n=value===null?NaN:Number(value);return Number.isInteger(n)&&n>=0?n:null;};
export type CbbTheOddsApiReceipt={release:typeof CBB_THE_ODDS_API_CURRENT_RELEASE;status:"read"|"credit_reserve"|"quota_unavailable";
  requestedAt:string;availableAt:string;requests:number;paidRequests:number;creditsUsed:number;creditsRemaining:number|null;
  eventsReturned:number;quotes:CbbQuote[];rejections:Array<CbbCurrentOddsRejection&{gameId:number}>};
export function normalizeCbbTheOddsApiCurrent(games:CbbGame[],body:unknown,requestedAt:string,availableAt:string):Pick<CbbTheOddsApiReceipt,"eventsReturned"|"quotes"|"rejections">{
 if(!Array.isArray(body))throw Error("CBB The Odds API response must be an event array");
 const events=body.filter((e):e is RawOwlsOddsEvent&{id:string;sport_key:string}=>!!e&&typeof e==="object"&&
   e.sport_key==="basketball_ncaab"&&typeof e.id==="string"&&!!e.id);
 const quotes:CbbQuote[]=[],rejections:Array<CbbCurrentOddsRejection&{gameId:number}>=[];
 const used=new Set<string>();
 for(const game of games){
  const own={homeTeamDisplayName:game.home_team.full_name,awayTeamDisplayName:game.visitor_team.full_name,cbbHomeCollege:game.home_team.college,cbbAwayCollege:game.visitor_team.college};
  const participants=events.filter(e=>cbbSplitOrientation(e.away_team??"",e.home_team??"",own)!==null);
  const matches=participants.filter(e=>Number.isFinite(Date.parse(e.commence_time??""))&&Math.abs(Date.parse(e.commence_time!)-Date.parse(game.date))<=600000);
  if(matches.length!==1||used.has(matches[0]?.id)){
   rejections.push({gameId:game.id,book:null,reason:matches.length===0?participants.length?"matching_schools_wrong_start":"exact_event_absent":"exact_event_ambiguous_or_reused"});continue;
  }
  const source=matches[0];used.add(source.id);
  const event={...source,sport:"ncaab",bookmakers:source.bookmakers?.map(book=>({...book,key:aliases[book.key??""]??book.key}))};
  const result=normalizeCbbOwlsCurrent(game,{success:true,data:[event]},availableAt,availableAt);
  // Same named-book validation, with actual transport origin retained. Never
  // relabel a The Odds API row as Owls merely because their JSON schemas agree.
  quotes.push(...result.quotes.map(q=>({...q,provider:"the_odds_api" as const,requestedAt,
    providerEventId:source.id})));
  rejections.push(...result.rejected.map(r=>({...r,gameId:game.id})));
  if(!result.quotes.length&&!result.rejected.length)rejections.push({gameId:game.id,book:null,reason:"no_complete_named_book_markets"});
 }
 return {eventsReturned:body.length,quotes,rejections};
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
 catch{throw Error("CBB The Odds API quota request failed");}
 if(!quota.ok)throw Error(`CBB The Odds API quota read failed (${quota.status})`);
 const remaining=int(quota.headers.get("x-requests-remaining"));
 const receipt:CbbTheOddsApiReceipt={release:CBB_THE_ODDS_API_CURRENT_RELEASE,status:"read",requestedAt,availableAt:now(),requests:1,paidRequests:0,
   creditsUsed:0,creditsRemaining:remaining,eventsReturned:0,quotes:[],rejections:[]};
 if(remaining===null||remaining<RESERVE+CREDITS)return {...receipt,status:remaining===null?"quota_unavailable":"credit_reserve"};
 const current=url("sports/basketball_ncaab/odds");
 current.searchParams.set("bookmakers",BOOKS.join(","));current.searchParams.set("markets","h2h,spreads,totals");
 current.searchParams.set("oddsFormat","american");current.searchParams.set("dateFormat","iso");
 const starts=args.games.map(g=>Date.parse(g.date));
 if(starts.some(t=>!Number.isFinite(t)))throw Error("CBB The Odds API gap fixture time invalid");
 current.searchParams.set("commenceTimeFrom",new Date(Math.min(...starts)).toISOString().replace(/\.\d{3}Z$/,"Z"));
 current.searchParams.set("commenceTimeTo",new Date(Math.max(...starts)).toISOString().replace(/\.\d{3}Z$/,"Z"));
 let response:Response;
 const currentRequestedAt=now();
 args.onRequest?.("current");
 try{response=await fetcher(current,{cache:"no-store",headers:{accept:"application/json"},signal:AbortSignal.timeout(10000)});}
 catch{throw Error("CBB The Odds API current-board request failed");}
 if(!response.ok)throw Error(`CBB The Odds API current-board read failed (${response.status})`);
 const declared=Number(response.headers.get("content-length"));if(Number.isFinite(declared)&&declared>MAX_BYTES)throw Error("CBB The Odds API current-board byte budget exceeded");
 const raw=await response.text();if(Buffer.byteLength(raw)>MAX_BYTES)throw Error("CBB The Odds API current-board byte budget exceeded");
 let body:unknown;try{body=JSON.parse(raw);}catch{throw Error("CBB The Odds API current-board JSON invalid");}
 const availableAt=now();
 return {...receipt,...normalizeCbbTheOddsApiCurrent(args.games,body,currentRequestedAt,availableAt),requestedAt:currentRequestedAt,availableAt,requests:2,paidRequests:1,
   creditsUsed:int(response.headers.get("x-requests-last"))??CREDITS,creditsRemaining:int(response.headers.get("x-requests-remaining"))};
}
