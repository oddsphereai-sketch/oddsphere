import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto, OddsTrailStopDto } from "@/app/lab/lib/labTypes";
import type { BookDisplayEntry, BookDisplayFeed } from "@/lib/providers/owls/owlsBookDisplayHistory";

export const CBB_READER_EVIDENCE_RELEASE="cbb_reader_evidence_2026_10_30_r1_verified_two_sided_display" as const;
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
      if(pair)market.publicSplits=pair.map(row=>({side:row.selection_key.split(":").at(-1) as "home"|"away"|"over"|"under",
        label:label(game,row.selection_key.split(":").at(-1)!),betsPct:row.bets_pct!*100,moneyPct:row.money_pct!*100,
        observedAt:row.source_observed_at??row.fetched_at,freshnessCheckedAt:row.fetched_at,staleAfterMinutes:30,isStale:false}));
      if(side){
        const book=market.currentPriceSportsbook,cutoff=Math.min(now,Date.parse(market.currentPriceObservedAt??"")||now);
        const selected=matchingHistory(feed,game,kind,side,book),other=matchingHistory(feed,game,kind,opposing(side),book);
        if(selected){
          const history=stops(selected,cutoff),current=(market.oddsTrail??[]).filter(stop=>stop.label==="current"&&stop.sportsbook===book);
          const trail=[...history,...current].sort((a,b)=>Date.parse(a.observedAt??"")-Date.parse(b.observedAt??""));
          market.lineTrail=trail;
          market.oddsTrail=trail.filter(stop=>stop.line===market.line);
          market.movementReferenceSportsbook=book;
        }
        if(other){
          const existing=market.opposingOddsTrail?.side===opposing(side)?market.opposingOddsTrail.stops:[];
          market.opposingOddsTrail={side:opposing(side) as "home"|"away"|"over"|"under",label:label(game,opposing(side)),
            stops:[...stops(other,cutoff),...existing].sort((a,b)=>Date.parse(a.observedAt??"")-Date.parse(b.observedAt??""))};
        }
      }
      markets[key]=market;
    }
    return {...game,markets};
  })};
}

export async function overlayCbbReaderMarketEvidence(board:DailyEdgeResponse):Promise<DailyEdgeResponse>{
  if(board.sport!=="cbb"||board.games.length===0)return board;
  const [{readPredictionMarketBookHistory},{supabase}]=await Promise.all([
    import("@/lib/services/dailyEdge/predictionMarketDisplayFeed"),import("@/lib/db/supabase")]);
  const ids=board.games.filter(game=>game.lockedAt===null&&game.lockState!=="locked").map(game=>String(game.external_id));
  const [feed,result]=await Promise.all([readPredictionMarketBookHistory("cbb").catch(()=>null),
    ids.length?supabase.from("market_split_observations_v2")
      .select("canonical_event_id,market_type,selection_key,bets_pct,money_pct,provider,source_book,source_type,source_observed_at,fetched_at")
      .eq("league","cbb").in("canonical_event_id",ids).order("fetched_at",{ascending:false}).limit(300):Promise.resolve({data:[],error:null})]);
  return mergeCbbReaderEvidence(board,feed,result.error?[]:result.data as SplitRow[]);
}
