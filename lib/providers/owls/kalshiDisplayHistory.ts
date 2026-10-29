import type { PredictionMarketFeed, PredictionMarketPoint } from "./owlsPredictionMarkets";
import {boundPredictionMarketHistory,PREDICTION_MARKET_HISTORY_WINDOW_MS} from "./owlsPredictionMarkets";

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const numeric = (value: unknown): number | null => value === null || value === undefined || value === "" || typeof value === "boolean" || !Number.isFinite(Number(value)) ? null : Number(value);

export const KALSHI_DISPLAY_HISTORY_RELEASE="kalshi_display_candles_2026_10_29_r4_lifetime";

/** Keep real closed bid/ask observations even when a volume interval is
 * incomplete. Downsampling retains the actual quote minute, not a synthetic
 * five-minute-boundary timestamp. Activity needs all five real minutes. */
export function parseKalshiDisplayCandles(value: unknown, ticker: string, asOf: number, since=asOf-PREDICTION_MARKET_HISTORY_WINDOW_MS, period=1): PredictionMarketPoint[] {
  const raw=object(value);
  if(raw?.market_ticker!==ticker || !Array.isArray(raw.candlesticks) || raw.candlesticks.length>10_000)return [];
  const minutes=new Map<number,{p:number;volume:number|null}>();
  for(const item of raw.candlesticks){
    const candle=object(item), at=numeric(candle?.end_period_ts);
    const bid=numeric(object(candle?.yes_bid)?.close_dollars), ask=numeric(object(candle?.yes_ask)?.close_dollars);
    const volume=numeric(candle?.volume_fp);
    if(at===null || !Number.isInteger(at) || at%60!==0 || at*1000>asOf || at*1000<since || bid===null || ask===null || bid<0 || ask>1 || bid>ask || ask-bid>.2 || (bid===0&&ask===0) || (bid===1&&ask===1))continue;
    minutes.set(at,{p:(bid+ask)/2,volume:volume!==null&&volume>=0?volume:null});
  }
  if(period!==1)return boundPredictionMarketHistory([...minutes].map(([at,v])=>[at*1000,v.p,v.volume]),192);
  const buckets=new Map<number,number[]>();
  for(const at of minutes.keys()){const end=Math.ceil(at/300)*300;const group=buckets.get(end)??[];group.push(at);buckets.set(end,group);}
  const result:PredictionMarketPoint[]=[];
  for(const [end,group] of buckets){
    const last=Math.max(...group);
    const values=group.map(at=>minutes.get(at)!);
    result.push([last*1000,minutes.get(last)!.p,group.length===5&&minutes.has(end)&&values.every(v=>v.volume!==null)?values.reduce((sum,v)=>sum+v.volume!,0):null]);
  }
  return boundPredictionMarketHistory(result,192);
}

/** Existing display cron only. Public history, no API credentials, no trading calls. */
export async function backfillKalshiDisplayHistory(feed: PredictionMarketFeed, now=Date.now(), fetchImpl:typeof fetch=fetch): Promise<PredictionMarketFeed> {
  const eligible=feed.rows.filter(row=>now>=Date.parse(row.asOf)&&now-Date.parse(row.asOf)<PREDICTION_MARKET_HISTORY_WINDOW_MS && (row.historicalRelease!==KALSHI_DISPLAY_HISTORY_RELEASE || !row.historicalCheckedAt || now-Date.parse(row.historicalCheckedAt)>60*60_000))
    .sort((a,b)=>Number(a.historicalRelease===KALSHI_DISPLAY_HISTORY_RELEASE)-Number(b.historicalRelease===KALSHI_DISPLAY_HISTORY_RELEASE)||a.gameDate.localeCompare(b.gameDate)||
      (a.historicalRelease===KALSHI_DISPLAY_HISTORY_RELEASE?Date.parse(a.historicalCheckedAt??"1970-01-01")-Date.parse(b.historicalCheckedAt??"1970-01-01"):0));
  const updated=new Map<string,Partial<PredictionMarketFeed["rows"][number]>>();let requests=0;
  const get=async(ticker:string,start:number,end:number,period:number)=>{
    if(requests>=3)return null;requests++;
    const query=new URLSearchParams({market_tickers:ticker,start_ts:String(Math.floor(start/1000)),end_ts:String(Math.floor(end/1000)),period_interval:String(period),include_latest_before_start:"false"});
    const response=await fetchImpl(`https://external-api.kalshi.com/trade-api/v2/markets/candlesticks?${query}`,{signal:AbortSignal.timeout(2500),headers:{Accept:"application/json"}});
    if(!response.ok)return null;const text=await response.text();if(text.length>8_000_000)return null;
    const body=object(JSON.parse(text));return Array.isArray(body?.markets)?body.markets.find(v=>object(v)?.market_ticker===ticker):null;
  };
  // <=3 requests on the SAME cron. Full minute history for <=6 days; hourly
  // for <=32 days, plus exact opening-hour minute evidence. No viewer calls.
  for(const row of eligible){
    if(requests>=3)break;
    const opened=Date.parse(row.marketOpenedAt??""),asOf=Date.parse(row.asOf),known=Number.isFinite(opened)&&opened<=asOf&&asOf-opened<=366*86_400_000;
    const from=known?opened:asOf-PREDICTION_MARKET_HISTORY_WINDOW_MS,period=asOf-from<=6*86_400_000?1:60;
    if(period===60&&requests>1)continue;
    try{
      const raw=await get(row.ticker,from,asOf,period);if(!raw)continue;
      const candles=parseKalshiDisplayCandles(raw,row.ticker,asOf,from,period);
      const openingRaw=period===1?raw:await get(row.ticker,from,Math.min(asOf,from+3600_000),1);
      const first=(openingRaw?parseKalshiDisplayCandles(openingRaw,row.ticker,asOf,from,60):[])[0]??candles[0],existing=row.openingQuote;
      const openingQuote=first&&(!existing||first[0]<existing.point[0])?{point:first,kind:known&&first[0]===Math.floor(opened/60_000)*60_000+60_000?"opening_minute" as const:"first_available" as const}:existing;
      updated.set(row.ticker,{historicalCandles:boundPredictionMarketHistory([...(row.historicalCandles??[]),...candles,...(first?[first]:[])],192),historicalCheckedAt:new Date(now).toISOString(),historicalRelease:KALSHI_DISPLAY_HISTORY_RELEASE,
        ...(known?{historyFrom:row.marketOpenedAt}:{}),...(openingQuote?{openingQuote}:{})});
    }catch{ /* A public-history outage never removes current quotes or split data. */ }
  }
  return {...feed,rows:feed.rows.map(row=>({...row,...updated.get(row.ticker)}))};
}
