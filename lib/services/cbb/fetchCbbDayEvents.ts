import type { EspnCbbEvent } from "@/lib/cbb/dataset";

export async function fetchCbbDayEvents(slateDate:string,fetcher:typeof fetch=fetch):Promise<{fetchedAt:string;events:EspnCbbEvent[]}>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(slateDate))throw new Error("Invalid CBB ESPN date");
  const url=new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard");
  url.searchParams.set("dates",slateDate.replaceAll("-",""));url.searchParams.set("groups","50");url.searchParams.set("limit","500");
  const response=await fetcher(url,{signal:AbortSignal.timeout(20_000),cache:"no-store"});
  if(!response.ok)throw new Error(`CBB ESPN scoreboard HTTP ${response.status}`);
  const body=await response.json() as {events?:unknown};
  if(!Array.isArray(body.events)||body.events.length>=500)throw new Error("CBB ESPN scoreboard incomplete");
  return {fetchedAt:new Date().toISOString(),events:body.events as EspnCbbEvent[]};
}
