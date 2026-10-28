import { unstable_cache } from "next/cache";
import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import {
  isPredictionMarketFeed, mergePredictionMarketFeeds, parseOwlsPredictionMarkets,
  PREDICTION_MARKET_RELEASE, PREDICTION_MARKET_TARGETS,
  type PredictionMarketFeed, type PredictionMarketSport,
} from "@/lib/providers/owls/owlsPredictionMarkets";
import { readLatestLabResponseSnapshot, upsertLabResponseSnapshot } from "../labResponseSnapshots";
import { backfillKalshiDisplayHistory } from "@/lib/providers/owls/kalshiDisplayHistory";
import { contractKinds, contractSeries, parseContractFeed, contractsForPublishedReaders, PREDICTION_MARKET_CONTRACT_RELEASE,
  type ContractKind, type ContractFeed } from "@/lib/providers/owls/predictionMarketContracts";
import { supabase } from "@/lib/db/supabase";
import { gunzipSync } from "node:zlib";
import { currentDailyEdgeBoardDate } from "@/lib/dates/slateDate";
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";

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
    :await query.eq("snapshot_key",sport==="soccer"?"soccer::english_premier_league::current-week":sport==="ucl"?"soccer::uefa_champions_league::current-week":`${sport}::${currentDailyEdgeBoardDate(sport)}::current-only::live-copy`).maybeSingle();
  if(result.error)throw new Error(`Published ${sport} contract selection unavailable`);
  let payload=result.data?.payload;
  if(payload?.encoding==="gzip-base64")payload=JSON.parse(gunzipSync(Buffer.from(payload.payload,"base64"),{maxOutputLength:8_000_000}).toString("utf8"));
  const snapshot=payload?.fixture?.snapshot??payload?.snapshot??payload;
  if(!snapshot||!Array.isArray(snapshot.games))throw new Error(`Published ${sport} contract selection missing`);
  return snapshot.games.slice(0,250);
}

/** Sole capture path: existing five-minute display-feed cron, same sport lease. */
export async function refreshPredictionMarketDisplayFeed(sport: PredictionMarketSport): Promise<{rows:number;owlsRequests:number;warnings:string[]}> {
  const key = process.env.OWLS_INSIGHT_API_KEY;
  if (!key) throw new Error("OWLS_INSIGHT_API_KEY is not configured");
  const target = PREDICTION_MARKET_TARGETS[sport];
  const client=new OwlsInsightClient(key,{timeoutMs:5000}),kinds=contractKinds(sport);
  const gamesRead=publishedContractGames(sport).catch(()=>null);
  const [previous,response,games,contractInputs] = await Promise.all([
    readStored(sport),
    client.get<unknown>(`/api/v2/kalshi/${target.sport}`, {league:target.series}),
    gamesRead,
    Promise.all(kinds.map(async kind=>{
      const [previous,games]=await Promise.all([readContractStored(sport,kind),gamesRead]);
      const skipped=games===null||games.length===0;
      return {kind,previous,skipped,response:skipped?null:await client.get<unknown>(`/api/v2/kalshi/${target.sport}`,{league:contractSeries(sport,kind)}).catch(()=>null)};
    })),
  ]);
  const current = parseOwlsPredictionMarkets(response.body, sport);
  if (!current) throw new Error(`Kalshi ${sport} returned an invalid or old source receipt`);
  const winners=mergePredictionMarketFeeds(previous,current);
  const warnings:string[]=[];
  const contracts=contractInputs.flatMap(input=>{
    if(input.skipped){
      if(games===null)warnings.push(`${input.kind}: published selection unavailable; retained`);
      return input.previous?[input.previous]:[];
    }
    const parsed=input.response?parseContractFeed(input.response.body,sport,input.kind):null;
    if(!parsed||games===null){warnings.push(`${input.kind}: source receipt unavailable; retained`);return input.previous?[input.previous]:[];}
    const selected=contractsForPublishedReaders(parsed,winners,games);
    return [mergePredictionMarketFeeds(input.previous,selected) as ContractFeed];
  });
  // Keep the EXISTING global budget: <=60 contracts / <=3 public-history
  // batches per sport/cycle, shared fairly across all market types.
  const pools=[winners,...contracts].map(feed=>[...feed.rows].sort((a,b)=>a.gameDate.localeCompare(b.gameDate)));
  const interleaved:PredictionMarketFeed["rows"]=[];
  for(let i=0;i<Math.max(0,...pools.map(rows=>rows.length));i++)for(const pool of pools)if(pool[i])interleaved.push(pool[i]);
  const captured=await backfillKalshiDisplayHistory({...winners,rows:interleaved});
  const byTicker=new Map(captured.rows.map(row=>[row.ticker,row]));
  const withHistory={...winners,rows:winners.rows.map(row=>byTicker.get(row.ticker)??row)};
  const feed=mergePredictionMarketFeeds(withHistory,{...withHistory,rows:[]});
  const stored = await upsertLabResponseSnapshot({ snapshotKey:predictionMarketSnapshotKey(sport),kind:"daily_edge",
    payload:feed as unknown as Record<string, unknown>,ttlMs:5*60_000,staleMs:24*60*60_000,
    sport:sport === "ucl" ? "soccer" : sport,source:"owls_kalshi_display",payloadVersion:PREDICTION_MARKET_RELEASE });
  if (!stored.ok) throw new Error(`Kalshi display receipt could not be stored: ${stored.error}`);
  for(const contract of contracts){
    const withHistory={...contract,rows:contract.rows.map(row=>byTicker.get(row.ticker)??row)};
    const updated=mergePredictionMarketFeeds(withHistory,{...withHistory,rows:[]}) as ContractFeed;
    const saved=await upsertLabResponseSnapshot({snapshotKey:predictionMarketContractSnapshotKey(sport,contract.kind),kind:"daily_edge",
      payload:updated as unknown as Record<string,unknown>,ttlMs:5*60_000,staleMs:24*60*60_000,sport:sport==="ucl"?"soccer":sport,
      source:"owls_kalshi_display",payloadVersion:PREDICTION_MARKET_CONTRACT_RELEASE});
    if(!saved.ok)warnings.push(`${contract.kind}: display snapshot could not be stored`);
  }
  return {rows:current.rows.length+contracts.reduce((sum,feed)=>sum+feed.rows.length,0),owlsRequests:1+contractInputs.filter(input=>!input.skipped).length,warnings};
}
