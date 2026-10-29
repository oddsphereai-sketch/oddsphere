import {unstable_cache} from "next/cache";
import {supabase} from "@/lib/db/supabase";
import {selectPredictionMarketBook,normalizePredictionMarketBookPin,type ComparisonQuote} from "./predictionMarketBookComparison";
import type {DailyEdgeGameDto} from "@/app/lab/lib/labTypes";
import {predictionMarketReaderBookTrail,predictionMarketComparisonBook} from "@/app/lab/lib/predictionMarketDisplay";
import {readerContractSelection} from "@/lib/providers/owls/predictionMarketContracts";
import {readPredictionMarketBookHistory} from "./predictionMarketDisplayFeed";
import {bookDisplayTrail,bookDisplayContext} from "@/lib/providers/owls/owlsBookDisplayHistory";
import type {PredictionMarketSport} from "@/lib/providers/owls/owlsPredictionMarkets";

/** Bounded SELECTs of already-collected observations. No provider requests,
 * new pollers, prediction assembly, or changes to the published game DTO. */
async function readQuotes(sport:string,externalId:number,start:string,kind:string,side:string):Promise<ComparisonQuote[]>{
  const game=await supabase.from("games").select("id,game_date").eq("sport",sport==="ucl"?"soccer":sport).eq("external_id",externalId).maybeSingle();
  if(game.data&&Date.parse(game.data.game_date)!==Date.parse(start))return [];
  // Forward football/soccer boards need not have a generic games-table row.
  // The caller already verified the exact authoritative published identity;
  // canonical observations are keyed directly by that external event + league.
  const since=new Date(Date.now()-86_400_000).toISOString(),id=game.data?.id;
  const empty=Promise.resolve({data:[] as never[]});
  const kinds=kind==="moneyline"?["moneyline","match_result"]:kind==="btts"?["btts","both_teams_to_score"]:[kind];
  const history=(ascending:boolean)=>supabase.from("line_history").select("market_type,side,sportsbook,odds_american,line_value,recorded_at")
    .eq("game_id",id).in("market_type",kinds).eq("side",side).gte("recorded_at",since).order("recorded_at",{ascending}).limit(500);
  const canonical=(ascending:boolean)=>supabase.from("market_price_observations_v2").select("market_type,selection_key,sportsbook,american_price,line,provider_timestamp,fetched_at")
    .eq("league",sport).eq("canonical_event_id",String(externalId)).in("market_type",kinds).like("selection_key",`%:${side}`).gte("fetched_at",since).order("fetched_at",{ascending}).limit(500);
  const [old,recent,cold,crecent,current,stream]=await Promise.all([id?history(true):empty,id?history(false):empty,canonical(true),canonical(false),
    id?supabase.from("lines").select("market_type,side,sportsbook,odds_american,line_value,fetched_at").eq("game_id",id).in("market_type",kinds).eq("side",side).gte("fetched_at",since).limit(500):empty,
    id?supabase.from("odds_current_stream").select("market_type,side,sportsbook,odds_american,line_value,observed_at").eq("game_id",id).in("market_type",kinds).eq("side",side).gte("observed_at",since).limit(500):empty]);
  const market=(s:string)=>["both_teams_to_score","btts"].includes(s)?"btts":s==="match_result"?"moneyline":s;
  return [...(old.data??[]),...(recent.data??[])].map(r=>({sportsbook:r.sportsbook,market:market(r.market_type),side:r.side??"",line:r.line_value,american:r.odds_american,at:r.recorded_at}))
    .concat([...(cold.data??[]),...(crecent.data??[])].map(r=>({sportsbook:r.sportsbook,market:market(r.market_type),side:r.selection_key.split(":").at(-1)??"",line:r.line,american:r.american_price,at:r.provider_timestamp??r.fetched_at})))
    .concat((current.data??[]).map(r=>({sportsbook:r.sportsbook,market:market(r.market_type),side:r.side??"",line:r.line_value,american:r.odds_american,at:r.fetched_at})))
    .concat((stream.data??[]).map(r=>({sportsbook:r.sportsbook,market:market(r.market_type),side:r.side??"",line:r.line_value,american:r.odds_american,at:r.observed_at})));
}
const cachedQuotes=unstable_cache(readQuotes,["prediction_market_book_comparison_2026_10_28_r1"],{revalidate:30});
export async function readPredictionMarketBook(game:DailyEdgeGameDto,kind:string,side:string,line:number|null,feedSport=game.sport as PredictionMarketSport,preferredBook?:string|null){
  // A stored locked trail always wins. This live context cannot replace it.
  if(game.lockState==="locked"||Date.parse(game.gameStartAt??"")<=Date.now())return null;
  const key=kind==="moneyline"?"moneyline":kind==="total"?"total":"first_inning",market=game.markets[key];
  const selected=readerContractSelection(game,key);
  const label=kind==="moneyline"?(side==="away"?game.awayTeam:side==="home"?game.homeTeam:"DRAW"):
    selected?.side===side?market.pick??"":market.opposingOddsTrail?.side===side?market.opposingOddsTrail.label:"";
  const publishedTrail=predictionMarketReaderBookTrail(market,label,Date.now(),line);
  const published=publishedTrail?{...publishedTrail,line:publishedTrail.line===undefined?line:publishedTrail.line}:null;
  const rows=await cachedQuotes(game.sport,game.external_id,game.gameStartAt??"",kind,side).catch(()=>[] as ComparisonQuote[]);
  const pin=normalizePredictionMarketBookPin(preferredBook);
  const candidate=selectPredictionMarketBook(rows,kind,side,line,Date.now(),pin);
  // A pinned valid live source owns this display trace, not whichever other
  // book happened to update the independently published model card last.
  if(pin&&!candidate&&published?.sportsbook!==pin)return null;
  const selectedBook=predictionMarketComparisonBook(false,published,candidate,!!pin);
  if(!selectedBook)return null;
  const feed=await readPredictionMarketBookHistory(feedSport).catch(()=>null);
  const entry=feed?.rows.find(e=>e.event===game.external_id&&Date.parse(e.start)===Date.parse(game.gameStartAt??"")&&e.away===game.awayTeam&&e.home===game.homeTeam&&e.kind===kind&&e.side===side&&e.book===selectedBook.sportsbook);
  const history=entry?bookDisplayTrail(entry,selectedBook.line===undefined?line:selectedBook.line):null;
  if(!entry)return selectedBook;
  const context=bookDisplayContext(entry),latest=selectedBook.points.at(-1)!;
  const marketHistory:[number,number,number|null][]=[...(context.marketHistory??[]),...(selectedBook.marketHistory??[]),[latest[0],latest[2],selectedBook.line===undefined?line:selectedBook.line]];
  return {...selectedBook,...context,marketHistory:[...new Map(marketHistory.map(p=>[p[0]+"|"+p[2],p])).values()].sort((a,b)=>a[0]-b[0]),points:[...new Map([...(history?.points??[]),...selectedBook.points].map(p=>[p[0],p])).values()].sort((a,b)=>a[0]-b[0])};
}
