/** Display-only provider history. This module has no prediction/lock writers. */
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import type { PredictionMarketBookTrail } from "@/app/lab/lib/predictionMarketDisplay";
import { predictionMarketTeamMatches, type PredictionMarketSport } from "./owlsPredictionMarkets";
import { readerHistoryContractSelection } from "./predictionMarketContracts";
import { publicMarketDisplayBook } from "@/app/lab/lib/publicMarketDisplayTrail";
import { bookPriorityRank } from "@/lib/config/bookPriority";
import { isBlockedSportsbook } from "@/lib/config/blockedSportsbooks";
import { OwlsInsightClient, type OwlsSport } from "./owlsInsightClient";
import type { RawOwlsOddsEvent, RawOwlsOddsResponse } from "./owlsSharpBookOdds";
import {nflProviderTeamMatches} from "@/lib/services/football/sharpApiNflSplits";
import type { PrelockFeed } from "./predictionMarketPrelock";
import { CBB_MARKET_TRACKING_RELEASE } from "@/lib/cbb/marketDisplayIdentity";

export const BOOK_DISPLAY_HISTORY_RELEASE="owls_book_display_history_2026_10_29_r1";
type Quote=[number,number,number|null]; // original epoch, American price, point line
export type BookDisplayEntry={event:number;start:string;away:string;home:string;kind:string;side:string;book:string;providerEventId:string;checkedAt:string;opening:Quote|null;quotes:Quote[];observedQuotes?:true};
export type BookDisplayFeed={release:typeof BOOK_DISPLAY_HISTORY_RELEASE;sport:PredictionMarketSport;fetchedAt:string;eventsAt:string;events:RawOwlsOddsEvent[];rows:BookDisplayEntry[];budget?:{day:string;history:number;discovery:number};cbbTrackingRelease?:typeof CBB_MARKET_TRACKING_RELEASE};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const number=(v:unknown):number|null=>v===null||v===undefined||v===""||typeof v==="boolean"||!Number.isFinite(Number(v))?null:Number(v);
const implied=(a:number)=>a>0?100/(100+a):-a/(100-a);
const marketKey=(kind:string)=>kind==="moneyline"?"h2h":kind==="spread"?"spreads":kind==="total"?"totals":"btts";
const identity=(e:Pick<BookDisplayEntry,"event"|"start"|"kind"|"side"|"book">)=>[e.event,Date.parse(e.start),e.kind,e.side,e.book].join("|");

export function matchOwlsDisplayEvent(events:RawOwlsOddsEvent[],game:DailyEdgeGameDto,sport:PredictionMarketSport):RawOwlsOddsEvent|null{
  const matchesTeam=(name:string,abbreviation:string,displayName:string|null|undefined,college?:string|null)=>sport==="nfl"?nflProviderTeamMatches(name,abbreviation,displayName??abbreviation):predictionMarketTeamMatches({sideCode:name,team:name},abbreviation,displayName,sport,college);
  const matches=events.filter(e=>typeof e.eventId==="string"&&Math.abs(Date.parse(e.commence_time??"")-Date.parse(game.gameStartAt??""))<=60*60_000&&
    (matchesTeam(e.away_team??"",game.awayTeam,game.awayTeamDisplayName,game.cbbAwayCollege)&&matchesTeam(e.home_team??"",game.homeTeam,game.homeTeamDisplayName,game.cbbHomeCollege)||
     sport==="cbb"&&matchesTeam(e.home_team??"",game.awayTeam,game.awayTeamDisplayName,game.cbbAwayCollege)&&matchesTeam(e.away_team??"",game.homeTeam,game.homeTeamDisplayName,game.cbbHomeCollege)));
  return matches.length===1?matches[0]:null;
}

/** OWLS occasionally reverses neutral-site CBB home/away. Stored reader sides
 * always follow the canonical board; only the provider request is reversed. */
export function owlsDisplayProviderSide(event:RawOwlsOddsEvent,game:DailyEdgeGameDto,side:string,sport:PredictionMarketSport):string{
  if(sport!=="cbb"||side!=="home"&&side!=="away")return side;
  const reversed=predictionMarketTeamMatches({sideCode:event.home_team??"",team:event.home_team??""},game.awayTeam,game.awayTeamDisplayName,sport,game.cbbAwayCollege)&&
    predictionMarketTeamMatches({sideCode:event.away_team??"",team:event.away_team??""},game.homeTeam,game.homeTeamDisplayName,sport,game.cbbHomeCollege);
  return reversed?(side==="home"?"away":"home"):side;
}

/** The response must explicitly be the requested opening-mode event/book/side.
 * Never use another threshold's opener as the price opener of the selected line. */
export function parseOwlsBookDisplayHistory(value:unknown,target:Omit<BookDisplayEntry,"checkedAt"|"opening"|"quotes">,now=Date.now()):BookDisplayEntry|null{
  const body=object(value),data=object(body?.data),range=object(data?.timeRange);
  if(body?.success!==true||data?.eventId!==target.providerEventId||data?.book!==target.book||data?.market!==marketKey(target.kind)||data?.side!==target.side||range?.mode!=="opening"||!Array.isArray(data?.history)||data.history.length>20_000)return null;
  const quote=(v:unknown):Quote|null=>{
    const r=object(v),at=Date.parse(String(r?.timestampUtc??"")),price=number(r?.price),line=target.kind==="moneyline"||target.kind==="btts"?null:number(r?.point??r?.pointValue);
    return Number.isFinite(at)&&at<=now&&price!==null&&Math.abs(price)>=100&&Math.abs(price)<9900&&((target.kind==="moneyline"||target.kind==="btts")||line!==null)?[at,price,line]:null;
  };
  const quotes=data.history.flatMap(v=>{const p=quote(v);return p?[p]:[];}).sort((a,b)=>a[0]-b[0]);
  const opening=quote(data.openingLine);
  // A valid explicitly reported opener is retained separately even if the
  // sampled plot later needs fewer points or a different point line.
  return {...target,checkedAt:new Date(now).toISOString(),opening,quotes:boundBookQuotes([...(opening?[opening]:[]),...quotes])};
}
function boundBookQuotes(quotes:Quote[]):Quote[]{
  const ordered=[...new Map(quotes.map(q=>[q[0]+"|"+q[2],q])).values()].sort((a,b)=>a[0]-b[0]);
  if(ordered.length<=128)return ordered;
  const selected=new Set([0,ordered.length-1]);
  // Preserve real price/point extrema and both sides of line transitions.
  let min=0,max=0;for(let i=1;i<ordered.length;i++){if(ordered[i][1]<ordered[min][1])min=i;if(ordered[i][1]>ordered[max][1])max=i;}
  selected.add(min);selected.add(max);
  for(let i=1;i<ordered.length&&selected.size<64;i++)if(ordered[i][2]!==ordered[i-1][2]){selected.add(i-1);selected.add(i);}
  for(let i=0;i<128&&selected.size<128;i++)selected.add(Math.round(i*(ordered.length-1)/127));
  return [...selected].sort((a,b)=>a-b).map(i=>ordered[i]);
}
export function bookDisplayTrail(entry:BookDisplayEntry,line:number|null,ceiling=Date.now()):PredictionMarketBookTrail|null{
  const points=entry.quotes.filter(q=>q[2]===line&&q[0]<=ceiling).map(q=>[q[0],implied(q[1]),q[1]] as [number,number,number]);
  if(!points.length)return null;
  return {sportsbook:entry.book,line,points,locked:false,...bookDisplayContext(entry,ceiling)};
}
export function bookDisplayContext(entry:BookDisplayEntry,ceiling=Date.now()):Pick<PredictionMarketBookTrail,"historyScope"|"opening"|"marketHistory">{
  return {historyScope:entry.observedQuotes?"observed_quotes":"provider_history",marketHistory:entry.quotes.filter(q=>q[0]<=ceiling),
    ...(entry.opening&&entry.opening[0]<=ceiling?{opening:{point:[entry.opening[0],implied(entry.opening[1]),entry.opening[1]],line:entry.opening[2]}}:{})};
}
export function isBookDisplayFeed(value:unknown,sport:PredictionMarketSport):value is BookDisplayFeed{
  const v=object(value);return v?.release===BOOK_DISPLAY_HISTORY_RELEASE&&v.sport===sport&&Array.isArray(v.events)&&v.events.length<=500&&Array.isArray(v.rows)&&v.rows.length<=(sport==="cbb"?3000:450)&&typeof v.eventsAt==="string"&&v.rows.every(r=>{
    const e=object(r);return e&&Number.isSafeInteger(e.event)&&typeof e.start==="string"&&typeof e.checkedAt==="string"&&typeof e.book==="string"&&Array.isArray(e.quotes)&&e.quotes.length<=128;
  });
}

/** Retain real writer observations and already-captured display receipts even
 * when optional history downloads are budget-deferred. No timestamps/openers
 * are invented, and no locked game is read back into a new interpretation. */
export function accumulateCbbPublishedQuotes(feed:BookDisplayFeed,games:DailyEdgeGameDto[],archive:PrelockFeed|null,now=Date.now()):BookDisplayFeed{
  if(feed.sport!=="cbb")return feed;
  const rows=new Map(feed.rows.map(row=>[identity(row),row]));
  for(const game of games){
    const start=Date.parse(game.gameStartAt??"");
    if(game.sport!=="cbb"||game.lockState!=="open"||game.lockedAt!==null||!Number.isFinite(start)||start<=now)continue;
    const event=matchOwlsDisplayEvent(feed.events,game,"cbb");
    const append=(kind:string,side:string,book:string,points:Quote[],ceiling:number)=>{
      if(!["moneyline","spread","total"].includes(kind)||!(kind==="total"?["over","under"]:["away","home"]).includes(side)||
        !book||isBlockedSportsbook(book)||!Number.isFinite(ceiling)||ceiling>now)return;
      const target={event:game.external_id,start:game.gameStartAt!,away:game.awayTeam,home:game.homeTeam,kind,side,book,
        providerEventId:event?.eventId??`published:${game.external_id}`};
      const old=rows.get(identity(target));
      const valid=points.filter(q=>Number.isFinite(q[0])&&q[0]<=ceiling&&q[0]<start&&Number.isFinite(q[1])&&Math.abs(q[1])>=100&&Math.abs(q[1])<9900&&
        (kind==="moneyline"?q[2]===null:q[2]!==null&&Number.isFinite(q[2])));
      if(!valid.length)return;
      // Existing exact observations win any timestamp tie, including a conflict.
      rows.set(identity(target),{...target,checkedAt:old?.checkedAt??"1970-01-01T00:00:00.000Z",opening:old?.opening??null,
        quotes:boundBookQuotes([...valid,...(old?.quotes??[])]),...(old?.observedQuotes||!old?{observedQuotes:true as const}:{})});
    };
    for(const receipt of archive?.sport==="cbb"?archive.rows:[]){
      if(receipt.event!==game.external_id||Date.parse(receipt.start)!==start||receipt.away!==game.awayTeam||receipt.home!==game.homeTeam)continue;
      for(const frame of [...(receipt.checkpoints??[]),receipt]){
        if(frame.event!==game.external_id||Date.parse(frame.start)!==start||frame.away!==game.awayTeam||frame.home!==game.homeTeam||!frame.book||frame.capturedAt>now||frame.capturedAt>=start)continue;
        append(frame.kind,frame.side,frame.book.sportsbook,frame.book.marketHistory??frame.book.points.map(p=>[p[0],p[2],frame.book!.line??frame.line]),frame.capturedAt);
      }
    }
    for(const key of ["moneyline","total","first_inning"] as const){
      const market=game.markets[key],selection=readerHistoryContractSelection(game,key),pick=market.pick?.replace(/\s+ML$/i,"").trim().toUpperCase();
      const kind=key==="moneyline"?"moneyline":selection?.kind,side=selection?.side??(pick===game.awayTeam?"away":pick===game.homeTeam?"home":null);
      if(!kind||!side)continue;
      const capture=(capturedSide:string,stops:NonNullable<typeof market.oddsTrail>)=>{
        for(const book of new Set(stops.flatMap(stop=>stop.sportsbook?[stop.sportsbook]:[])))
          append(kind,capturedSide,book,stops.filter(stop=>stop.sportsbook===book).map(stop=>[Date.parse(stop.observedAt??""),stop.american,stop.line]),now);
      };
      capture(side,[...(market.lineTrail??[]),...(market.oddsTrail??[])]);
      const other=kind==="total"?(side==="over"?"under":"over"):(side==="home"?"away":"home");
      if(market.opposingOddsTrail?.side===other)capture(other,market.opposingOddsTrail.stops);
    }
  }
  const captured=[...rows.values()].sort((a,b)=>a.start.localeCompare(b.start));
  if(captured.length>3000)throw new Error("CBB observed history exceeds bounded capacity; retaining prior feed");
  return {...feed,cbbTrackingRelease:CBB_MARKET_TRACKING_RELEASE,rows:captured};
}

/** <=1 cached discovery + <=3 history requests/sport/cycle; <=12 discovery and
 * <=48 history requests/sport/day. Openers persist; current quotes already
 * come from the canonical tape, so full history need only refresh daily. */
export async function captureOwlsBookDisplayHistory(previous:BookDisplayFeed|null,games:DailyEdgeGameDto[],sport:PredictionMarketSport,client:OwlsInsightClient,now=Date.now(),remainingMonth:number|null=null,archive:PrelockFeed|null=null):Promise<{feed:BookDisplayFeed;requests:number;warnings:string[]}>{
  const active=games.filter(g=>g.lockState!=="locked"&&Date.parse(g.gameStartAt??"")>now&&Date.parse(g.gameStartAt??"")<now+8*86_400_000);
  let events=previous?.events??[],eventsAt=previous?.eventsAt??"1970-01-01",requests=0;const warnings:string[]=[];
  const day=new Date(now).toISOString().slice(0,10),budget=previous?.budget?.day===day?{...previous.budget}:{day,history:0,discovery:0};
  const reserve=()=>remainingMonth!==null&&remainingMonth<=50_000;
  if(active.length&&(!events.length||now-Date.parse(eventsAt)>2*60*60_000)&&budget.discovery<12&&!reserve()){
    budget.discovery++;
    requests++;
    try{const result=await client.odds<RawOwlsOddsResponse>((sport==="cfb"?"ncaaf":sport==="cbb"?"ncaab":sport==="ucl"?"soccer":sport) as OwlsSport);remainingMonth=result.rateLimit.remainingMonth??remainingMonth;const data=result.body.data;
      if(result.body.success===true&&data){
        const grouped=new Map<string,RawOwlsOddsEvent>();
        for(const e of Array.isArray(data)?data:Object.values(data).flatMap(v=>Array.isArray(v)?v:[]))if(typeof e.eventId==="string"){
          const old=grouped.get(e.eventId),books=new Map([...(old?.bookmakers??[]),...(e.bookmakers??[])].map(b=>[b.key,{key:b.key,last_update:b.last_update,markets:(b.markets??[]).filter(m=>["h2h","spreads","totals","btts"].includes(m.key??"")).map(m=>({key:m.key}))}]));
          grouped.set(e.eventId,{eventId:e.eventId,home_team:e.home_team,away_team:e.away_team,commence_time:e.commence_time,bookmakers:[...books.values()]});
        }
        events=[...grouped.values()].slice(0,500);eventsAt=new Date(now).toISOString();
      }
      else warnings.push("book history: discovery unavailable; retained");
    }catch{warnings.push("book history: discovery unavailable; retained");}
  }
  const observed=accumulateCbbPublishedQuotes({release:BOOK_DISPLAY_HISTORY_RELEASE,sport,fetchedAt:new Date(now).toISOString(),eventsAt,events,rows:previous?.rows??[],budget},games,archive,now);
  const rows=new Map(observed.rows.filter(e=>Date.parse(e.start)>now-86_400_000).map(e=>[identity(e),e]));
  const targets:Array<Omit<BookDisplayEntry,"opening"|"quotes"|"checkedAt">>=[];
  const providerSides=new Map<string,string>();
  const publicTargets=new Set<string>();
  for(const game of active){
    const event=matchOwlsDisplayEvent(events,game,sport);if(!event?.eventId)continue;
    for(const key of ["moneyline","total","first_inning"] as const){
      const selection=readerHistoryContractSelection(game,key),pick=game.markets[key].pick?.replace(/\s+ML$/i,"").trim().toUpperCase();
      const kind=key==="moneyline"?"moneyline":selection?.kind,side=selection?.side??(pick===game.awayTeam.toUpperCase()?"away":pick===game.homeTeam.toUpperCase()?"home":pick==="DRAW"?"draw":null);
      if(!kind||!side)continue;
      const rank=(book:string)=>book==="circa"?0:book==="pinnacle"?1:2+bookPriorityRank(book);
      const books=(event.bookmakers??[]).filter(b=>b.key&&!isBlockedSportsbook(b.key)&&Number.isFinite(bookPriorityRank(b.key))&&b.markets?.some(m=>m.key===marketKey(kind))&&Number.isFinite(Date.parse(b.last_update??"")))
        .sort((a,b)=>Number(now-Date.parse(a.last_update!)>600_000)-Number(now-Date.parse(b.last_update!)>600_000)||rank(a.key!)-rank(b.key!));
      const market=game.markets[key],reference=publicMarketDisplayBook(market)?.sportsbook?.trim().toLowerCase()??market.movementReferenceSportsbook?.trim().toLowerCase()??market.oddsTrail?.filter(s=>s.label==="current"&&s.sportsbook).sort((a,b)=>Date.parse(b.observedAt??"")-Date.parse(a.observedAt??""))[0]?.sportsbook?.trim().toLowerCase();
      // The public reader may legitimately choose a fresher fallback. Retain
      // that exact published book's opening too, not only a sharp-book open
      // that cannot be spliced into its trace. Same existing daily/cycle cap.
      const sourceBooks=sport==="cbb"?[books.find(b=>b.key===reference)?.key??books[0]?.key]:[...new Set([books.find(b=>b.key===reference)?.key,books[0]?.key])];
      const sides=sport==="cbb"&&side!=="draw"?[side,kind==="total"?(side==="over"?"under":"over"):(side==="home"?"away":"home")]:[side];
      for(const book of sourceBooks)if(book)for(const capturedSide of sides){
        const target={event:game.external_id,start:game.gameStartAt!,away:game.awayTeam,home:game.homeTeam,providerEventId:event.eventId,kind,side:capturedSide,book};
        targets.push(target);providerSides.set(identity(target),owlsDisplayProviderSide(event,game,capturedSide,sport));
        if(book===reference)publicTargets.add(identity(target));
      }
    }
  }
  const pending=targets.filter(t=>!rows.has(identity(t))||now-Date.parse(rows.get(identity(t))!.checkedAt)>24*60*60_000)
    .sort((a,b)=>Number(rows.has(identity(a)))-Number(rows.has(identity(b)))||Number(publicTargets.has(identity(b)))-Number(publicTargets.has(identity(a)))||Date.parse(rows.get(identity(a))?.checkedAt??"1970-01-01")-Date.parse(rows.get(identity(b))?.checkedAt??"1970-01-01")||a.start.localeCompare(b.start));
  if(pending.length&&(reserve()||budget.history>=48))warnings.push("book history: bounded backfill deferred to protect provider allowance; retained quotes remain available");
  for(const target of pending.slice(0,Math.min(3,Math.max(0,48-budget.history)))){
    if(reserve())break;budget.history++;
    requests++;
    try{
      const providerSide=providerSides.get(identity(target))??target.side;
      const result=await client.get<unknown>("/api/odds/history",{eventId:target.providerEventId,book:target.book,market:marketKey(target.kind),side:providerSide});
      remainingMonth=result.rateLimit.remainingMonth??remainingMonth;
      const parsed=parseOwlsBookDisplayHistory(result.body,{...target,side:providerSide},now),old=rows.get(identity(target));
      if(parsed){rows.set(identity(target),{...parsed,side:target.side,opening:old?.opening??parsed.opening,quotes:boundBookQuotes([...(old?.quotes??[]),...parsed.quotes])});if(!old?.opening&&!parsed.opening)warnings.push(`book history: ${target.event}/${target.kind} opener unavailable`);}
      else warnings.push(`book history: ${target.event}/${target.kind} unavailable; retained`);
    }catch{warnings.push(`book history: ${target.event}/${target.kind} request failed; retained`);}
  }
  return {feed:{...observed,rows:[...rows.values()].sort((a,b)=>a.start.localeCompare(b.start)).slice(0,sport==="cbb"?3000:450)},requests,warnings};
}
