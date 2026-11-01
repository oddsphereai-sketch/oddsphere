import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto, OddsTrailStopDto } from "@/app/lab/lib/labTypes";
import type { BookDisplayEntry, BookDisplayFeed } from "@/lib/providers/owls/owlsBookDisplayHistory";

export const CBB_READER_EVIDENCE_RELEASE="cbb_reader_evidence_2026_10_31_r3_source_scoped_tracking" as const;
type SplitRow={canonical_event_id:string;market_type:string;selection_key:string;bets_pct:number|null;money_pct:number|null;
  provider:string;source_book:string;source_type:string;source_observed_at:string|null;fetched_at:string};
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
  return [...new Map([...history,...current].map(stop=>[`${stop.sportsbook}:${stop.observedAt}:${stop.line}`,stop])).values()]
    .sort((a,b)=>Date.parse(a.observedAt??"")-Date.parse(b.observedAt??""));
}
function splitPair(rows:SplitRow[],id:number,kind:string,now:number):SplitRow[]|null{
  const sides=kind==="total"?["over","under"]:["away","home"];
  const eligible=rows.filter(row=>row.canonical_event_id===String(id)&&row.market_type===kind&&row.provider==="playbook"&&
    row.source_book==="consensus"&&row.source_type==="multi_book_consensus"&&
    sides.includes(row.selection_key.split(":").at(-1)??"")&&Number.isFinite(Date.parse(row.fetched_at))&&
    now-Date.parse(row.fetched_at)>=0&&now-Date.parse(row.fetched_at)<=30*60_000);
  const latest=eligible.map(row=>row.fetched_at).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
  const pair=eligible.filter(row=>row.fetched_at===latest);
  if(pair.length!==2||new Set(pair.map(row=>row.selection_key.split(":").at(-1))).size!==2||
    pair.some(row=>!validPct(row.bets_pct)||!validPct(row.money_pct))||
    Math.abs(pair.reduce((sum,row)=>sum+row.bets_pct!,0)-1)>.03||
    Math.abs(pair.reduce((sum,row)=>sum+row.money_pct!,0)-1)>.03)return null;
  return pair;
}

const namedBooks=["circa","draftkings","betmgm"] as const;
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
  const priority=namedBooks.indexOf(existing.sourceBook as typeof namedBooks[number]);
  const complete=existing.rows.length===2&&new Set(existing.rows.map(row=>row.side)).size===2&&
    existing.rows.every(row=>row.betsPct!==null&&row.moneyPct!==null)&&
    Math.abs(existing.rows.reduce((sum,row)=>sum+(row.betsPct??0),0)-100)<=3&&
    Math.abs(existing.rows.reduce((sum,row)=>sum+(row.moneyPct??0),0)-100)<=3;
  if(!complete||priority<0||!Number.isFinite(observed)||observed>now||now-observed>3*60*60_000)return true;
  const incomingPriority=namedBooks.indexOf(incoming.sourceBook as typeof namedBooks[number]);
  return incomingPriority<priority||incomingPriority===priority&&Date.parse(incoming.sourceObservedAt!)>observed;
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
      const pair=splitPair(splitRows,game.external_id,kind,now);
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
  const [{readPredictionMarketBookHistory},{supabase},{readStoredSharpApiCurrentSplits,applySharpApiCurrentSplitOverlay}]=await Promise.all([
    import("@/lib/services/dailyEdge/predictionMarketDisplayFeed"),import("@/lib/db/supabase"),import("@/lib/providers/real_api/sharpApiCurrentSplits")]);
  const ids=selected.games.filter(game=>game.lockedAt===null&&game.lockState!=="locked").map(game=>String(game.external_id));
  const publicRows=async():Promise<SplitRow[]>=>{
    if(!ids.length)return [];
    const rows:SplitRow[]=[],since=new Date(Date.now()-30*60_000).toISOString();
    for(let offset=0;offset<12_000;offset+=500){
      const result=await supabase.from("market_split_observations_v2")
        .select("canonical_event_id,market_type,selection_key,bets_pct,money_pct,provider,source_book,source_type,source_observed_at,fetched_at")
        .eq("league","cbb").eq("provider","playbook").in("canonical_event_id",ids).gte("fetched_at",since)
        .order("fetched_at",{ascending:false}).order("id",{ascending:true}).range(offset,offset+499);
      if(result.error)throw new Error(`CBB public split read failed: ${result.error.message}`);
      rows.push(...result.data as SplitRow[]);
      if(result.data.length<500)return rows;
    }
    throw new Error("CBB public split page budget exhausted; refusing partial coverage");
  };
  const [feed,rows,namedFeed]=await Promise.all([readPredictionMarketBookHistory("cbb").catch(()=>null),publicRows().catch(()=>[]),
    readStoredSharpApiCurrentSplits("cbb").catch(()=>null)]);
  // Named-book polling must not crowd public consensus out of a shared row cap.
  // The durable named-book display feed already has exact institution matching,
  // source timestamps and freshness checks; no provider request is made here.
  const merged=mergeCbbReaderEvidence(selected,feed,rows),now=Date.now();
  const candidates=structuredClone({...merged,games:merged.games.filter(game=>game.lockState!=="locked"&&game.lockedAt===null&&Date.parse(game.gameStartAt??"")>now)});
  applySharpApiCurrentSplitOverlay(candidates,namedFeed,now,{identityGames:board.games});
  for(const candidate of candidates.games){
    const game=merged.games.find(row=>row.external_id===candidate.external_id)!;
    for(const [key] of marketEntries){
      const section=candidate.markets[key].sportsbookSplits,observed=Date.parse(section?.sourceObservedAt??section?.lastUpdated??"");
      if(!section||!Number.isFinite(observed)||observed>now||now-observed>3*60*60_000||section.rows.length!==2||new Set(section.rows.map(row=>row.side)).size!==2||
        section.rows.some(row=>row.betsPct===null||row.moneyPct===null||!Number.isFinite(row.betsPct)||!Number.isFinite(row.moneyPct)||row.betsPct<0||row.betsPct>100||row.moneyPct<0||row.moneyPct>100)||
        Math.abs(section.rows.reduce((sum,row)=>sum+row.betsPct!,0)-100)>3||Math.abs(section.rows.reduce((sum,row)=>sum+row.moneyPct!,0)-100)>3||
        !preferNamedSection(game.markets[key].sportsbookSplits,section,now))continue;
      game.markets[key].sportsbookSplits=section;
      game.markets[key].sharpBookAvailability={status:"complete",message:"Verified two-sided named-book split data is available.",lastUpdated:new Date(observed).toISOString()};
    }
  }
  const details=new Map(merged.games.map(game=>[game.id,game]));
  return {...board,games:board.games.map(game=>details.get(game.id)??game)};
}
