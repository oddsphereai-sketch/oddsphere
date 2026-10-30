import { unstable_cache, revalidateTag } from "next/cache";
import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import {
  isPredictionMarketFeed, mergePredictionMarketFeeds, parseOwlsPredictionMarkets, matchPredictionMarketGame,
  PREDICTION_MARKET_RELEASE, PREDICTION_MARKET_TARGETS,
  type PredictionMarketFeed, type PredictionMarketSport,
} from "@/lib/providers/owls/owlsPredictionMarkets";
import { readLatestLabResponseSnapshot, upsertLabResponseSnapshot } from "../labResponseSnapshots";
import { backfillKalshiDisplayHistory } from "@/lib/providers/owls/kalshiDisplayHistory";
import { contractKinds, contractSeries, parseContractFeed, contractsForPublishedReaders, PREDICTION_MARKET_CONTRACT_RELEASE,
  resolveReaderContract, readerHistoryContractSelection, type ContractKind, type ContractFeed } from "@/lib/providers/owls/predictionMarketContracts";
import {selectedPredictionMarketOutcome} from "@/app/lab/lib/predictionMarketDisplay";
import { supabase } from "@/lib/db/supabase";
import { gunzipSync, gzipSync } from "node:zlib";
import { currentDailyEdgeBoardDate, currentSlateDate } from "@/lib/dates/slateDate";
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import { BOOK_DISPLAY_HISTORY_RELEASE, captureOwlsBookDisplayHistory, isBookDisplayFeed, type BookDisplayFeed } from "@/lib/providers/owls/owlsBookDisplayHistory";
import {PREDICTION_MARKET_PRELOCK_RELEASE,capturePredictionMarketPrelock,type PrelockFeed} from "@/lib/providers/owls/predictionMarketPrelock";
import { fetchCbbKalshiMarkets } from "@/lib/providers/kalshi/cbbMarkets";

const prelockKey=(sport:PredictionMarketSport)=>`daily-edge::prediction-market-prelock::${sport}::${PREDICTION_MARKET_PRELOCK_RELEASE}`;
async function prelockStored(sport:PredictionMarketSport):Promise<PrelockFeed|null>{
  const stored=await readLatestLabResponseSnapshot<Record<string,unknown>>(prelockKey(sport));
  let p=stored?.payload;
  if(p?.encoding==="gzip-base64"&&typeof p.payload==="string")p=JSON.parse(gunzipSync(Buffer.from(p.payload,"base64"),{maxOutputLength:64_000_000}).toString());
  return p?.release===PREDICTION_MARKET_PRELOCK_RELEASE&&p.sport===sport&&Array.isArray(p.rows)?p as PrelockFeed:null;
}
const prelockCompressed=unstable_cache(async(sport:PredictionMarketSport)=>gzipSync(JSON.stringify(await prelockStored(sport))).toString("base64"),[PREDICTION_MARKET_PRELOCK_RELEASE],{revalidate:30,tags:[PREDICTION_MARKET_PRELOCK_RELEASE]});
export async function readPredictionMarketPrelockFeed(sport:PredictionMarketSport):Promise<PrelockFeed|null>{
  return JSON.parse(gunzipSync(Buffer.from(await prelockCompressed(sport),"base64"),{maxOutputLength:64_000_000}).toString());
}

export const predictionMarketBookSnapshotKey=(sport:PredictionMarketSport)=>`daily-edge::prediction-market-books::${sport}::${BOOK_DISPLAY_HISTORY_RELEASE}`;
async function bookHistoryStored(sport:PredictionMarketSport):Promise<BookDisplayFeed|null>{
  const stored=await readLatestLabResponseSnapshot<Record<string,unknown>>(predictionMarketBookSnapshotKey(sport));
  let value=stored?.payload;
  if(value?.encoding==="gzip-base64"&&typeof value.payload==="string")value=JSON.parse(gunzipSync(Buffer.from(value.payload,"base64"),{maxOutputLength:8_000_000}).toString());
  return isBookDisplayFeed(value,sport)?value:null;
}
const bookHistoryCompressed=unstable_cache(async(sport:PredictionMarketSport)=>gzipSync(JSON.stringify(await bookHistoryStored(sport))).toString("base64"),[BOOK_DISPLAY_HISTORY_RELEASE],{revalidate:30,tags:[BOOK_DISPLAY_HISTORY_RELEASE]});
export async function readPredictionMarketBookHistory(sport:PredictionMarketSport):Promise<BookDisplayFeed|null>{
  return JSON.parse(gunzipSync(Buffer.from(await bookHistoryCompressed(sport),"base64"),{maxOutputLength:8_000_000}).toString());
}

export function predictionMarketSnapshotKey(sport: PredictionMarketSport): string {
  return `daily-edge::prediction-market-display::${sport}::${PREDICTION_MARKET_RELEASE}`;
}
async function readStored(sport: PredictionMarketSport): Promise<PredictionMarketFeed | null> {
  const stored = await readLatestLabResponseSnapshot<Record<string, unknown>>(predictionMarketSnapshotKey(sport));
  return isPredictionMarketFeed(stored?.payload, sport) ? stored.payload : null;
}
/** Member requests only read a shared stored feed. They never call OWLS. */
export const readPredictionMarketDisplayFeed = unstable_cache(readStored,
  [PREDICTION_MARKET_RELEASE], { revalidate:30, tags:[PREDICTION_MARKET_RELEASE] });

export function predictionMarketContractSnapshotKey(sport:PredictionMarketSport,kind:ContractKind):string {
  return `daily-edge::prediction-market-contracts::${sport}::${kind}::${PREDICTION_MARKET_CONTRACT_RELEASE}`;
}
async function readContractStored(sport:PredictionMarketSport,kind:ContractKind):Promise<ContractFeed|null>{
  const stored=await readLatestLabResponseSnapshot<Record<string,unknown>>(predictionMarketContractSnapshotKey(sport,kind));
  const value=stored?.payload;
  return isPredictionMarketFeed(value,sport)&&stored?.payload.kind===kind&&stored.payload.contractRelease===PREDICTION_MARKET_CONTRACT_RELEASE&&
    value.rows.every(row=>"contractKind" in row&&row.contractKind===kind&&"strike" in row&&(kind==="btts"?row.strike===null:typeof row.strike==="number"))?value as ContractFeed:null;
}
export const readPredictionMarketContractFeed=unstable_cache(readContractStored,
  [PREDICTION_MARKET_CONTRACT_RELEASE],{revalidate:30,tags:[PREDICTION_MARKET_CONTRACT_RELEASE]});

/** SELECT the sole writer's published tuple; do not call any model or assembler. */
async function publishedContractGames(sport:PredictionMarketSport):Promise<DailyEdgeGameDto[]>{
  const query=supabase.from("lab_response_snapshots").select("payload");
  const result=sport==="nfl"||sport==="cfb"
    ?await query.like("snapshot_key",`${sport}::daily-edge::${sport==="nfl"?process.env.NFL_FORWARD_SEASON??new Date().getUTCFullYear():process.env.CFB_FORWARD_SEASON??new Date().getUTCFullYear()}::%`).order("generated_at",{ascending:false}).limit(1).maybeSingle()
    :await query.eq("snapshot_key",sport==="soccer"?"soccer::english_premier_league::current-week":sport==="ucl"?"soccer::uefa_champions_league::current-week":`${sport}::${sport==="cbb"?currentSlateDate("cbb"):currentDailyEdgeBoardDate(sport)}::current-only::live-copy`).maybeSingle();
  if(result.error)throw new Error(`Published ${sport} contract selection unavailable`);
  let payload=result.data?.payload;
  if(payload?.encoding==="gzip-base64")payload=JSON.parse(gunzipSync(Buffer.from(payload.payload,"base64"),{maxOutputLength:8_000_000}).toString("utf8"));
  const snapshot=payload?.fixture?.snapshot??payload?.snapshot??payload;
  if(!snapshot||!Array.isArray(snapshot.games))throw new Error(`Published ${sport} contract selection missing`);
  return snapshot.games.slice(0,250);
}
// CFB/NBA published boards can exceed Next's 2 MB data-cache item limit.
// Cache the lossless compressed view, not an uncachable expanded DTO array.
const publishedGamesCompressed=unstable_cache(async(sport:PredictionMarketSport)=>
  gzipSync(JSON.stringify(await publishedContractGames(sport))).toString("base64"),
  ["prediction_market_published_identity_r2_gzip"],{revalidate:30});
export async function readPublishedPredictionMarketGames(sport:PredictionMarketSport):Promise<DailyEdgeGameDto[]>{
  return JSON.parse(gunzipSync(Buffer.from(await publishedGamesCompressed(sport),"base64"),{maxOutputLength:8_000_000}).toString("utf8"));
}

/** Sole capture path: existing five-minute display-feed cron, same sport lease. */
export async function refreshPredictionMarketDisplayFeed(sport: PredictionMarketSport): Promise<{rows:number;owlsRequests:number;warnings:string[];historyCoverage?:Record<string,number>}> {
  const key = process.env.OWLS_INSIGHT_API_KEY;
  if (!key) throw new Error("OWLS_INSIGHT_API_KEY is not configured");
  const target = PREDICTION_MARKET_TARGETS[sport];
  const client=new OwlsInsightClient(key,{timeoutMs:5000}),kinds=contractKinds(sport);
  const gamesRead=publishedContractGames(sport).catch(()=>null);
  const [previous,response,games] = await Promise.all([
    readStored(sport),
    sport === "cbb" ? fetchCbbKalshiMarkets(target.series.toUpperCase()) : client.get<unknown>(`/api/v2/kalshi/${target.sport}`, {league:target.series}),
    gamesRead,
  ]);
  const current = parseOwlsPredictionMarkets("body" in response ? response.body : response, sport);
  if (!current) throw new Error(`Kalshi ${sport} returned an invalid or old source receipt`);
  const winners=mergePredictionMarketFeeds(previous,current);
  const contractInputs=await Promise.all(kinds.map(async kind=>{
    const previous=await readContractStored(sport,kind);
    const skipped=games===null||games.length===0;
    if(skipped)return {kind,previous,skipped,response:null};
    const series=contractSeries(sport,kind).toUpperCase();
    const eventTickers=sport==="cbb"?[...new Set(games.flatMap(game=>{
      const match=matchPredictionMarketGame(winners,{sport,awayTeam:game.awayTeam,homeTeam:game.homeTeam,
        awayName:game.awayTeamDisplayName,homeName:game.homeTeamDisplayName,awayCollege:game.cbbAwayCollege,homeCollege:game.cbbHomeCollege,
        gameStartAt:game.gameStartAt??""});
      return match?[`${series}-${match.eventTicker.slice(match.eventTicker.indexOf("-")+1)}`]:[];
    }))]:[];
    // Read only events attached to the published CBB board. The generic
    // alternate-line series can exceed thousands of unrelated contracts.
    const receipt=await (sport==="cbb"?fetchCbbKalshiMarkets(series,eventTickers.length<=6?{eventTickers}:{maxPages:10}):
      client.get<unknown>(`/api/v2/kalshi/${target.sport}`,{league:contractSeries(sport,kind)})).catch(()=>null);
    return {kind,previous,skipped,response:receipt};
  }));
  const warnings:string[]=[];
  const contracts=contractInputs.flatMap(input=>{
    if(input.skipped){
      if(games===null)warnings.push(`${input.kind}: published selection unavailable; retained`);
      return input.previous?[input.previous]:[];
    }
    const parsed=input.response?parseContractFeed("body" in input.response?input.response.body:input.response,sport,input.kind):null;
    if(!parsed||games===null){warnings.push(`${input.kind}: source receipt unavailable; retained`);return input.previous?[input.previous]:[];}
    const selected=contractsForPublishedReaders(parsed,winners,games);
    return [mergePredictionMarketFeeds(input.previous,selected) as ContractFeed];
  });
  // Keep the existing <=3 public-history requests per sport/cycle, shared
  // across market types; longer lifetime queries rotate fewer contracts.
  const pools=[winners,...contracts].map(feed=>[...feed.rows].sort((a,b)=>a.gameDate.localeCompare(b.gameDate)));
  const interleaved:PredictionMarketFeed["rows"]=[];
  for(let i=0;i<Math.max(0,...pools.map(rows=>rows.length));i++)for(const pool of pools)if(pool[i])interleaved.push(pool[i]);
  // Warm the actual selected markets of the nearest unlocked games first,
  // not the first arbitrary YES ticker or a distant alternate on the feed.
  const priority=new Map<string,number>();
  for(const game of [...(games??[])].filter(g=>g.lockState!=="locked"&&Date.parse(g.gameStartAt??"")>Date.now()).sort((a,b)=>Date.parse(a.gameStartAt!)-Date.parse(b.gameStartAt!))){
    const match=matchPredictionMarketGame(winners,{sport,awayTeam:game.awayTeam,homeTeam:game.homeTeam,gameStartAt:game.gameStartAt!,awayName:game.awayTeamDisplayName,homeName:game.homeTeamDisplayName,awayCollege:game.cbbAwayCollege,homeCollege:game.cbbHomeCollege,lockState:game.lockState,lockedAt:game.lockedAt});
    const outcome=match?selectedPredictionMarketOutcome(match,game.markets.moneyline.pick):null;
    if(outcome&&!priority.has(outcome.ticker))priority.set(outcome.ticker,priority.size);
    for(const kind of kinds){const selection=readerHistoryContractSelection(game,kind==="total"?"total":"first_inning"),feed=contracts.find(c=>c.kind===kind);if(selection&&feed)resolveReaderContract(feed,match,selection)?.context?.sources.forEach(r=>{if(!priority.has(r.ticker))priority.set(r.ticker,priority.size);});}
  }
  interleaved.sort((a,b)=>(priority.get(a.ticker)??10_000)-(priority.get(b.ticker)??10_000));
  const [captured,bookCapture]=await Promise.all([
    backfillKalshiDisplayHistory({...winners,rows:interleaved}),
    games?bookHistoryStored(sport).then(previous=>captureOwlsBookDisplayHistory(previous,games,sport,new OwlsInsightClient(key,{timeoutMs:1500}),Date.now(),"rateLimit" in response?response.rateLimit.remainingMonth:null)).catch(()=>null):Promise.resolve(null),
  ]);
  if(bookCapture){
    warnings.push(...bookCapture.warnings);
    const saved=await upsertLabResponseSnapshot({snapshotKey:predictionMarketBookSnapshotKey(sport),kind:"daily_edge",sport:sport==="ucl"?"soccer":sport,
      payload:{encoding:"gzip-base64",payload:gzipSync(JSON.stringify(bookCapture.feed)).toString("base64")},source:"owls_book_display_history",payloadVersion:BOOK_DISPLAY_HISTORY_RELEASE,ttlMs:5*60_000,staleMs:24*60*60_000});
    if(!saved.ok)warnings.push("book history: snapshot could not be stored");
    else revalidateTag(BOOK_DISPLAY_HISTORY_RELEASE,{expire:0});
  }else if(games?.length)warnings.push("book history: capture unavailable; retained");
  const byTicker=new Map(captured.rows.map(row=>[row.ticker,row]));
  const withHistory={...winners,rows:winners.rows.map(row=>byTicker.get(row.ticker)??row)};
  const feed=mergePredictionMarketFeeds(withHistory,{...withHistory,rows:[]});
  const updatedContracts=contracts.map(contract=>({...contract,rows:contract.rows.map(row=>byTicker.get(row.ticker)??row)}) as ContractFeed);
  if(games){
    try{
      const prior=await prelockStored(sport),archive=capturePredictionMarketPrelock(prior,games,sport,feed,updatedContracts,bookCapture?.feed??null,Date.now());
      const saved=await upsertLabResponseSnapshot({snapshotKey:prelockKey(sport),kind:"daily_edge",sport:sport==="ucl"?"soccer":sport,payload:{encoding:"gzip-base64",payload:gzipSync(JSON.stringify(archive)).toString("base64")},source:"prediction_market_prelock_display",payloadVersion:PREDICTION_MARKET_PRELOCK_RELEASE,ttlMs:5*60_000,staleMs:90*86_400_000});
      if(saved.ok)revalidateTag(PREDICTION_MARKET_PRELOCK_RELEASE,{expire:0});else warnings.push("pre-lock chart receipt: store unavailable; retained");
    }catch{warnings.push("pre-lock chart receipt: capture unavailable; retained");}
  }
  const stored = await upsertLabResponseSnapshot({ snapshotKey:predictionMarketSnapshotKey(sport),kind:"daily_edge",
    payload:feed as unknown as Record<string, unknown>,ttlMs:5*60_000,staleMs:24*60*60_000,
    sport:sport === "ucl" ? "soccer" : sport,source:sport==="cbb"?"kalshi_direct_display":"owls_kalshi_display",payloadVersion:PREDICTION_MARKET_RELEASE });
  if (!stored.ok) throw new Error(`Kalshi display receipt could not be stored: ${stored.error}`);
  for(const contract of contracts){
    const withHistory={...contract,rows:contract.rows.map(row=>byTicker.get(row.ticker)??row)};
    const updated=mergePredictionMarketFeeds(withHistory,{...withHistory,rows:[]}) as ContractFeed;
    const saved=await upsertLabResponseSnapshot({snapshotKey:predictionMarketContractSnapshotKey(sport,contract.kind),kind:"daily_edge",
      payload:updated as unknown as Record<string,unknown>,ttlMs:5*60_000,staleMs:24*60*60_000,sport:sport==="ucl"?"soccer":sport,
      source:sport==="cbb"?"kalshi_direct_display":"owls_kalshi_display",payloadVersion:PREDICTION_MARKET_CONTRACT_RELEASE});
    if(!saved.ok)warnings.push(`${contract.kind}: display snapshot could not be stored`);
  }
  // A successful scheduled write must not leave member requests on a prior
  // retained receipt while a stale-while-revalidate layer catches up.
  revalidateTag(PREDICTION_MARKET_RELEASE,{expire:0});
  revalidateTag(PREDICTION_MARKET_CONTRACT_RELEASE,{expire:0});
  return {rows:current.rows.length+contracts.reduce((sum,feed)=>sum+feed.rows.length,0),owlsRequests:("requests" in response?response.requests:1)+contractInputs.reduce((sum,input)=>sum+(input.response?("requests" in input.response?input.response.requests:1):0),0)+(bookCapture?.requests??0),warnings,
    historyCoverage:{kalshiFromOpen:captured.rows.filter(r=>r.historyFrom).length,kalshiPending:captured.rows.filter(r=>!r.historyFrom).length,bookHistoryEntries:bookCapture?.feed.rows.length??0,bookProviderOpenings:bookCapture?.feed.rows.filter(r=>r.opening).length??0}};
}
