import type { PredictionMarketFeed, PredictionMarketPoint } from "./owlsPredictionMarkets";
import {boundPredictionMarketHistory,PREDICTION_MARKET_HISTORY_WINDOW_MS} from "./owlsPredictionMarkets";

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const numeric = (value: unknown): number | null => value === null || value === undefined || value === "" || typeof value === "boolean" || !Number.isFinite(Number(value)) ? null : Number(value);

export const KALSHI_DISPLAY_HISTORY_RELEASE="kalshi_display_candles_2026_10_28_r3_shared_day_window";

/** Keep real closed bid/ask observations even when a volume interval is
 * incomplete. Downsampling retains the actual quote minute, not a synthetic
 * five-minute-boundary timestamp. Activity needs all five real minutes. */
export function parseKalshiDisplayCandles(value: unknown, ticker: string, asOf: number): PredictionMarketPoint[] {
  const raw=object(value);
  if(raw?.market_ticker!==ticker || !Array.isArray(raw.candlesticks) || raw.candlesticks.length>10_000)return [];
  const minutes=new Map<number,{p:number;volume:number|null}>();
  for(const item of raw.candlesticks){
    const candle=object(item), at=numeric(candle?.end_period_ts);
    const bid=numeric(object(candle?.yes_bid)?.close_dollars), ask=numeric(object(candle?.yes_ask)?.close_dollars);
    const volume=numeric(candle?.volume_fp);
    if(at===null || !Number.isInteger(at) || at%60!==0 || at*1000>asOf || at*1000<asOf-PREDICTION_MARKET_HISTORY_WINDOW_MS || bid===null || ask===null || bid<0 || ask>1 || bid>ask || ask-bid>.2 || (bid===0&&ask===0) || (bid===1&&ask===1))continue;
    minutes.set(at,{p:(bid+ask)/2,volume:volume!==null&&volume>=0?volume:null});
  }
  const buckets=new Map<number,number[]>();
  for(const at of minutes.keys()){const end=Math.ceil(at/300)*300;const group=buckets.get(end)??[];group.push(at);buckets.set(end,group);}
  const result:PredictionMarketPoint[]=[];
  for(const [end,group] of buckets){
    const last=Math.max(...group);
    const values=group.map(at=>minutes.get(at)!);
    result.push([last*1000,minutes.get(last)!.p,group.length===5&&minutes.has(end)&&values.every(v=>v.volume!==null)?values.reduce((sum,v)=>sum+v.volume!,0):null]);
  }
  return boundPredictionMarketHistory(result,96);
}

/** Existing display cron only. Public history, no API credentials, no trading calls. */
export async function backfillKalshiDisplayHistory(feed: PredictionMarketFeed, now=Date.now(), fetchImpl:typeof fetch=fetch): Promise<PredictionMarketFeed> {
  const eligible=feed.rows.filter(row=>now>=Date.parse(row.asOf)&&now-Date.parse(row.asOf)<PREDICTION_MARKET_HISTORY_WINDOW_MS && (row.historicalRelease!==KALSHI_DISPLAY_HISTORY_RELEASE || !row.historicalCheckedAt || now-Date.parse(row.historicalCheckedAt)>60*60_000))
    .sort((a,b)=>Number(a.historicalRelease===KALSHI_DISPLAY_HISTORY_RELEASE)-Number(b.historicalRelease===KALSHI_DISPLAY_HISTORY_RELEASE)||
      Date.parse(a.historicalCheckedAt??"1970-01-01")-Date.parse(b.historicalCheckedAt??"1970-01-01")||a.gameDate.localeCompare(b.gameDate)).slice(0,18);
  const updated=new Map<string,{historicalCandles:PredictionMarketPoint[];historicalCheckedAt:string;historicalRelease:string}>();
  // <=6 * 1440 minute candles stays below the 10,000-candle batch limit.
  // Still <=3 sequential requests / league on the EXISTING display cron.
  // Oldest-checked first rotates the bounded work instead of starving a slate.
  for(let index=0;index<eligible.length;index+=6){
    const batch=eligible.slice(index,index+6), end=Math.floor(now/300_000)*300;
    const query=new URLSearchParams({market_tickers:batch.map(row=>row.ticker).join(","),start_ts:String(end-24*3600),end_ts:String(end),period_interval:"1",include_latest_before_start:"false"});
    try{
      const response=await fetchImpl(`https://external-api.kalshi.com/trade-api/v2/markets/candlesticks?${query}`,{signal:AbortSignal.timeout(2500),headers:{Accept:"application/json"}});
      if(!response.ok)continue;
      const text=await response.text();if(text.length>5_000_000)continue;
      const body=object(JSON.parse(text));if(!Array.isArray(body?.markets))continue;
      for(const row of batch){
        const market=body.markets.find(value=>object(value)?.market_ticker===row.ticker);
        if(!market)continue;
        const candles=parseKalshiDisplayCandles(market,row.ticker,Date.parse(row.asOf));
        updated.set(row.ticker,{historicalCandles:boundPredictionMarketHistory([...(row.historicalCandles??[]),...candles].filter(p=>p[0]>=Date.parse(row.asOf)-PREDICTION_MARKET_HISTORY_WINDOW_MS),96),historicalCheckedAt:new Date(now).toISOString(),historicalRelease:KALSHI_DISPLAY_HISTORY_RELEASE});
      }
    }catch{ /* A public-history outage never removes current quotes or split data. */ }
  }
  return {...feed,rows:feed.rows.map(row=>({...row,...updated.get(row.ticker)}))};
}
