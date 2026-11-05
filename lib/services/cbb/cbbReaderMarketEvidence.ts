import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto, OddsTrailStopDto } from "@/app/lab/lib/labTypes";
import type { BookDisplayEntry, BookDisplayFeed } from "@/lib/providers/owls/owlsBookDisplayHistory";
import type { DraftKingsNetworkSplitFeed } from "@/lib/providers/draftkings/draftKingsNetworkSplits";

export const CBB_READER_EVIDENCE_RELEASE="cbb_reader_evidence_2026_11_03_r11_predecision_availability" as const;
type SplitRow={canonical_event_id:string;market_type:string;selection_key:string;bets_pct:number|null;money_pct:number|null;
  provider:string;source_book:string;source_type:string;source_observed_at:string|null;fetched_at:string;inserted_at?:string};
export type CbbCapturedPublicSplitRow=SplitRow;
export type CbbPreparedPublicSplitSections=Partial<Record<keyof DailyEdgeGameDto["markets"],MarketEdgeDto["publicSplits"]>>;
const marketEntries=[['moneyline','moneyline'],['total','total'],['first_inning','spread']] as const;
const opposing=(side:string)=>side==="home"?"away":side==="away"?"home":side==="over"?"under":"over";
const validPct=(value:number|null)=>value!==null&&Number.isFinite(value)&&value>=0&&value<=1;
const sideOf=(game:DailyEdgeGameDto,kind:string,market:MarketEdgeDto):string|null=>{
  const pick=market.pick??"";
  if(kind==="total")return /^over\b/i.test(pick)?"over":/^under\b/i.test(pick)?"under":null;
  const name=pick.replace(/\s+ML$/i,"").replace(/\s+[+-]?\d+(?:\.\d+)?$/,"").trim().toUpperCase();
  return name===game.homeTeam.toUpperCase()?"home":name===game.awayTeam.toUpperCase()?"away":null;
};
const label=(game:DailyEdgeGameDto,side:string)=>side==="home"?game.homeTeam:side==="away"?game.awayTeam:side==="over"?"Over":"Under";
const matchingHistory=(feed:BookDisplayFeed|null,game:DailyEdgeGameDto,kind:string,side:string,book:string|null|undefined):BookDisplayEntry|null=>
  feed?.rows.find(row=>row.event===game.external_id&&Date.parse(row.start)===Date.parse(game.gameStartAt??"")&&
    row.away===game.awayTeam&&row.home===game.homeTeam&&row.kind===kind&&row.side===side&&row.book===book)??null;
function stops(entry:BookDisplayEntry,cutoff:number):OddsTrailStopDto[]{
  const opening=entry.opening&&entry.opening[0]<=cutoff?entry.opening:null;
  const points=[...(opening?[opening]:[]),...entry.quotes.filter(row=>row[0]<=cutoff)]
    .filter(row=>Number.isFinite(row[0])&&row[0]<cutoff+1&&Number.isFinite(row[1])&&Math.abs(row[1])>=100);
  const unique=[...new Map(points.map(row=>[`${row[0]}:${row[2]}`,row])).values()].sort((a,b)=>a[0]-b[0]);
  return unique.map(row=>({american:row[1],line:row[2],observedAt:new Date(row[0]).toISOString(),sportsbook:entry.book,
    source:opening&&row[0]===opening[0]&&row[1]===opening[1]&&row[2]===opening[2]?"provider_opening":"line_history",
    label:opening&&row[0]===opening[0]?"open":"move"}));
}
function mergeTrail(history:OddsTrailStopDto[],current:OddsTrailStopDto[]):OddsTrailStopDto[]{
  return [...new Map([...history,...current].map(stop=>[`${stop.sportsbook}:${Date.parse(stop.observedAt??"")}:${stop.line}`,stop])).values()]
    .sort((a,b)=>Date.parse(a.observedAt??"")-Date.parse(b.observedAt??""));
}
/** A historical source may explain movement when the evaluated book has just
 * one receipt. It is never an executable/current quote or a sharp reference. */
function recordedReference(feed:BookDisplayFeed|null,game:DailyEdgeGameDto,kind:string,side:string,
  currentBook:string|null|undefined,cutoff:number,now:number):OddsTrailStopDto[]|null{
  if(!feed||!Number.isFinite(cutoff))return null;
  const candidates: {entry:BookDisplayEntry;trail:OddsTrailStopDto[];latest:number}[]=[];
  for(const entry of feed.rows){
    if(entry.event!==game.external_id||Date.parse(entry.start)!==Date.parse(game.gameStartAt??"")||
      entry.away!==game.awayTeam||entry.home!==game.homeTeam||entry.kind!==kind||entry.side!==side||
      entry.book===currentBook||entry.ambiguousHistory)continue;
    const raw=[...(entry.opening?[entry.opening]:[]),...entry.quotes].filter(row=>row[0]<=cutoff);
    const tuples=new Map<number,string>();let conflicting=false;
    for(const row of raw){const tuple=JSON.stringify([row[1],row[2]]),seen=tuples.get(row[0]);
      if(seen&&seen!==tuple){conflicting=true;break;}tuples.set(row[0],tuple);}
    if(conflicting)continue;
    const trail=stops(entry,cutoff),times=trail.map(stop=>Date.parse(stop.observedAt??""));
    if(new Set(times).size<2||times.some(time=>(entry.ambiguousTimes??[]).includes(time))||
      entry.ambiguousOpening&&trail.some(stop=>stop.source==="provider_opening"))continue;
    const terminal=trail.at(-1)!,latest=Date.parse(terminal.observedAt??"");
    if(latest>now||now-latest>3*60*60_000||
      trail.some(stop=>stop.line===null&&kind!=="moneyline"))continue;
    const opposite=matchingHistory(feed,game,kind,opposing(side),entry.book);
    if(!opposite||opposite.ambiguousHistory||(opposite.ambiguousTimes??[]).includes(latest)||
      new Set(opposite.quotes.filter(row=>row[0]===latest).map(row=>JSON.stringify([row[1],row[2]]))).size>1)continue;
    const sameEpoch=stops(opposite,cutoff).filter(stop=>Date.parse(stop.observedAt??"")===latest);
    const otherLine=kind==="spread"&&terminal.line!==null?-terminal.line:terminal.line;
    if(sameEpoch.length!==1||sameEpoch[0].line!==otherLine)continue;
    const implied=(american:number)=>american>0?100/(100+american):-american/(100-american);
    const hold=implied(terminal.american)+implied(sameEpoch[0].american);
    if(hold<.98||hold>1.3)continue;
    candidates.push({entry,trail,latest});
  }
  candidates.sort((a,b)=>b.latest-a.latest||b.trail.length-a.trail.length||a.entry.book.localeCompare(b.entry.book));
  return candidates[0]?.trail??null;
}
export function cbbQualifiedPublicSplitPair(rows:SplitRow[],id:number,kind:string,now:number):SplitRow[]|null{
  const sides=kind==="total"?["over","under"]:["away","home"];
  const eligible=rows.filter(row=>row.canonical_event_id===String(id)&&row.market_type===kind&&row.provider==="playbook"&&
    row.source_book==="consensus"&&row.source_type==="multi_book_consensus"&&
    sides.includes(row.selection_key.split(":").at(-1)??"")&&Number.isFinite(Date.parse(row.fetched_at))&&
    now-Date.parse(row.fetched_at)>=0&&now-Date.parse(row.fetched_at)<=30*60_000&&
    (row.source_observed_at===null||Number.isFinite(Date.parse(row.source_observed_at))&&Date.parse(row.source_observed_at)<=Date.parse(row.fetched_at)));
  const latest=eligible.map(row=>row.fetched_at).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
  const pair=eligible.filter(row=>row.fetched_at===latest);
  if(pair.length!==2||new Set(pair.map(row=>row.selection_key.split(":").at(-1))).size!==2||
    pair.some(row=>!validPct(row.bets_pct)||!validPct(row.money_pct))||
    Math.abs(pair.reduce((sum,row)=>sum+row.bets_pct!,0)-1)>.03||
    Math.abs(pair.reduce((sum,row)=>sum+row.money_pct!,0)-1)>.03)return null;
  return pair;
}

const namedBooks=["draftkings","circa","betmgm"] as const;
const namedDisplayPriority=(book:string|null|undefined)=>book==="draftkings_network"?0:namedBooks.indexOf(book as typeof namedBooks[number]);
function namedSplitPair(rows:SplitRow[],id:number,kind:string,now:number):SplitRow[]|null{
  const sides=kind==="total"?["over","under"]:["away","home"];
  for(const book of namedBooks){
    const groups=new Map<string,SplitRow[]>();
    for(const row of rows){
      const observed=Date.parse(row.source_observed_at??""),fetched=Date.parse(row.fetched_at);
      if(row.canonical_event_id!==String(id)||row.market_type!==kind||row.provider!=="owls"||row.source_book!==book||
        row.source_type!==(book==="circa"?"sharp_adjacent_book":"retail_book")||
        !sides.includes(row.selection_key.split(":").at(-1)??"")||!Number.isFinite(observed)||!Number.isFinite(fetched)||
        observed>fetched||fetched>now||observed>now||now-observed>3*60*60_000)continue;
      groups.set(row.source_observed_at!,[...(groups.get(row.source_observed_at!)??[]),row]);
    }
    for(const [,group] of [...groups.entries()].sort(([a],[b])=>Date.parse(b)-Date.parse(a))){
      const pair=sides.map(side=>{
        const matches=group.filter(row=>row.selection_key.split(":").at(-1)===side);
        const first=matches[0];
        return first&&matches.every(row=>row.bets_pct===first.bets_pct&&row.money_pct===first.money_pct)?first:null;
      });
      if(pair.some(row=>!row||!validPct(row.bets_pct)||!validPct(row.money_pct)))continue;
      const complete=pair as SplitRow[];
      if(Math.abs(complete.reduce((sum,row)=>sum+row.bets_pct!,0)-1)>.03||
        Math.abs(complete.reduce((sum,row)=>sum+row.money_pct!,0)-1)>.03)continue;
      return complete;
    }
  }
  return null;
}

function namedSection(game:DailyEdgeGameDto,pair:SplitRow[]):NonNullable<MarketEdgeDto["sportsbookSplits"]>{
  const book=pair[0].source_book as typeof namedBooks[number];
  return {label:book==="circa"?"Sharp Book Splits":book==="draftkings"?"DraftKings Splits":"BetMGM Splits",
    sourceBook:book,sourceObservedAt:pair[0].source_observed_at!,lastUpdated:pair[0].source_observed_at!,signal:null,
    rows:pair.map(row=>{const side=row.selection_key.split(":").at(-1) as "home"|"away"|"over"|"under";
      return {side,label:label(game,side),betsPct:row.bets_pct!*100,moneyPct:row.money_pct!*100,
        observedAt:row.source_observed_at,freshnessCheckedAt:row.fetched_at,staleAfterMinutes:180,isStale:false};})};
}

function preferNamedSection(existing:MarketEdgeDto["sportsbookSplits"],incoming:NonNullable<MarketEdgeDto["sportsbookSplits"]>,now:number):boolean{
  if(!existing)return true;
  const observed=Date.parse(existing.sourceObservedAt??existing.lastUpdated??"");
  const priority=namedDisplayPriority(existing.sourceBook);
  const complete=existing.rows.length===2&&new Set(existing.rows.map(row=>row.side)).size===2&&
    existing.rows.every(row=>row.betsPct!==null&&row.moneyPct!==null)&&
    Math.abs(existing.rows.reduce((sum,row)=>sum+(row.betsPct??0),0)-100)<=3&&
    Math.abs(existing.rows.reduce((sum,row)=>sum+(row.moneyPct??0),0)-100)<=3;
  if(!complete||priority<0||!Number.isFinite(observed)||observed>now)return true;
  const incomingAt=Date.parse(incoming.sourceObservedAt!),existingFresh=now-observed<=3*60*60_000,incomingFresh=now-incomingAt<=3*60*60_000;
  if(existingFresh!==incomingFresh)return incomingFresh;
  if(!existingFresh)return incomingAt>observed;
  const incomingPriority=namedDisplayPriority(incoming.sourceBook);
  return incomingPriority<priority||incomingPriority===priority&&Date.parse(incoming.sourceObservedAt!)>observed;
}

export function cbbQualifiedNamedSplitSection(existing:MarketEdgeDto["sportsbookSplits"],section:MarketEdgeDto["sportsbookSplits"],now:number,
  options:{allowRetained?:boolean}={}):section is NonNullable<MarketEdgeDto["sportsbookSplits"]>{
  const observed=Date.parse(section?.sourceObservedAt??section?.lastUpdated??"");
  return !!section&&namedDisplayPriority(section.sourceBook)>=0&&Number.isFinite(observed)&&observed<=now&&(options.allowRetained||now-observed<=3*60*60_000)&&section.rows.length===2&&new Set(section.rows.map(row=>row.side)).size===2&&
    !section.rows.some(row=>row.betsPct===null||row.moneyPct===null||!Number.isFinite(row.betsPct)||!Number.isFinite(row.moneyPct)||row.betsPct<0||row.betsPct>100||row.moneyPct<0||row.moneyPct>100)&&
    Math.abs(section.rows.reduce((sum,row)=>sum+row.betsPct!,0)-100)<=3&&Math.abs(section.rows.reduce((sum,row)=>sum+row.moneyPct!,0)-100)<=3&&
    preferNamedSection(existing,section,now);
}

export type CbbCapturedNamedSplitFeed=NonNullable<Parameters<typeof import("@/lib/providers/real_api/sharpApiCurrentSplits").applySharpApiCurrentSplitOverlay>[1]>;
export type CbbPreparedNamedSplitSections=Partial<Record<keyof DailyEdgeGameDto["markets"],NonNullable<MarketEdgeDto["sportsbookSplits"]>>>;

export function cbbQualifiedPublicSplitSection(section:MarketEdgeDto["publicSplits"]|undefined,kind:keyof DailyEdgeGameDto["markets"],now:number):boolean{
  const sides=kind==="total"?["over","under"]:["home","away"];
  return !!section&&section.length===2&&new Set(section.map(row=>row.side)).size===2&&section.every(row=>{
    const captured=Date.parse(row.freshnessCheckedAt??row.observedAt??""),observed=Date.parse(row.observedAt??"");
    return sides.includes(row.side)&&Number.isFinite(captured)&&Number.isFinite(observed)&&observed<=captured&&captured<=now&&now-captured<=30*60_000&&
      row.betsPct!==null&&row.moneyPct!==null&&Number.isFinite(row.betsPct)&&Number.isFinite(row.moneyPct)&&row.betsPct>=0&&row.betsPct<=100&&row.moneyPct>=0&&row.moneyPct<=100;
  })&&Math.abs(section.reduce((sum,row)=>sum+row.betsPct!,0)-100)<=3&&Math.abs(section.reduce((sum,row)=>sum+row.moneyPct!,0)-100)<=3;
}

export async function readCbbCapturedPublicSplits(db:typeof import("@/lib/db/supabase").supabase,ids:readonly number[],now=Date.now()):Promise<SplitRow[]>{
  if(!ids.length)return [];
  const rows:SplitRow[]=[],since=new Date(now-30*60_000).toISOString();
  for(let offset=0;offset<12_000;offset+=500){
    const result=await db.from("market_split_observations_v2")
      .select("canonical_event_id,market_type,selection_key,bets_pct,money_pct,provider,source_book,source_type,source_observed_at,fetched_at,inserted_at")
      .eq("league","cbb").eq("provider","playbook").eq("source_book","consensus").eq("source_type","multi_book_consensus")
      .in("canonical_event_id",ids.map(String)).gte("fetched_at",since).lte("fetched_at",new Date(now).toISOString()).lte("inserted_at",new Date(now).toISOString())
      .order("fetched_at",{ascending:false}).order("id",{ascending:true}).range(offset,offset+499);
    if(result.error)throw new Error(`CBB public split read failed: ${result.error.message}`);
    rows.push(...result.data as SplitRow[]);
    if(result.data.length<500)return rows;
  }
  throw new Error("CBB public split page budget exhausted; refusing partial coverage");
}

/** Shared by the existing reader and sole writer; source/age/identity rules are identical. */
export function mergeCbbCapturedNamedSplitEvidence(board:DailyEdgeResponse,namedFeed:CbbCapturedNamedSplitFeed|null,
  applyOverlay:typeof import("@/lib/providers/real_api/sharpApiCurrentSplits").applySharpApiCurrentSplitOverlay,
  now=Date.now(),identityGames:readonly DailyEdgeGameDto[]=board.games):DailyEdgeResponse{
  const candidates=structuredClone({...board,games:board.games.filter(game=>game.lockState!=="locked"&&game.lockedAt===null&&Date.parse(game.gameStartAt??"")>now)});
  applyOverlay(candidates,namedFeed,now,{identityGames});
  const changes=new Map<string,DailyEdgeGameDto>();
  for(const candidate of candidates.games){
    const original=board.games.find(row=>row.external_id===candidate.external_id)!;
    const game={...original,markets:{...original.markets}};
    for(const [key] of marketEntries){
      const section=candidate.markets[key].sportsbookSplits;
      if(!cbbQualifiedNamedSplitSection(original.markets[key].sportsbookSplits,section,now,{allowRetained:true}))continue;
      // Exact named-event receipts remain displayable during source outages.
      // Never renew their source time or loosen the separate model-input gate.
      const retained={...section,lastUpdated:section.sourceObservedAt!,rows:section.rows.map(row=>({...row,observedAt:section.sourceObservedAt!}))};
      game.markets[key]={...original.markets[key],sportsbookSplits:retained,
        sharpBookAvailability:{status:"complete",message:"Verified two-sided named-book split data is available.",lastUpdated:section.sourceObservedAt??section.lastUpdated??""}};
    }
    changes.set(game.id,game);
  }
  return {...board,games:board.games.map(game=>changes.get(game.id)??game)};
}

/** Stored source only. Qualify against the complete fixture context, then copy
 * only the display section; the forecast/decision tuple and locks never move. */
export function mergeCbbDraftKingsSplitEvidence(board:DailyEdgeResponse,feed:DraftKingsNetworkSplitFeed|null,
  applyFallback:typeof import("@/lib/providers/draftkings/draftKingsNetworkSplits").applyDraftKingsNetworkSplitFallback,
  now=Date.now(),identityGames:readonly DailyEdgeGameDto[]=board.games):DailyEdgeResponse{
  const receipt=Date.parse(feed?.fetchedAt??"");
  if(board.sport!=="cbb"||!feed||feed.source!=="draftkings_network"||feed.sport!=="NCAA Basketball"||!Number.isFinite(receipt)||receipt>now)return board;
  const safeFeed={...feed,games:feed.games.map(game=>({...game,markets:Object.fromEntries(Object.entries(game.markets).filter(([,market])=>{
    const observed=Date.parse(market!.observedAt??feed.fetchedAt);return Number.isFinite(observed)&&observed<=receipt;
  }))}))};
  // Keep all fixtures for ambiguity checks without cloning chart history.
  const candidates={...board,games:identityGames.map(game=>game.lockState==="locked"||game.lockedAt!==null?game:
    {...game,markets:Object.fromEntries(Object.entries(game.markets).map(([key,market])=>[key,{...market,sportsbookSplits:null}])) as DailyEdgeGameDto["markets"]})};
  applyFallback(candidates,safeFeed);
  const incoming=new Map(candidates.games.map(game=>[game.id,game]));
  return {...board,games:board.games.map(original=>{
    if(original.lockState==="locked"||original.lockedAt!==null||Date.parse(original.gameStartAt??"")<=now)return original;
    const candidate=incoming.get(original.id);if(!candidate)return original;
    const markets={...original.markets};let changed=false;
    for(const [key] of marketEntries){
      const section=candidate.markets[key].sportsbookSplits;
      if(!cbbQualifiedNamedSplitSection(original.markets[key].sportsbookSplits,section,now,{allowRetained:true}))continue;
      // This is a DraftKings consumer-network observation, not a professional
      // sharp-book receipt. The overlay is unlocked/display-only; any stored
      // legacy lock keeps its exact original section and decision tuple.
      markets[key]={...original.markets[key],sportsbookSplits:{...section,label:"DraftKings Splits"},
        sharpBookAvailability:{status:"unavailable",message:"No current verified professional split for this market.",lastUpdated:null}};
      changed=true;
    }
    return changed?{...original,markets}:original;
  })};
}

/** Display-only unlocked overlay. The stored grade, pick, projection, price and
 * every locked payload retain precedence over these separately captured rows. */
export function mergeCbbReaderEvidence(board:DailyEdgeResponse,feed:BookDisplayFeed|null,splitRows:SplitRow[],now=Date.now()):DailyEdgeResponse{
  if(board.sport!=="cbb")throw new Error("CBB reader evidence received a foreign board");
  return {...board,games:board.games.map(game=>{
    if(game.lockState==="locked"||game.lockedAt!==null||Date.parse(game.gameStartAt??"")<=now)return game;
    const markets={...game.markets};
    for(const [key,kind] of marketEntries){
      const market={...markets[key]},side=sideOf(game,kind,market);
      const pair=cbbQualifiedPublicSplitPair(splitRows,game.external_id,kind,now);
      const named=namedSplitPair(splitRows,game.external_id,kind,now);
      if(named){
        const section=namedSection(game,named);
        if(preferNamedSection(market.sportsbookSplits,section,now)){
          market.sportsbookSplits=section;
          market.sharpBookAvailability={status:"complete",message:"Verified two-sided named-book split data is available.",lastUpdated:section.sourceObservedAt!};
        }
      }
      if(pair)market.publicSplits=pair.map(row=>({side:row.selection_key.split(":").at(-1) as "home"|"away"|"over"|"under",
        label:label(game,row.selection_key.split(":").at(-1)!),betsPct:row.bets_pct!*100,moneyPct:row.money_pct!*100,
        observedAt:row.source_observed_at??row.fetched_at,freshnessCheckedAt:row.fetched_at,staleAfterMinutes:30,isStale:false}));
      if(side){
        const book=market.currentPriceSportsbook,cutoff=Math.min(now,Date.parse(market.currentPriceObservedAt??"")||now);
        const selected=matchingHistory(feed,game,kind,side,book),other=matchingHistory(feed,game,kind,opposing(side),book);
        if(selected){
          const history=stops(selected,cutoff),current=(market.oddsTrail??[]).filter(stop=>stop.label==="current"&&stop.sportsbook===book);
          const trail=mergeTrail(history,current);
          market.lineTrail=trail;
          market.oddsTrail=trail.filter(stop=>stop.line===market.line);
          market.movementReferenceSportsbook=book;
        }
        if(other){
          const existing=market.opposingOddsTrail?.side===opposing(side)?market.opposingOddsTrail.stops:[];
          market.opposingOddsTrail={side:opposing(side) as "home"|"away"|"over"|"under",label:label(game,opposing(side)),
            stops:mergeTrail(stops(other,cutoff),existing)};
        }
        // Keep the evaluated book's single real quote as current. An older
        // second book is available only as a separate recorded reference.
        if(book&&market.currentPriceAmerican!==null&&market.currentPriceAmerican!==undefined&&
          Date.parse(game.gameStartAt??"")-now>60*60_000&&
          new Set([...(market.lineTrail??[]),...(market.oddsTrail??[])]
            .filter(stop=>stop.sportsbook===book).map(stop=>stop.observedAt)).size<2){
          market.recordedReferenceTrail=recordedReference(feed,game,kind,side,book,cutoff,now)??undefined;
        }
      }
      markets[key]=market;
    }
    return {...game,markets};
  })};
}

export async function overlayCbbReaderMarketEvidence(board:DailyEdgeResponse,options:{gameIds?:readonly string[]}={}):Promise<DailyEdgeResponse>{
  if(board.sport!=="cbb"||board.games.length===0)return board;
  const requested=options.gameIds?new Set(options.gameIds):null;
  const selected={...board,games:board.games.filter(game=>!requested||requested.has(game.id))};
  if(selected.games.length===0||selected.games.every(game=>game.lockState==="locked"||game.lockedAt!==null))return board;
  const [{readPredictionMarketBookHistory},{supabase},{readStoredSharpApiCurrentSplits,applySharpApiCurrentSplitOverlay,currentSplitResponseDates}]=await Promise.all([
    import("@/lib/services/dailyEdge/predictionMarketDisplayFeed"),import("@/lib/db/supabase"),import("@/lib/providers/real_api/sharpApiCurrentSplits")]);
  const ids=selected.games.filter(game=>game.lockedAt===null&&game.lockState!=="locked").map(game=>String(game.external_id));
  const {readStoredDraftKingsNetworkSplits,applyDraftKingsNetworkSplitFallback}=await import("@/lib/providers/draftkings/draftKingsNetworkSplits");
  const [feed,rows,namedFeed,draftKingsFeed]=await Promise.all([readPredictionMarketBookHistory("cbb").catch(()=>null),readCbbCapturedPublicSplits(supabase,ids.map(Number)).catch(()=>[]),
    readStoredSharpApiCurrentSplits("cbb",currentSplitResponseDates(selected)).catch(()=>null),readStoredDraftKingsNetworkSplits("cbb",supabase).catch(()=>null)]);
  // Named-book polling must not crowd public consensus out of a shared row cap.
  // The durable named-book display feed already has exact institution matching,
  // source timestamps and freshness checks; no provider request is made here.
  const merged=mergeCbbDraftKingsSplitEvidence(mergeCbbCapturedNamedSplitEvidence(mergeCbbReaderEvidence(selected,feed,rows),namedFeed,
    applySharpApiCurrentSplitOverlay,Date.now(),board.games),draftKingsFeed,applyDraftKingsNetworkSplitFallback,Date.now(),board.games);
  const details=new Map(merged.games.map(game=>[game.id,game]));
  return {...board,games:board.games.map(game=>details.get(game.id)??game)};
}
